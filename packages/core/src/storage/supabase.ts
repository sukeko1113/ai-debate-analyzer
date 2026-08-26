/**
 * 実 Supabase Storage への署名（TRANSCRIPTION.md §7.3）。
 *
 * **supabase-js を使ってよいのは Storage と Auth だけである**（DATA_MODEL.md §0.1）。
 * DB アクセスには使わない。eslint の no-restricted-imports と
 * tests/unit/db-client.test.ts（ACCEPTANCE.md M35）が、この境界を検査している。
 *
 * service role key を使う。**ブラウザには渡さない。**
 * ブラウザに anon key でのバケット書き込み権限を与えないための構成である。
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PLAYBACK_URL_TTL_SECONDS, SIGNED_UPLOAD_TTL_SECONDS, TUS_UPLOAD_PATH } from "./constants";
import {
  StorageError,
  expiresAtFrom,
  type SignedPlayback,
  type SignedUpload,
  type StorageSigner,
} from "./signer";

export interface SupabaseStorageConfig {
  /** supabase-js の宛先。`https://<ref>.supabase.co` */
  supabaseUrl: string;
  /** TUS の宛先ホスト。`https://<ref>.storage.supabase.co`（直結ホスト） */
  storageUrl: string;
  serviceRoleKey: string;
  bucket: string;
}

export class SupabaseStorageSigner implements StorageSigner {
  private readonly client: SupabaseClient;

  constructor(private readonly config: SupabaseStorageConfig) {
    this.client = createClient(config.supabaseUrl, config.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async createUploadToken(
    storagePath: string,
    options: { upsert: boolean },
  ): Promise<SignedUpload> {
    const { data, error } = await this.client.storage
      .from(this.config.bucket)
      .createSignedUploadUrl(storagePath, { upsert: options.upsert });

    if (error || !data) {
      throw new StorageError(`アップロードトークンを発行できませんでした（${storagePath}）`, error);
    }

    return {
      storagePath,
      tusEndpoint: `${this.config.storageUrl.replace(/\/+$/, "")}${TUS_UPLOAD_PATH}`,
      uploadToken: data.token,
      // 有効期間は Supabase 側で 2 時間に固定されている。こちらでは選べない
      expiresAt: expiresAtFrom(new Date(), SIGNED_UPLOAD_TTL_SECONDS),
    };
  }

  async createPlaybackUrl(
    storagePath: string,
    expiresInSeconds: number = PLAYBACK_URL_TTL_SECONDS,
  ): Promise<SignedPlayback> {
    const { data, error } = await this.client.storage
      .from(this.config.bucket)
      .createSignedUrl(storagePath, expiresInSeconds);

    if (error || !data) {
      throw new StorageError(`再生用の署名URLを発行できませんでした（${storagePath}）`, error);
    }

    return {
      url: data.signedUrl,
      expiresAt: expiresAtFrom(new Date(), expiresInSeconds),
    };
  }

  async remove(storagePath: string): Promise<void> {
    const { error } = await this.client.storage.from(this.config.bucket).remove([storagePath]);
    if (error) {
      throw new StorageError(`メディアを削除できませんでした（${storagePath}）`, error);
    }
  }
}
