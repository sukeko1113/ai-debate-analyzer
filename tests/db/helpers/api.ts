/**
 * API テストの足場。
 *
 * defineHandler が返すのは素の `(request, context) => Promise<Response>` なので、
 * Next のサーバを起動せずに、実際の route.ts をそのまま呼べる。
 * DB も RLS も本物である（セッション内 PostgreSQL 16）。
 * 「ハンドラを模したもの」ではなく、出荷する route を通していることが要点。
 */
import { randomUUID } from "node:crypto";
import { signJwtHs256 } from "../../../packages/core/src/auth/jwt";
import type { RouteContext } from "../../../packages/core/src/http/define-handler";
import { withActor } from "../../../packages/core/src/db/client";
import { serverClient } from "./probe";

export const BASE = "http://localhost/api/v1";

export function newActorId(): string {
  return randomUUID();
}

export function tokenFor(actorId: string, overrides: Record<string, unknown> = {}): string {
  const secret = process.env.SUPABASE_JWT_SECRET!;
  return signJwtHs256(
    {
      sub: actorId,
      role: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...overrides,
    },
    secret,
  );
}

export interface CallOptions {
  actorId?: string;
  token?: string;
  body?: unknown;
  params?: Record<string, string>;
  headers?: Record<string, string>;
  idempotencyKey?: string;
}

export interface CallResult<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
}

type Route = (request: Request, context?: RouteContext) => Promise<Response>;

export async function call<T = unknown>(
  route: Route,
  method: string,
  path: string,
  options: CallOptions = {},
): Promise<CallResult<T>> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...options.headers,
  };

  if (options.token !== undefined) {
    if (options.token) headers.authorization = `Bearer ${options.token}`;
  } else if (options.actorId) {
    headers.authorization = `Bearer ${tokenFor(options.actorId)}`;
  }
  if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;

  const request = new Request(`${BASE}${path}`, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });

  const response = await route(request, {
    params: Promise.resolve(options.params ?? {}),
  });

  const text = await response.text();
  return {
    status: response.status,
    body: (text ? JSON.parse(text) : undefined) as T,
    headers: response.headers,
  };
}

/**
 * app_server 接続で、actor を設定して読む。
 *
 * 検証を app_migrator（テーブル所有者）で行わないこと。
 * 全表に FORCE ROW LEVEL SECURITY が付いており、所有者向けのポリシーは無いので、
 * 所有者では 0 行しか返らず「件数を数えたつもりで何も見ていない」状態になる。
 */
export async function readAsActor<T>(
  actorId: string,
  fn: (tx: import("postgres").TransactionSql) => Promise<T>,
): Promise<T> {
  const sql = serverClient();
  try {
    return await withActor(sql, actorId, fn);
  } finally {
    await sql.end();
  }
}
