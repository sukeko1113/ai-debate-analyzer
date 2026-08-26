/**
 * エラーコードと HTTP の対応（API_SPEC.md §0.5）。
 *
 * 表そのものが仕様なので、仕様の値をそのまま並べて突き合わせる。
 * 実装から生成した表と比べても、写し間違いは見つからない。
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

describe("ERROR_STATUS", () => {
  it("API_SPEC.md §0.5 の表と一致する（過不足なく）", () => {
    expect(ERROR_STATUS).toEqual(SPEC);
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
