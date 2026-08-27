/**
 * Storage の定数（TRANSCRIPTION.md §7.3）。
 *
 * ここが「Supabase の仕様に合わせている値」の置き場である。1 箇所にまとめてあるのは、
 * 理由を知らない人が個別に変えられないようにするためである。
 */

/**
 * TUS のチャンクサイズ。**変更禁止。**
 *
 * 公式ドキュメントの注記をそのまま引く:
 *   `chunkSize: 6 * 1024 * 1024, // NOTE: it must be set to 6MB (for now) do not change it`
 *
 * 出典: https://supabase.com/docs/guides/storage/uploads/resumable-uploads
 *
 * 「小さいファイルなら小さくしてよいはず」と考えて変えないこと。
 * Supabase 側の実装がこの値を前提にしており、変えると 6MB を超えた時点で失敗する。
 */
export const TUS_CHUNK_SIZE = 6 * 1024 * 1024;

/**
 * TUS のエンドポイントのパス。ホストは `NEXT_PUBLIC_SUPABASE_STORAGE_URL`。
 *
 * `{ref}.supabase.co` ではなく `{ref}.storage.supabase.co`（直結ホスト）を使う。
 * 公式: "For optimal performance when uploading large files you should always use
 * the direct storage hostname."
 */
export const TUS_UPLOAD_PATH = "/storage/v1/upload/resumable";

/**
 * 署名アップロードトークンの有効期間（秒）。
 *
 * **こちらが選んだ値ではない。** Supabase の `createSignedUploadUrl` は
 * 「They are valid for 2 hours.」と定義されており、期限を指定する引数を持たない
 * （options は `{ upsert: boolean }` のみ）。
 * ここに定数として置いてあるのは、`expiresAt` を計算するためだけである
 * （API_SPEC.md §2.3）。
 *
 * 出典: https://github.com/supabase/storage-js/blob/master/src/packages/StorageFileApi.ts
 */
export const SIGNED_UPLOAD_TTL_SECONDS = 2 * 60 * 60;

/**
 * 再生用署名URLの既定の有効期間（秒）。**これはこちらが選んだ値である**
 * （API_SPEC.md §2 / TRANSCRIPTION.md §7）。上の2時間とは別物。
 */
export const PLAYBACK_URL_TTL_SECONDS = 15 * 60;

/** 既定のバケット名。`SUPABASE_STORAGE_BUCKET` が未設定のときに使う */
export const DEFAULT_MEDIA_BUCKET = "media";
