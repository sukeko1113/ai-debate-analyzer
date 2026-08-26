/**
 * エラーコードと HTTP の対応（API_SPEC.md §0.5）。
 *
 * 応答の形は失敗時 `{ error: { code, message, details } }` の一本だけ。
 * ここに無いコードを route が勝手に足さない。API がセキュリティ境界そのものであり、
 * クライアントはこの表だけを見て分岐する。
 */

export const ERROR_STATUS = {
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
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return ERROR_STATUS[this.code];
  }
}

/**
 * マイグレーションが定義した独自 SQLSTATE（drizzle/0001_p2_match_core.sql）。
 * 'AD' で始まるクラスは Postgres の標準エラークラスに無い。
 */
export const SQLSTATE = {
  /** 許諾未記録のまま解析へ進もうとした */
  CONSENT_REQUIRED: "AD001",
  /** 追記専用テーブルを UPDATE / DELETE しようとした */
  APPEND_ONLY: "AD002",
  /** RLS の WITH CHECK 違反 / 権限不足 */
  INSUFFICIENT_PRIVILEGE: "42501",
  UNIQUE_VIOLATION: "23505",
  CHECK_VIOLATION: "23514",
  FOREIGN_KEY_VIOLATION: "23503",
} as const;

function sqlstateOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * 例外を ApiError へ写す（defineHandler の担保 6）。
 *
 * 未知の例外は 500 INTERNAL にし、**本文をクライアントへ返さない**。
 * DB のエラーメッセージには行の中身が混じることがあり、
 * そのまま返すと RLS で隠したはずのものが漏れる。
 */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  switch (sqlstateOf(error)) {
    case SQLSTATE.CONSENT_REQUIRED:
      return new ApiError(
        "CONSENT_REQUIRED",
        "許諾が記録されていないため、解析を開始できません（API_SPEC.md §0.5）",
      );
    case SQLSTATE.APPEND_ONLY:
      return new ApiError("INTERNAL", "追記専用テーブルを更新しようとしました");
    case SQLSTATE.INSUFFICIENT_PRIVILEGE:
      // RLS の WITH CHECK 違反。書き込もうとした行が自分の領域の外にある
      return new ApiError("FORBIDDEN", "この操作は許可されていません");
    default:
      return new ApiError("INTERNAL", "サーバ内部エラー");
  }
}

export interface ErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}

export function errorBody(error: ApiError): ErrorBody {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    },
  };
}
