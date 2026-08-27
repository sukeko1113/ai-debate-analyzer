/**
 * media_sources の読み書き（DATA_MODEL.md §3 / API_SPEC.md §2）。
 *
 * ここを通るクエリはすべて defineHandler が開いたトランザクション上で走る。
 * つまり SET LOCAL app.actor_id 済みであり、RLS が効いている。
 * tx を受け取らない関数をこのファイルに足さないこと。
 */
import type { TransactionSql } from "postgres";
import { ApiError, SQLSTATE } from "../../http/errors";
import type { MediaSource, MediaMime, MediaOrigin } from "../../schema/media";

interface MediaRow {
  id: string;
  match_id: string;
  storage_path: string | null;
  source_sha256: string;
  duration_ms: number;
  mime: string;
  bitrate: number | null;
  channels: number | null;
  origin: string;
  uploaded_by: string | null;
  purged_at: Date | null;
  created_at: Date;
}

export function toMediaSource(row: MediaRow): MediaSource {
  return {
    id: row.id,
    matchId: row.match_id,
    storagePath: row.storage_path,
    sourceSha256: row.source_sha256,
    durationMs: row.duration_ms,
    mime: row.mime as MediaMime,
    bitrate: row.bitrate,
    channels: row.channels,
    origin: row.origin as MediaOrigin,
    uploadedBy: row.uploaded_by,
    purgedAt: row.purged_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

/** 指紋で引く。RLS で見えない match のものは null になる */
export async function findByFingerprint(
  tx: TransactionSql,
  matchId: string,
  sourceSha256: string,
): Promise<MediaSource | null> {
  const rows = await tx<MediaRow[]>`
    SELECT * FROM media_sources
     WHERE match_id = ${matchId} AND source_sha256 = ${sourceSha256}`;
  const row = rows[0];
  return row ? toMediaSource(row) : null;
}

/** 再生などで id から引く。match_id も返るので matchIdFrom に使える */
export async function findMediaById(tx: TransactionSql, id: string): Promise<MediaSource | null> {
  const rows = await tx<MediaRow[]>`SELECT * FROM media_sources WHERE id = ${id}`;
  const row = rows[0];
  return row ? toMediaSource(row) : null;
}

/** 見えなければ 404。403 にすると存在が漏れる（HANDOFF 件14） */
export async function requireMedia(tx: TransactionSql, id: string): Promise<MediaSource> {
  const media = await findMediaById(tx, id);
  if (!media) throw new ApiError("NOT_FOUND", "対象のメディアが見つかりません");
  return media;
}

export async function listMedia(tx: TransactionSql, matchId: string): Promise<MediaSource[]> {
  const rows = await tx<MediaRow[]>`
    SELECT * FROM media_sources WHERE match_id = ${matchId} ORDER BY created_at DESC`;
  return rows.map(toMediaSource);
}

export interface RegisterInput {
  matchId: string;
  storagePath: string;
  sourceSha256: string;
  durationMs: number;
  mime: MediaMime;
  bitrate: number | null;
  channels: number | null;
  origin: MediaOrigin;
  uploadedBy: string;
}

export type RegisterOutcome =
  | { status: "created"; media: MediaSource }
  | { status: "restored"; media: MediaSource; before: MediaSource }
  | { status: "already_exists"; media: MediaSource };

/**
 * 登録（API_SPEC.md §2.2 の3通り）。
 *
 * **INSERT を先に撃ち、UNIQUE 違反（23505）を捕まえて SELECT し直す。**
 * 先に SELECT してから INSERT する形は、二つのリクエストが同時に来たときの
 * 競合を防げない（SELECT と INSERT の間に他方が INSERT できてしまう）。
 *
 * purge 済みの行に当たった場合は、行を再利用して storage_path を入れ直し、
 * purged_at を null に戻す（restored）。UNIQUE があるので行は作り直せず、
 * これが無いと「一度消したら二度と入れられない」になる。
 *
 * 同時 restore は `WHERE purged_at IS NOT NULL` が後発側で 0 行になることで
 * 吸収され、0 行側は already_exists を返す。lock_version は要らない（DATA_MODEL.md §3）。
 */
export async function registerMedia(
  tx: TransactionSql,
  input: RegisterInput,
): Promise<RegisterOutcome> {
  // **savepoint で囲む。** postgres.js のトランザクションは、1 つ例外が出ると
  // 全体が中断する（HANDOFF 件13）。UNIQUE 違反をそのまま外へ出すと、
  // 続く SELECT が「current transaction is aborted」で落ちる。
  let inserted: MediaRow | undefined;
  try {
    inserted = await tx.savepoint(async (sp) => {
      const rows = await sp<MediaRow[]>`
        INSERT INTO media_sources (match_id, storage_path, source_sha256, duration_ms,
                                   mime, bitrate, channels, origin, uploaded_by)
        VALUES (${input.matchId}, ${input.storagePath}, ${input.sourceSha256},
                ${input.durationMs}, ${input.mime}, ${input.bitrate}, ${input.channels},
                ${input.origin}, ${input.uploadedBy})
        RETURNING *`;
      return rows[0];
    });
  } catch (error) {
    if ((error as { code?: string })?.code !== SQLSTATE.UNIQUE_VIOLATION) throw error;
  }

  if (inserted) return { status: "created", media: toMediaSource(inserted) };

  // ここから先は「同じ指紋の行が既にある」場合だけ
  const existing = await findByFingerprint(tx, input.matchId, input.sourceSha256);
  if (!existing) {
    // UNIQUE に当たったのに引けない＝RLS で見えない他人の行、は起こり得ない
    // （match_id が同じなら同じ可視性）。起きたら設計の想定違反なので隠さない
    throw new ApiError("INTERNAL", "重複を検出しましたが対象の行を読み出せませんでした");
  }

  if (existing.purgedAt === null) {
    return { status: "already_exists", media: existing };
  }

  const restoredRows = await tx<MediaRow[]>`
    UPDATE media_sources
       SET storage_path = ${input.storagePath},
           purged_at    = NULL,
           duration_ms  = ${input.durationMs},
           mime         = ${input.mime},
           bitrate      = ${input.bitrate},
           channels     = ${input.channels},
           origin       = ${input.origin},
           uploaded_by  = ${input.uploadedBy}
     WHERE id = ${existing.id}
       AND purged_at IS NOT NULL
    RETURNING *`;

  const restored = restoredRows[0];
  if (!restored) {
    // 0 行＝別のリクエストが先に復活させた。競合はここで吸収する
    const current = await findByFingerprint(tx, input.matchId, input.sourceSha256);
    if (!current) throw new ApiError("INTERNAL", "復活後の行を読み出せませんでした");
    return { status: "already_exists", media: current };
  }

  return { status: "restored", media: toMediaSource(restored), before: existing };
}
