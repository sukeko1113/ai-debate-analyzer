/**
 * 画面B: メディア取り込み（TASKS.md P3）。
 *
 * ここで確かめるのは**画面の骨格と、区間再生を作っていないこと**だけである。
 * 送信までは含めない。CI の e2e ジョブには Postgres も Supabase Storage も無く、
 * API を叩くと必ず落ちるためである（画面A の e2e と同じ方針）。
 *
 * **音が鳴るか、意図した位置かは人にしか確かめられない**（ACCEPTANCE.md H1）。
 * 実際に上がるかも同様（H9〜H11）。このテストが緑でも「取り込めた」と書かない。
 */
import { expect, test } from "@playwright/test";

const MATCH_ID = "3f1d2a90-0000-4000-8000-000000000001";

test.beforeEach(async ({ page }) => {
  await page.goto(`/matches/${MATCH_ID}/media`);
});

test("ファイル選択・進捗・再生の3つが揃っている", async ({ page }) => {
  await expect(page.getByTestId("file")).toBeVisible();
  await expect(page.getByTestId("upload")).toBeVisible();
  await expect(page.getByTestId("phase")).toHaveText("待機中");
  await expect(page.getByTestId("player")).toBeAttached();
});

test("トークンとファイルが揃うまでアップロードできない", async ({ page }) => {
  const upload = page.getByTestId("upload");
  await expect(upload).toBeDisabled();

  await page.getByTestId("token").fill("dummy-token");
  // トークンだけでは押せない
  await expect(upload).toBeDisabled();
});

test("受け付ける形式が音声4種に絞られている（動画を選べない）", async ({ page }) => {
  const accept = await page.getByTestId("file").getAttribute("accept");
  expect(accept).toBe("audio/mpeg,audio/mp4,audio/wav,audio/x-m4a");
  expect(accept).not.toContain("video/");
});

test("区間再生のUIを作っていない（P10 の仕様である）", async ({ page }) => {
  // TRANSCRIPTION.md §7.2 は P10 のもの。P3 には区間の元データが無い。
  // 先に作ると、動かせないUIが残る
  await expect(page.getByRole("button", { name: /5秒前/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /この先30秒/ })).toHaveCount(0);
  await expect(page.getByText(/再生速度/)).toHaveCount(0);
});
