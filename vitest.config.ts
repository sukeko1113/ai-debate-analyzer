import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * unit: DB を必要としないテスト
 * db:   セッション内 PostgreSQL 16 に対して流すテスト（RLS・権限・API）
 *
 * db は同じ表を作って落とすため、ファイル並列を切る。
 */

/** tsconfig.json の paths と同じ対応。app/api の route.ts が @core/* で import する */
const alias = { "@core": path.resolve(import.meta.dirname, "packages/core/src") };

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts", "packages/**/src/**/*.test.ts"],
        },
      },
      {
        resolve: { alias },
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
