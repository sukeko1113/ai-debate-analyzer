/**
 * GET /api/v1/media/{id}/playback-url — 再生用の短命な署名URL（API_SPEC.md §2）
 *
 * **params.id が match id ではない。** したがって `matchIdFrom` を渡す。
 * 渡し忘れると「match id を特定できません」の 500 になる（HANDOFF 件14）。
 * `defineHandler` は既定で `params.id` を match id とみなすためである。
 *
 * 応答を DB に保存しない。毎回発行する（§2.4）。
 * 保存すると、期限切れのURLが残り続けるうえ、削除したはずの音声への入口が残る。
 */
import { z } from "zod";
import { defineHandler } from "@core/http";
import { ApiError } from "@core/http/errors";
import type { PlaybackUrlRes } from "@core/schema";
import { requireMedia } from "@core/db/repo/media";
import { getStorageSigner, PLAYBACK_URL_TTL_SECONDS } from "@core/storage";
import { parseEnv } from "@core/env";

export const runtime = "nodejs";

export const GET = defineHandler({
  auth: "match:read",
  params: z.object({ id: z.uuid() }),
  /**
   * match は media_sources の行から引く。
   *
   * このクエリは認可の前に走るが、`SET LOCAL app.actor_id` 済みの
   * トランザクション上なので RLS が効く。**見えないメディアはここで 404 になる。**
   * 403 にすると、その id のメディアが存在することが漏れる。
   */
  matchIdFrom: async (params, tx) => (await requireMedia(tx, params.id)).matchId,
  handler: async ({ params, tx }) => {
    const media = await requireMedia(tx, params.id);

    // A削除済みのメディアには再生URLが無い。410 で「消した」ことを伝える。
    // 404 にすると「そんなものは無かった」に見えてしまう
    if (media.storagePath === null) {
      throw new ApiError("RETENTION_PURGED", "この音声は保持期限またはA削除により削除済みです");
    }

    const signed = await getStorageSigner(parseEnv(process.env)).createPlaybackUrl(
      media.storagePath,
      PLAYBACK_URL_TTL_SECONDS,
    );

    const data: PlaybackUrlRes = { url: signed.url, expiresAt: signed.expiresAt };
    return { data };
  },
});
