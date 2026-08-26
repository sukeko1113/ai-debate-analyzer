/**
 * 音声の指紋（TASKS.md P3 / API_SPEC.md §2.1）。
 *
 * 保存パスが `{match_id}/{sha256}.{ext}` であり、**サーバはハッシュを計算できない**
 * （ファイル本体が API を通らない）。したがってクライアントが先に計算して intent へ渡す。
 *
 * 【「ストリーミング計算」について】
 * TASKS.md P3 は「Web Crypto で SHA-256 をストリーミング計算」と書いているが、
 * **Web Crypto には逐次更新の API が無い**（`crypto.subtle.digest` は入力全体を受け取る）。
 * 真にストリーミングにするには SHA-256 を自前で実装することになり、
 * 「暗号処理を手書きしない」より優先する理由が無い。
 *
 * 入力は 50MB 以下と決まっている（TRANSCRIPTION.md §7）ので、全体を読み込む。
 * 上限が無ければこの判断は成り立たない。上限を上げるときは、ここも見直すこと。
 */

/** 小文字16進64文字。DB の CHECK と Zod の Sha256Hex がこの形を要求する */
export function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const view: ArrayBuffer =
    data instanceof Uint8Array
      ? (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
      : data;
  return toHex(await crypto.subtle.digest("SHA-256", view));
}

/** ブラウザ側の入口。File / Blob をそのまま渡す */
export async function sha256HexOfBlob(blob: Blob): Promise<string> {
  return sha256Hex(await blob.arrayBuffer());
}
