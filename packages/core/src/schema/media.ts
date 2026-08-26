/**
 * メディアのドメインスキーマ（DATA_MODEL.md §3 / API_SPEC.md §2 / TRANSCRIPTION.md §7）。
 *
 * 件6 の判断に従い、リクエスト用スキーマは「保存済みの形」から導出する。
 * サーバが決める列（id / storagePath / uploadedBy / purgedAt / createdAt）は
 * リクエスト側に現れない。
 */
import { z } from "zod";
import { Uuid } from "./ids";

/**
 * 受け付ける音声の mime（TRANSCRIPTION.md §7）。
 *
 * **動画の mime はここに無い。** ブラウザ内で抽出した音声も、この4値のいずれかで登録する。
 * 抽出由来であることは `origin: 'extracted_in_browser'` が示す。
 */
export const MediaMime = z.enum(["audio/mpeg", "audio/mp4", "audio/wav", "audio/x-m4a"]);
export type MediaMime = z.infer<typeof MediaMime>;

export const MediaOrigin = z.enum(["upload", "extracted_in_browser", "imported"]);
export type MediaOrigin = z.infer<typeof MediaOrigin>;

/** 入力規約の上限（TRANSCRIPTION.md §7）。Supabase Free のグローバル上限が50MBを超えられない */
export const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

/**
 * mime から拡張子を決める。
 *
 * **`filename` は申告値なので保存パスに混ぜない**（API_SPEC.md §2.1）。
 * `audio/mp4` と `audio/x-m4a` がどちらも m4a に落ちるのは問題ない。
 * 拡張子はパスの一部にすぎず、内容の判定には使わないためである。
 */
const MIME_TO_EXT: Record<MediaMime, string> = {
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "audio/x-m4a": "m4a",
};

export function extForMime(mime: MediaMime): string {
  return MIME_TO_EXT[mime];
}

/**
 * Storage の保存パス（バケット内）。`{match_id}/{sha256}.{ext}`。
 *
 * サーバだけが組み立てる。クライアントから受け取らない。
 */
export function storagePathFor(matchId: string, sourceSha256: string, mime: MediaMime): string {
  return `${matchId}/${sourceSha256}.${extForMime(mime)}`;
}

/** 小文字16進の SHA-256。大文字や truncate を通さない */
export const Sha256Hex = z
  .string()
  .length(64)
  .regex(/^[0-9a-f]{64}$/, "SHA-256 は小文字16進64文字で渡してください");

/** 保存済みの形（DATA_MODEL.md §3）。lock_version は持たない（同§「lock_version を持たない理由」） */
export const MediaSource = z.object({
  id: Uuid,
  matchId: Uuid,
  /** A削除時に null になる。行は消さない */
  storagePath: z.string().nullable(),
  sourceSha256: Sha256Hex,
  durationMs: z.number().int().positive(),
  mime: MediaMime,
  bitrate: z.number().int().nullable(),
  channels: z.number().int().nullable(),
  origin: MediaOrigin,
  /** 保持レベルC（氏名の匿名化）で null になる */
  uploadedBy: Uuid.nullable(),
  purgedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type MediaSource = z.infer<typeof MediaSource>;

// ---------------------------------------------------------------------------
// リクエスト / レスポンス（API_SPEC.md §2）
// ---------------------------------------------------------------------------

/**
 * アップロードの意思表示。
 *
 * **`sourceSha256` をここで受け取る。** 保存パスが `{match_id}/{sha256}.{ext}` であり、
 * サーバはハッシュを計算できない（ファイル本体がAPIを通らない）ためである。
 * クライアントが先にファイル全体を読んで計算する。
 *
 * **`upsert` は受け取らない。** サーバが `purged_at` の有無で決める（API_SPEC.md §2.2）。
 * 署名トークンは発行時に upsert が焼き込まれるため、後から選ばせる余地がない。
 * クライアントに上書きの可否を選ばせない、という意図でもある。
 */
export const UploadIntentReq = z.object({
  /** 表示用。保存パスには使わない */
  filename: z.string().min(1).max(255),
  byteSize: z.number().int().positive().max(MAX_MEDIA_BYTES),
  mime: MediaMime,
  sourceSha256: Sha256Hex,
});
export type UploadIntentReq = z.infer<typeof UploadIntentReq>;

/**
 * 判別可能なユニオン。`alreadyExists: boolean` ＋ nullable ではなく、
 * **型で分岐が強制される形**にする。
 */
export const UploadIntentRes = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    storagePath: z.string(),
    /** 直結ホスト。`{ref}.supabase.co` ではなく `{ref}.storage.supabase.co` */
    tusEndpoint: z.url(),
    /** TUS の `x-signature` ヘッダに載せる。URL 内のトークンではない */
    uploadToken: z.string().min(1),
    /**
     * サーバが選んだ期限ではない。Supabase の署名トークンは2時間固定で、
     * 指定する引数がない。これは「発行時刻＋2時間」である（API_SPEC.md §2.3）。
     */
    expiresAt: z.iso.datetime(),
  }),
  z.object({
    status: z.literal("already_exists"),
    mediaSourceId: Uuid,
  }),
]);
export type UploadIntentRes = z.infer<typeof UploadIntentRes>;

/** アップロード完了後の登録 */
export const RegisterMediaReq = MediaSource.pick({
  sourceSha256: true,
  durationMs: true,
  mime: true,
  bitrate: true,
  channels: true,
  origin: true,
}).extend({
  /** intent が返したもの。サーバ側で組み立て直して照合する */
  storagePath: z.string().min(1),
});
export type RegisterMediaReq = z.infer<typeof RegisterMediaReq>;

/**
 * 3通り（API_SPEC.md §2.2）。
 *
 * `restored` を `already_exists` と分けているのは、「一度消して入れ直した」ことが
 * 応答から分かるようにするためである。呼び出し側が `retention_events` を引かずに気づける。
 */
export const RegisterMediaRes = z.discriminatedUnion("status", [
  z.object({ status: z.literal("created"), mediaSourceId: Uuid }),
  z.object({ status: z.literal("restored"), mediaSourceId: Uuid }),
  z.object({ status: z.literal("already_exists"), mediaSourceId: Uuid }),
]);
export type RegisterMediaRes = z.infer<typeof RegisterMediaRes>;

/** 署名URLは毎回発行する。DBに保存しない（API_SPEC.md §2.4） */
export const PlaybackUrlRes = z.object({
  url: z.url(),
  expiresAt: z.iso.datetime(),
});
export type PlaybackUrlRes = z.infer<typeof PlaybackUrlRes>;
