/**
 * DB 接続（DATA_MODEL.md §0 / BASIC_DESIGN_v04 §4.2）。
 *
 * 経路は一本だけ:
 *   Next.js Server → Supavisor プーラー（transaction mode / 6543）→ Postgres
 *
 * - `prepare: false` は必須。transaction mode は prepared statement を使えない。
 *   指定を忘れると本番でだけ落ちる（tests/unit/db-client.test.ts で検証する）。
 * - `supabase-js` を DB アクセスに使わない。service role key は Storage と Auth 専用。
 * - RLS を効かせるため、接続ロールは app_server（NOSUPERUSER / NOBYPASSRLS）。
 *   各リクエストはトランザクションを開き、最初に app.actor_id を設定する（withActor）。
 */
import postgres from "postgres";
import type { Sql, TransactionSql } from "postgres";
import type { EnvSource } from "../env";

/** postgres.js に渡す設定。テストから同一の値を検証できるよう定数として公開する。 */
export const POSTGRES_OPTIONS = {
  /** Supavisor transaction mode では prepared statement が使えない */
  prepare: false,
  /** サーバレスでは接続を溜めない */
  max: 1,
  idle_timeout: 20,
} as const;

/**
 * クラウドセッションから実 Supabase へ接続しない（DEV_ENVIRONMENTS.md §2）。
 * 方針を文書だけに置くと破れるので、接続時に落とす。
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "postgres", "db"]);

export function assertNotRealDatabaseFromCloudSession(
  url: string,
  env: EnvSource = process.env,
): void {
  if (env.CLAUDE_CODE_REMOTE !== "true") return;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("DATABASE_URL を URL として解釈できません");
  }
  if (LOCAL_HOSTS.has(host)) return;
  throw new Error(
    `クラウドセッションからセッション外の DB (${host}) へ接続しようとしました。` +
      `実 Supabase へは接続しません（DEV_ENVIRONMENTS.md §2）。` +
      `DB の検証はセッション内の PostgreSQL 16 で行ってください。`,
  );
}

export function createSqlClient(url: string, env: EnvSource = process.env): Sql {
  assertNotRealDatabaseFromCloudSession(url, env);
  return postgres(url, { ...POSTGRES_OPTIONS });
}

/**
 * トランザクションを開き、最初に app.actor_id を設定してから処理を実行する。
 * RLS ポリシーはこの値を見る。`SET LOCAL` はトランザクション内に閉じるので
 * transaction mode のプーラーでも安全に使える。
 *
 * `SET LOCAL` はパラメータを取れないため `set_config(..., true)` を使う。
 * 文字列連結で SQL を組み立てない。
 */
export async function withActor<T>(
  sql: Sql,
  actorId: string,
  fn: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('app.actor_id', ${actorId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}
