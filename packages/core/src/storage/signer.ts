/**
 * Storage の署名インタフェース（TRANSCRIPTION.md §7.3）。
 *
 * **ここが第二のセキュリティ境界である。** ブラウザは Storage へ直接送るので、
 * DB の RLS とは別に「誰が書けるか」を決める必要がある。この設計では
 * バケット側のポリシーを「誰も直接書けない」にし、**認可はサーバの署名発行時点で行う**。
 * したがって、このインタフェースを呼ぶ前に `defineHandler` の `auth` を必ず通すこと。
 *
 * 実装は 2 つある。
 *   - `SupabaseStorageSigner`（packages/core/src/storage/supabase.ts）… 実 Supabase
 *   - `StubStorageSigner`（packages/core/src/storage/stub.ts）      … CI・テスト
 *
 * CI は stub で回す。クラウドセッションは実 Supabase に接続しない
 * （DEV_ENVIRONMENTS.md §4）。**stub で通ったことを実物で通ったと書かない。**
 */

export interface SignedUpload {
  /** バケット内のパス。`{match_id}/{sha256}.{ext}` */
  storagePath: string;
  /** バケット名。TUS の metadata（bucketName）に要る */
  bucket: string;
  /** TUS の宛先。`{直結ホスト}/storage/v1/upload/resumable` */
  tusEndpoint: string;
  /**
   * 署名トークン。**TUS の `x-signature` ヘッダに載せる。**
   * URL のクエリに付けるのは非 resumable の単発アップロード（uploadToSignedUrl）の方式であり、
   * こちらではない。
   */
  uploadToken: string;
  /** 発行時刻＋2時間（ISO 8601）。サーバが選んだ期限ではない（API_SPEC.md §2.3） */
  expiresAt: string;
}

export interface SignedPlayback {
  url: string;
  expiresAt: string;
}

export interface StorageSigner {
  /**
   * アップロード用の署名トークンを発行する。
   *
   * `upsert` は**呼び出し側（サーバ）が決める**。クライアントから受け取らない。
   * 新規は false、`purged_at` 入りの行の再アップロードだけ true（API_SPEC.md §2.2）。
   * 署名トークンは発行時に upsert が焼き込まれるため、後から選ばせる余地がない。
   */
  createUploadToken(storagePath: string, options: { upsert: boolean }): Promise<SignedUpload>;

  /** 再生用の短命な署名URL。**DBに保存しない。毎回発行する。** */
  createPlaybackUrl(storagePath: string, expiresInSeconds?: number): Promise<SignedPlayback>;

  /** 保持レベルA削除で使う（PRIVACY_RETENTION.md §4）。P3 では呼ばない */
  remove(storagePath: string): Promise<void>;
}

export class StorageError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "StorageError";
  }
}

/** ISO 8601（ミリ秒なし）。`expiresAt` の形を 1 箇所で決める */
export function expiresAtFrom(now: Date, seconds: number): string {
  return new Date(now.getTime() + seconds * 1000).toISOString();
}
