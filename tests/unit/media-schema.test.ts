/**
 * メディアのスキーマと保存パス（ACCEPTANCE.md M27・M33・M34）。
 *
 * ここで確かめるのは音声を必要としない部分だけである。
 * 音が鳴るか、上がったものが再生できるかは人にしか確かめられない（H1・H9〜H11）。
 */
import { describe, expect, it } from "vitest";
import {
  MAX_MEDIA_BYTES,
  MediaMime,
  RegisterMediaReq,
  Sha256Hex,
  UploadIntentReq,
  extForMime,
  storagePathFor,
} from "../../packages/core/src/schema/media";
import { sha256Hex } from "../../packages/core/src/media/sha256";

const MATCH_ID = "3f1d2a90-0000-4000-8000-000000000001";
/** 空文字列の SHA-256（既知の値） */
const EMPTY_SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
/** 別の既知の値（"abc"）。パスの検査に使う */
const SHA = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

function intentBody(overrides: Record<string, unknown> = {}) {
  return {
    filename: "gold-01.mp3",
    byteSize: 1024,
    mime: "audio/mpeg",
    sourceSha256: SHA,
    ...overrides,
  };
}

describe("M34 SHA-256", () => {
  it("既知の入力に対して既知の値を返す（空）", async () => {
    expect(await sha256Hex(new Uint8Array([]))).toBe(EMPTY_SHA);
  });

  it("既知の入力に対して既知の値を返す（abc）", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe(SHA);
  });

  it("1バイト違えば値が変わる", async () => {
    const a = await sha256Hex(new TextEncoder().encode("abc"));
    const b = await sha256Hex(new TextEncoder().encode("abd"));
    expect(a).not.toBe(b);
  });

  it("Sha256Hex は小文字16進64文字だけを通す", () => {
    expect(Sha256Hex.safeParse(SHA).success).toBe(true);
    // 大文字は通さない。DB の CHECK（^[0-9a-f]{64}$）と食い違うと、
    // API を通ったのに INSERT で落ちる形になる
    expect(Sha256Hex.safeParse(SHA.toUpperCase()).success).toBe(false);
    expect(Sha256Hex.safeParse(SHA.slice(0, 63)).success).toBe(false);
    expect(Sha256Hex.safeParse(`${SHA}0`).success).toBe(false);
    expect(Sha256Hex.safeParse(`g${SHA.slice(1)}`).success).toBe(false);
  });
});

describe("M27 保存パスの組み立て", () => {
  it("mime から拡張子が決まる（4値すべて）", () => {
    expect(extForMime("audio/mpeg")).toBe("mp3");
    expect(extForMime("audio/wav")).toBe("wav");
    expect(extForMime("audio/mp4")).toBe("m4a");
    expect(extForMime("audio/x-m4a")).toBe("m4a");
  });

  it("パスは {match_id}/{sha256}.{ext}", () => {
    expect(storagePathFor(MATCH_ID, SHA, "audio/mpeg")).toBe(`${MATCH_ID}/${SHA}.mp3`);
  });

  it("filename はパスに現れない", () => {
    // 申告値をパスに混ぜないこと（API_SPEC.md §2.1）。
    // 混ぜると、拡張子や区切り文字を仕込まれた名前で別の場所を指せる
    const path = storagePathFor(MATCH_ID, SHA, "audio/mpeg");
    expect(path).not.toContain("gold-01");
    expect(path).not.toContain("..");
    expect(path.split("/")).toHaveLength(2);
  });

  it("同じ mime 群（mp4 / x-m4a）は同じパスになる", () => {
    expect(storagePathFor(MATCH_ID, SHA, "audio/mp4")).toBe(
      storagePathFor(MATCH_ID, SHA, "audio/x-m4a"),
    );
  });
});

describe("M33 入力規約", () => {
  it("4値の mime だけを通す", () => {
    for (const mime of MediaMime.options) {
      expect(UploadIntentReq.safeParse(intentBody({ mime })).success).toBe(true);
    }
    // 動画は受けない。ffmpeg.wasm の出力も音声 mime で登録する（TRANSCRIPTION.md §7.1）
    expect(UploadIntentReq.safeParse(intentBody({ mime: "video/mp4" })).success).toBe(false);
    expect(UploadIntentReq.safeParse(intentBody({ mime: "audio/ogg" })).success).toBe(false);
    expect(UploadIntentReq.safeParse(intentBody({ mime: "" })).success).toBe(false);
  });

  it("50MB ちょうどは通り、1バイト超えると落ちる", () => {
    expect(UploadIntentReq.safeParse(intentBody({ byteSize: MAX_MEDIA_BYTES })).success).toBe(true);
    expect(UploadIntentReq.safeParse(intentBody({ byteSize: MAX_MEDIA_BYTES + 1 })).success).toBe(
      false,
    );
  });

  it("byteSize が 0 や負の数は通らない", () => {
    expect(UploadIntentReq.safeParse(intentBody({ byteSize: 0 })).success).toBe(false);
    expect(UploadIntentReq.safeParse(intentBody({ byteSize: -1 })).success).toBe(false);
  });

  it("upsert を受け取る口が無い（サーバが purged_at で決める）", () => {
    const parsed = UploadIntentReq.parse(intentBody({ upsert: true }));
    expect(parsed).not.toHaveProperty("upsert");
  });

  it("RegisterMediaReq も同じ mime enum を使う（何でも通る口を作らない）", () => {
    const body = {
      storagePath: `${MATCH_ID}/${SHA}.mp3`,
      sourceSha256: SHA,
      durationMs: 2_520_000,
      mime: "audio/mpeg",
      bitrate: null,
      channels: null,
      origin: "upload",
    };
    expect(RegisterMediaReq.safeParse(body).success).toBe(true);
    expect(RegisterMediaReq.safeParse({ ...body, mime: "video/mp4" }).success).toBe(false);
    expect(RegisterMediaReq.safeParse({ ...body, mime: "application/octet-stream" }).success).toBe(
      false,
    );
  });

  it("durationMs は正の整数だけ", () => {
    const body = {
      storagePath: `${MATCH_ID}/${SHA}.mp3`,
      sourceSha256: SHA,
      durationMs: 0,
      mime: "audio/mpeg",
      bitrate: null,
      channels: null,
      origin: "upload",
    };
    expect(RegisterMediaReq.safeParse(body).success).toBe(false);
  });
});
