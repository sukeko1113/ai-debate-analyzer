import { defineConfig } from "vitest/config";

/**
 * unit: DB を必要としないテスト
 * db:   セッション内 PostgreSQL 16 に対して流すテスト（RLS・権限）
 *
 * db は同じプローブ表を作って落とすため、ファイル並列を切る。
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts", "packages/**/src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "db",
          environment: "node",
          include: ["tests/db/**/*.test.ts"],
          setupFiles: ["tests/db/setup.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
