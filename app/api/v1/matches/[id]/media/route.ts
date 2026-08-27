/**
 * POST /api/v1/matches/{id}/media — アップロード完了後の登録（API_SPEC.md §2）
 * GET  /api/v1/matches/{id}/media — 一覧
 *
 * 三通りの結果がある（§2.2）。
 *   created        新規（201）
 *   already_exists 同じ指紋の行が生きている（200）
 *   restored       A削除済みの行を復活させた（200）
 *
 * **重複はエラーではない。** 同じ音声を二度登録しようとしただけであり、
 * 利用者が悪いことをしたわけではない。409 を新設せず、既存を 200 で返す。
 *
 * Idempotency-Key は要求しない（§0.4）。source_sha256 の UNIQUE が
 * 二重登録を構造的に防ぐ。二つの冪等機構が同じことを守ると、
 * 片方が壊れたときに気づけない。
 */
import { z } from "zod";
import { defineHandler } from "@core/http";
import { ApiError } from "@core/http/errors";
import {
  RegisterMediaReq,
  storagePathFor,
  type MediaSource,
  type RegisterMediaRes,
} from "@core/schema";
import { requireMatch } from "@core/db/repo/matches";
import { listMedia, registerMedia } from "@core/db/repo/media";

export const runtime = "nodejs";

export const POST = defineHandler({
  auth: "match:write",
  params: z.object({ id: z.uuid() }),
  body: RegisterMediaReq,
  handler: async ({ params, body, actor, tx, audit }) => {
    await requireMatch(tx, params.id);

    // **クライアントが申告した storagePath をそのまま信用しない。**
    // 同じ規則で組み立て直して照合する。ここを通さないと、
    // 他の match のパスを指した行を作れてしまう
    const expected = storagePathFor(params.id, body.sourceSha256, body.mime);
    if (body.storagePath !== expected) {
      throw new ApiError(
        "VALIDATION_FAILED",
        "storagePath が match_id・sourceSha256・mime と一致しません",
        { expected, received: body.storagePath },
      );
    }

    const outcome = await registerMedia(tx, {
      matchId: params.id,
      storagePath: expected,
      sourceSha256: body.sourceSha256,
      durationMs: body.durationMs,
      mime: body.mime,
      bitrate: body.bitrate,
      channels: body.channels,
      origin: body.origin,
      uploadedBy: actor.id,
    });

    audit.record({
      entity: "media_sources",
      entityId: outcome.media.id,
      matchId: params.id,
      before: outcome.status === "restored" ? summarize(outcome.before) : null,
      after: { register: outcome.status, ...summarize(outcome.media) },
    });

    const data: RegisterMediaRes = { status: outcome.status, mediaSourceId: outcome.media.id };
    return { data, status: outcome.status === "created" ? 201 : 200 };
  },
});

export const GET = defineHandler({
  auth: "match:read",
  params: z.object({ id: z.uuid() }),
  handler: async ({ params, tx }) => {
    await requireMatch(tx, params.id);
    return { data: await listMedia(tx, params.id) };
  },
});

/** edit_logs に入れる形。本文相当のものは持たないので、そのまま入れてよい */
function summarize(media: MediaSource) {
  return {
    storagePath: media.storagePath,
    sourceSha256: media.sourceSha256,
    durationMs: media.durationMs,
    mime: media.mime,
    origin: media.origin,
    purgedAt: media.purgedAt,
  };
}
