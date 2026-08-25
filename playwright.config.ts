import { defineConfig, devices } from "@playwright/test";

/**
 * /dev/media-probe は開発サーバにしか存在しない（next.config.ts）ため、
 * webServer は `next dev` を使う。
 *
 * クラウドセッションでは Playwright のブラウザが /opt/pw-browsers に
 * プリインストールされている（PLAYWRIGHT_BROWSERS_PATH）。
 * @playwright/test のバージョンは、そのビルド（chromium-1194）に合わせて固定する。
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
