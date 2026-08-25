import { defineConfig } from "drizzle-kit";

/**
 * マイグレーションは session mode / direct（5432）で流す。
 * transaction mode（6543）では CREATE INDEX CONCURRENTLY などが通らない。
 * 接続ロールは app_migrator（テーブル所有者）。
 */
const url = process.env.DIRECT_URL;
if (!url) {
  throw new Error("DIRECT_URL が未設定です（マイグレーションは app_migrator で流します）");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./packages/core/src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
