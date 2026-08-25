/**
 * マイグレーション適用。
 *
 * - 接続は DIRECT_URL（session mode / 5432・ロール app_migrator）。
 *   transaction mode では CREATE INDEX CONCURRENTLY などが通らない。
 * - クラウドセッションからは、セッション内 PostgreSQL 以外へ接続しない。
 *   本番への適用は GitHub Actions から行う（DEV_ENVIRONMENTS.md §2.2）。
 */
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { assertNotRealDatabaseFromCloudSession } from "../packages/core/src/db/client";

const url = process.env.DIRECT_URL;
if (!url) {
  console.error(
    "DIRECT_URL が未設定です。クラウドセッションでは scripts/install_pkgs.sh が .env.local を生成します。",
  );
  process.exit(1);
}

assertNotRealDatabaseFromCloudSession(url);

const sql = postgres(url, { max: 1, onnotice: (n) => console.log(`[notice] ${n.message}`) });

try {
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  const rows = await sql<{ current_user: string }[]>`SELECT current_user`;
  console.log(`マイグレーション適用完了（接続ロール: ${rows[0]?.current_user ?? "不明"}）`);
} finally {
  await sql.end();
}
