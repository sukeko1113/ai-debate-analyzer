/**
 * RLS 検証用のプローブ表。
 *
 * マイグレーションには入れない。テストの中で app_migrator として作り、必ず落とす。
 * マイグレーションに入れると、削除が「覚えていれば消せる」に依存し、本番に残る。
 *
 * プローブ表をテスト時に作ることには、もう一つ意味がある。
 * 表を作ったあと GRANT を一切書かないので、app_server が読み書きできれば
 * P0 マイグレーションの ALTER DEFAULT PRIVILEGES が効いていることの証明になる。
 */
import postgres from "postgres";
import type { Sql } from "postgres";
import { createSqlClient, withActor } from "../../../packages/core/src/db/client";

/** ENABLE + FORCE。本番のテーブルと同じ設定 */
export const PROBE_FORCED = "__rls_probe";
/** ENABLE のみ（FORCE なし）。所有者が RLS を素通りすることを示すための比較対象 */
export const PROBE_UNFORCED = "__rls_probe_noforce";

export const ACTOR_A = "11111111-1111-4111-8111-111111111111";
export const ACTOR_B = "22222222-2222-4222-8222-222222222222";

/** アプリの接続（app_server / NOSUPERUSER・NOBYPASSRLS） */
export function serverClient(): Sql {
  return createSqlClient(process.env.DATABASE_URL!);
}

/** マイグレーションの接続（app_migrator / テーブル所有者） */
export function migratorClient(): Sql {
  return postgres(process.env.DIRECT_URL!, { max: 1, prepare: false, onnotice: () => {} });
}

export async function createProbeTables(sql: Sql): Promise<void> {
  await dropProbeTables(sql);

  for (const table of [PROBE_FORCED, PROBE_UNFORCED]) {
    await sql.unsafe(`
      CREATE TABLE public.${table} (
        id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_id uuid NOT NULL,
        note     text NOT NULL
      )`);
    // 種データは RLS を有効にする前に入れる。
    // FORCE を付けたあとでは、所有者である app_migrator 自身も INSERT できない。
    await sql.unsafe(
      `INSERT INTO public.${table} (actor_id, note) VALUES
         ($1, 'A の行'),
         ($2, 'B の行')`,
      [ACTOR_A, ACTOR_B],
    );
    await sql.unsafe(`
      ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;
      CREATE POLICY probe_rw ON public.${table} FOR ALL TO app_server
        USING (actor_id = public.app_actor_id())
        WITH CHECK (actor_id = public.app_actor_id());
    `);
  }

  // FORCE あり: 本番のテーブルと同じ設定。所有者にもポリシーを適用させる。
  // FORCE なしの表は、所有者が RLS を素通りすることを示すための比較対象として残す。
  await sql.unsafe(`ALTER TABLE public.${PROBE_FORCED} FORCE ROW LEVEL SECURITY`);

  // ここまで GRANT を 1 行も書いていない。app_server が読み書きできるなら、
  // P0 マイグレーションの ALTER DEFAULT PRIVILEGES が効いている。
}

export async function dropProbeTables(sql: Sql): Promise<void> {
  await sql.unsafe(`DROP TABLE IF EXISTS public.${PROBE_FORCED}`);
  await sql.unsafe(`DROP TABLE IF EXISTS public.${PROBE_UNFORCED}`);
}

/**
 * 「他人の行が見えない」ことの検証本体。
 *
 * この関数を、接続ロールを変えて呼ぶ。
 *   - app_server で呼ぶ  → 通る（RLS が効いている）
 *   - 所有者で呼ぶ       → 落ちる（RLS を素通りするので、テストが空回りしていた証拠）
 *
 * 検証内容そのものは接続ロールに依存しない。ここが同じでなければ比較にならない。
 */
export async function assertTenantIsolation(sql: Sql, table: string): Promise<void> {
  const rowsSeenByA = await withActor(sql, ACTOR_A, async (tx) => {
    return tx.unsafe<{ actor_id: string; note: string }[]>(
      `SELECT actor_id, note FROM public.${table} ORDER BY note`,
    );
  });

  if (rowsSeenByA.length === 0) {
    throw new Error(
      `${table}: actor A が自分の行すら見えていません（ポリシーか GRANT が無い可能性があります）`,
    );
  }
  const foreign = rowsSeenByA.filter((r) => r.actor_id !== ACTOR_A);
  if (foreign.length > 0) {
    throw new Error(
      `${table}: RLS が素通りしています。actor A に他人の行が ${foreign.length} 件見えました` +
        `（見えた行: ${foreign.map((r) => r.note).join(", ")}）`,
    );
  }

  // UPDATE / DELETE も同じく他人の行に届かないこと。SELECT だけ見ても足りない。
  const updated = await withActor(sql, ACTOR_A, async (tx) =>
    tx.unsafe(`UPDATE public.${table} SET note = 'tampered' WHERE actor_id = '${ACTOR_B}'`),
  );
  if (updated.count !== 0) {
    throw new Error(
      `${table}: RLS が素通りしています。他人の行を ${updated.count} 件 UPDATE できました`,
    );
  }

  const deleted = await withActor(sql, ACTOR_A, async (tx) =>
    tx.unsafe(`DELETE FROM public.${table} WHERE actor_id = '${ACTOR_B}'`),
  );
  if (deleted.count !== 0) {
    throw new Error(
      `${table}: RLS が素通りしています。他人の行を ${deleted.count} 件 DELETE できました`,
    );
  }
}

/**
 * P2 の表を空にする。
 *
 * 所有者（app_migrator）は FORCE ROW LEVEL SECURITY のためポリシー越しには読めないが、
 * TRUNCATE は行レベルの操作ではないので所有者の権限で通る。
 * テスト間の後始末専用であり、アプリの経路では使わない。
 */
export async function truncateMatchTables(sql: Sql): Promise<void> {
  await sql.unsafe(
    `TRUNCATE TABLE edit_logs, media_sources, match_members, match_access, matches, api_idempotency_keys CASCADE`,
  );
}
