/**
 * テスト・CI 用の署名（DEV_ENVIRONMENTS.md §2）。
 *
 * クラウドセッションは実 Supabase に接続しない。CI もキーを持たない。
 * したがって**契約の検査は stub で行い、実物の確認は人が行う**
 * （ACCEPTANCE.md H9・H10・H11）。
 *
 * このクラスは決定論的である。ランダムも時刻依存の分岐も持たない
 * （`expiresAt` の基準時刻だけは注入できる）。
 * 「テストのたびに値が変わる」と、何が壊れたのか分からなくなる。
 *
 * **stub で通ったことを「実 Supabase で動いた」と報告しない。**
 */
import { createHash } from "node:crypto";
import {
  DEFAULT_MEDIA_BUCKET,
  PLAYBACK_URL_TTL_SECONDS,
  SIGNED_UPLOAD_TTL_SECONDS,
  TUS_UPLOAD_PATH,
} from "./constants";
import {
  expiresAtFrom,
  type SignedPlayback,
  type SignedUpload,
  type StorageSigner,
} from "./signer";

export interface StubCall {
  storagePath: string;
  upsert: boolean;
}

export class StubStorageSigner implements StorageSigner {
  /** 発行の記録。`upsert` がサーバ側で決まっていることの検査に使う（M29） */
  readonly uploadCalls: StubCall[] = [];
  readonly removed: string[] = [];

  constructor(
    private readonly storageUrl = "https://stub-project.storage.supabase.co",
    private readonly bucket = DEFAULT_MEDIA_BUCKET,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createUploadToken(
    storagePath: string,
    options: { upsert: boolean },
  ): Promise<SignedUpload> {
    this.uploadCalls.push({ storagePath, upsert: options.upsert });
    // 実物のトークンは Storage が署名する。ここでは形だけを再現する。
    // upsert を混ぜてあるのは、発行時に焼き込まれることを形の上でも示すためである
    const token = createHash("sha256")
      .update(`${this.bucket}:${storagePath}:${options.upsert}`)
      .digest("hex");

    return {
      storagePath,
      tusEndpoint: `${this.storageUrl}${TUS_UPLOAD_PATH}`,
      uploadToken: token,
      expiresAt: expiresAtFrom(this.now(), SIGNED_UPLOAD_TTL_SECONDS),
    };
  }

  async createPlaybackUrl(
    storagePath: string,
    expiresInSeconds: number = PLAYBACK_URL_TTL_SECONDS,
  ): Promise<SignedPlayback> {
    const signature = createHash("sha256")
      .update(`${this.bucket}:${storagePath}:${expiresInSeconds}`)
      .digest("hex");

    return {
      url: `${this.storageUrl}/storage/v1/object/sign/${this.bucket}/${storagePath}?token=${signature}`,
      expiresAt: expiresAtFrom(this.now(), expiresInSeconds),
    };
  }

  async remove(storagePath: string): Promise<void> {
    this.removed.push(storagePath);
  }
}
