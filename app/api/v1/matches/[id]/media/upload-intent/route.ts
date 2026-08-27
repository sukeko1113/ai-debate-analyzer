/**
 * POST /api/v1/matches/{id}/media/upload-intent — 保存パスと署名トークンの払い出し（API_SPEC.md §2）
 *
 * **ここがアップロードの認可点である。** ファイル本体は API を通らず、
 * ブラウザから Storage へ直接送られる。バケット側は「誰も直接書けない」設定なので、
 * 書けるかどうかはこのエンドポイントが署名を出すかどうかで決まる
 * （TRANSCRIPTION.md §7.3）。
 *
 * Idempotency-Key は要求しない（§0.4）。短命トークンを払い出すだけで、
 * 外部に状態を作らない。重複は source_sha256 の UNIQUE が構造的に防ぐ。
 */
import { z } from "zod";
import { defineHandler } from "@core/http";
import { UploadIntentReq, storagePathFor, type UploadIntentRes } from "@core/schema";
import { requireMatch } from "@core/db/repo/matches";
import { findByFingerprint } from "@core/db/repo/media";
import { getStorageSigner } from "@core/storage";
import { parseEnv } from "@core/env";

export const runtime = "nodejs";

export const POST = defineHandler({
  auth: "match:write",
  params: z.object({ id: z.uuid() }),
  body: UploadIntentReq,
  handler: async ({
    params,
    body,
    tx,
    audit,
  }): Promise<{ data: UploadIntentRes; status: number }> => {
    // 見えない match は 404。存在を漏らさない
    await requireMatch(tx, params.id);

    const existing = await findByFingerprint(tx, params.id, body.sourceSha256);

    // 生きている行があるなら、アップロードそのものが要らない
    if (existing && existing.purgedAt === null) {
      // 署名を出さなかったことも記録する。「要求はあったが発行しなかった」が
      // 残らないと、あとから経緯を追えない
      audit.record({
        entity: "media_sources",
        entityId: existing.id,
        matchId: params.id,
        before: null,
        after: { uploadIntent: "already_exists", sourceSha256: body.sourceSha256 },
      });
      const data: UploadIntentRes = {
        status: "already_exists",
        mediaSourceId: existing.id,
      };
      return { data, status: 200 };
    }

    // **upsert はサーバが決める**（API_SPEC.md §2.2）。
    // purge 済みの行を復活させるときだけ true。新規は false にして、
    // 同一パスへの意図しない上書きを防ぐ。
    // 署名トークンは発行時に upsert が焼き込まれるため、後から選ばせる余地がない
    const upsert = existing !== null && existing.purgedAt !== null;

    const storagePath = storagePathFor(params.id, body.sourceSha256, body.mime);
    const signed = await getStorageSigner(parseEnv(process.env)).createUploadToken(storagePath, {
      upsert,
    });

    // **署名の発行そのものを記録する。**
    // これは「誰に、どのパスへの書き込み権を、上書き可否つきで渡したか」の記録である。
    // ファイル本体は API を通らないので、サーバ側にこの記録が無いと、
    // 誰がその音声を置いたのかを後から追えなくなる
    audit.record({
      entity: "media_sources",
      entityId: null,
      matchId: params.id,
      before: null,
      after: {
        uploadIntent: "ready",
        storagePath,
        upsert,
        sourceSha256: body.sourceSha256,
        mime: body.mime,
        byteSize: body.byteSize,
        // filename は表示用。保存パスには使っていないが、
        // 「利用者が何を上げたつもりか」は記録に残す価値がある
        filename: body.filename,
      },
    });

    const data: UploadIntentRes = {
      status: "ready",
      storagePath: signed.storagePath,
      bucket: signed.bucket,
      tusEndpoint: signed.tusEndpoint,
      uploadToken: signed.uploadToken,
      // サーバが選んだ期限ではない。発行時刻＋2時間である（API_SPEC.md §2.3）
      expiresAt: signed.expiresAt,
    };
    return { data, status: 200 };
  },
});
