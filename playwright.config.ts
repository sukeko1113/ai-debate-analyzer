import { defineConfig, devices } from "@playwright/test";

/**
 * /dev/media-probe は開発サーバにしか存在しない（next.config.ts）ため、
 * webServer は `next dev` を使う。
 *
 * ブラウザの入手経路は実行場所で異なる。
 *   クラウドセッション: /opt/pw-browsers にプリインストール（PLAYWRIGHT_BROWSERS_PATH）。
 *                       ダウンロードは発生しない
 *   CI・デスクトップ:   npx playwright install --with-deps chromium
 *
 * そのため @playwright/test は 1.56.1 に完全固定してある。
 * プリインストールされているのは chromium-1194 で、これを要求するのが 1.56 系だからである。
 * 上げると要求リビジョンが変わり（1.57→1200 / 1.58→1208 / 1.59→1217 /
 * 1.60→1223 / 1.61→1228 / 1.62→1234）、セットアップスクリプトでの
 * ダウンロードが必要になって5分の制限に当たる。
 * 対応関係は tests/unit/playwright-pin.test.ts が検査する。
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- --port ${PORT} --hostname 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
