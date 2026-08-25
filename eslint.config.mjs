import next from "eslint-config-next";

/**
 * Next.js 16 の flat config を土台にする。
 * ここで足しているのは、この案件で守りたい境界の検査だけ。
 */
const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "drizzle/**",
      "schemas/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
    ],
  },
  ...next,
  {
    rules: {
      // DB アクセスに supabase-js を使わない（DATA_MODEL.md §0.1）。
      // 用途が Storage / Auth に限られることは tests/unit/db-client.test.ts で検査する。
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@supabase/supabase-js",
              message:
                "supabase-js は Storage と Auth 専用です。DB アクセスは postgres.js（packages/core/src/db）を使ってください。",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/core/src/storage/**", "packages/core/src/auth/**"],
    rules: { "no-restricted-imports": "off" },
  },
];

export default config;
