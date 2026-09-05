/**
 * エラーコードと HTTP の対応（API_SPEC.md §0.5）。
 *
 * 表そのものが仕様なので、仕様の値をそのまま並べて突き合わせる。
 * 実装から生成した表と比べても、写し間違いは見つからない。
 *
 * **突き合わせる表は 2 つある。**
 *   ERROR_STATUS … アプリのエラーコード → HTTP
 *   SQLSTATE     … DB の SQLSTATE      → アプリのエラーコード
 *
 * 片方だけを過不足なく見ても、もう片方への追加は黙って通る。
 * 実際、P4 で AD003 を足したとき、ERROR_STATUS 側の検査は緑のままだった
 * （SQLSTATE 側を誰も見ていなかったため）。両方を toEqual で固定する。
 */
import { describe, expect, it, vi } from "vitest";
import {
  ApiError,
  ERROR_STATUS,
  errorBody,
  SQLSTATE,
  toApiError,
} from "../../packages/core/src/http/errors";

/** API_SPEC.md §0.5 の表をそのまま書き写したもの */
const SPEC: Record<string, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  CONSENT_REQUIRED: 409,
  DECISION_LOCKED: 409,
  AUDIBILITY_UNRESOLVED: 409,
  STAGES_NOT_CONFIRMED: 409,
  JOB_ALREADY_RUNNING: 409,
  NODE_WITHOUT_SEGMENT: 422,
  INVALID_LINK_DIRECTION: 422,
  ISSUE_LIMIT_EXCEEDED: 422,
  UNSUPPORTED_IMPORT_SCHEMA: 422,
  RETENTION_PURGED: 410,
  RATE_LIMITED: 429,
  PROVIDER_ERROR: 502,
  INTERNAL: 500,
};

/**
 * SQLSTATE の定義と、それぞれが写る先。
 *
 * **SQLSTATE を足したら、ここにも足すまでテストが落ちる。**
 * 落ちない状態にしておくと、変換を書き忘れた SQLSTATE が
 * 500 INTERNAL として静かに本番へ出る。500 は「サーバの不具合」であって、
 * 「許諾が無い」「状態が動いた」ではない。呼び出し側が再試行の判断を誤る。
 *
 * INTERNAL に写るものは、意図してそうしている。
 *   AD002        … 追記専用テーブルの更新。起きた時点でサーバの不具合である
 *   23505 / 23514 / 23503 … ハンドラ側で捕まえて意味のある応答に変える
 *                           （例: POST /media の 23505 → already_exists）。
 *                           ここまで来たら、捕まえ忘れである
 */
const SQLSTATE_SPEC: Record<string, { code: string; mapsTo: string }> = {
  CONSENT_REQUIRED: { code: "AD001", mapsTo: "CONSENT_REQUIRED" },
  APPEND_ONLY: { code: "AD002", mapsTo: "INTERNAL" },
  INVALID_JOB_TRANSITION: { code: "AD003", mapsTo: "VERSION_CONFLICT" },
  INSUFFICIENT_PRIVILEGE: { code: "42501", mapsTo: "FORBIDDEN" },
  UNIQUE_VIOLATION: { code: "23505", mapsTo: "INTERNAL" },
  CHECK_VIOLATION: { code: "23514", mapsTo: "INTERNAL" },
  FOREIGN_KEY_VIOLATION: { code: "23503", mapsTo: "INTERNAL" },
};

describe("ERROR_STATUS", () => {
  it("API_SPEC.md §0.5 の表と一致する（過不足なく）", () => {
    expect(ERROR_STATUS).toEqual(SPEC);
  });
});

describe("SQLSTATE", () => {
  it("定義が SQLSTATE_SPEC と一致する（過不足なく）", () => {
    const defined = Object.fromEntries(
      Object.entries(SQLSTATE_SPEC).map(([name, { code }]) => [name, code]),
    );
    expect(SQLSTATE).toEqual(defined);
  });

  it("定義されている SQLSTATE はすべて、意図した ErrorCode へ写る", () => {
    for (const [name, { code, mapsTo }] of Object.entries(SQLSTATE_SPEC)) {
      expect(toApiError({ code }).code, `${name}（${code}）`).toBe(mapsTo);
    }
  });
});

describe("toApiError", () => {
  it("ApiError はそのまま通す", () => {
    const original = new ApiError("NOT_FOUND", "無い");
    expect(toApiError(original)).toBe(original);
  });

  it("SQLSTATE AD001 は CONSENT_REQUIRED（409）になる", () => {
    const converted = toApiError({ code: SQLSTATE.CONSENT_REQUIRED });
    expect(converted.code).toBe("CONSENT_REQUIRED");
    expect(converted.status).toBe(409);
  });

  it("SQLSTATE AD003 は VERSION_CONFLICT（409）になる", () => {
    // ジョブの状態遷移トリガ（TRANSCRIPTION.md §6.1）。
    // API 層が先に止めるのが正常で、ここへ来るのは競合したとき。
    // 500 にすると、再試行すべき競合がサーバの不具合に見える
    const converted = toApiError({ code: SQLSTATE.INVALID_JOB_TRANSITION });
    expect(converted.code).toBe("VERSION_CONFLICT");
    expect(converted.status).toBe(409);
  });

  it("RLS の WITH CHECK 違反（42501）は FORBIDDEN になる", () => {
    expect(toApiError({ code: SQLSTATE.INSUFFICIENT_PRIVILEGE }).code).toBe("FORBIDDEN");
  });

  it("未知の例外は INTERNAL になり、元のメッセージを持ち出さない", () => {
    // DB のエラーメッセージには行の中身が混じる。
    // そのまま返すと RLS で隠したはずのものが漏れる
    const converted = toApiError(new Error("actor 11111111 の motion は『秘密の論題』"));
    expect(converted.code).toBe("INTERNAL");
    expect(converted.message).not.toContain("秘密の論題");
  });

  it("null / undefined でも落ちない", () => {
    expect(toApiError(null).code).toBe("INTERNAL");
    expect(toApiError(undefined).code).toBe("INTERNAL");
  });
});

describe("errorBody", () => {
  it("失敗応答の形は { error: { code, message } }", () => {
    expect(errorBody(new ApiError("NOT_FOUND", "無い"))).toEqual({
      error: { code: "NOT_FOUND", message: "無い" },
    });
  });

  it("details があれば載せる", () => {
    expect(errorBody(new ApiError("VERSION_CONFLICT", "競合", { currentVersion: 3 }))).toEqual({
      error: { code: "VERSION_CONFLICT", message: "競合", details: { currentVersion: 3 } },
    });
  });
});

describe("ApiError", () => {
  it("code から HTTP を導く", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(new ApiError("VERSION_CONFLICT", "").status).toBe(409);
    expect(new ApiError("NODE_WITHOUT_SEGMENT", "").status).toBe(422);
  });
});
