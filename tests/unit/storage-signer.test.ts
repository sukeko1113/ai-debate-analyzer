/**
 * Storage 層の契約（TRANSCRIPTION.md §7.3）。
 *
 * **ここで確かめているのは stub の挙動と定数だけである。**
 * 実 Supabase の署名が通るか、バケットのポリシーを迂回するかは
 * 人が実物で確かめる（ACCEPTANCE.md H9）。stub が緑でも「動いた」と書かない。
 */
import { describe, expect, it } from "vitest";
import {
  PLAYBACK_URL_TTL_SECONDS,
  SIGNED_UPLOAD_TTL_SECONDS,
  TUS_CHUNK_SIZE,
  TUS_UPLOAD_PATH,
} from "../../packages/core/src/storage/constants";
import { StubStorageSigner } from "../../packages/core/src/storage/stub";
import { expiresAtFrom } from "../../packages/core/src/storage/signer";
import { bucketName } from "../../packages/core/src/storage";

const FIXED_NOW = new Date("2026-08-26T00:00:00.000Z");

describe("定数", () => {
  it("TUS のチャンクサイズは 6MB 固定である", () => {
    // 公式に `it must be set to 6MB (for now) do not change it` とある。
    // ここが変わっていたら、変えた理由を TRANSCRIPTION.md §7.3 に書いてから通すこと
    expect(TUS_CHUNK_SIZE).toBe(6 * 1024 * 1024);
  });

  it("署名アップロードトークンの有効期間は 2 時間である（Supabase 側の固定値）", () => {
    expect(SIGNED_UPLOAD_TTL_SECONDS).toBe(7200);
  });

  it("再生用URLの既定は 15 分である（こちらが選んだ値）", () => {
    expect(PLAYBACK_URL_TTL_SECONDS).toBe(900);
  });

  it("TUS のパスは /storage/v1/upload/resumable", () => {
    expect(TUS_UPLOAD_PATH).toBe("/storage/v1/upload/resumable");
  });
});

describe("expiresAt", () => {
  it("発行時刻＋秒数で決まる（サーバが期限を選んでいるわけではない）", () => {
    expect(expiresAtFrom(FIXED_NOW, SIGNED_UPLOAD_TTL_SECONDS)).toBe("2026-08-26T02:00:00.000Z");
    expect(expiresAtFrom(FIXED_NOW, PLAYBACK_URL_TTL_SECONDS)).toBe("2026-08-26T00:15:00.000Z");
  });
});

describe("StubStorageSigner", () => {
  function signer() {
    return new StubStorageSigner("https://stub.storage.supabase.co", "media", () => FIXED_NOW);
  }

  it("直結ホストの resumable エンドポイントを返す", async () => {
    const signed = await signer().createUploadToken("m/abc.mp3", { upsert: false });
    expect(signed.tusEndpoint).toBe("https://stub.storage.supabase.co/storage/v1/upload/resumable");
    expect(signed.bucket).toBe("media");
    expect(signed.storagePath).toBe("m/abc.mp3");
    expect(signed.expiresAt).toBe("2026-08-26T02:00:00.000Z");
  });

  it("upsert の値が発行時に焼き込まれる（トークンが変わる）", async () => {
    // 実物でも upsert は createSignedUploadUrl の引数であり、後から変えられない。
    // stub でも「別の値なら別のトークン」にしてある
    const s = signer();
    const off = await s.createUploadToken("m/abc.mp3", { upsert: false });
    const on = await s.createUploadToken("m/abc.mp3", { upsert: true });
    expect(off.uploadToken).not.toBe(on.uploadToken);
  });

  it("発行を記録する（サーバが upsert を決めていることの検査に使う）", async () => {
    const s = signer();
    await s.createUploadToken("m/a.mp3", { upsert: false });
    await s.createUploadToken("m/b.mp3", { upsert: true });
    expect(s.uploadCalls).toEqual([
      { storagePath: "m/a.mp3", upsert: false },
      { storagePath: "m/b.mp3", upsert: true },
    ]);
  });

  it("再生URLは毎回組み立てる（保存しない）", async () => {
    const signed = await signer().createPlaybackUrl("m/abc.mp3");
    expect(signed.url).toContain("/storage/v1/object/sign/media/m/abc.mp3");
    expect(signed.expiresAt).toBe("2026-08-26T00:15:00.000Z");
  });
});

describe("バケット名", () => {
  it("既定は media", () => {
    expect(bucketName({ SUPABASE_STORAGE_BUCKET: undefined as unknown as string })).toBe("media");
  });

  it("env の値が優先される", () => {
    expect(bucketName({ SUPABASE_STORAGE_BUCKET: "media-staging" })).toBe("media-staging");
  });
});
