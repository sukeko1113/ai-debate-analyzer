/**
 * メディア要素の currentTime が意図した位置に来ること（P0 受け入れ基準 ⑤）。
 *
 * ここで検証できるのは位置だけである。
 * **音が鳴るか、その位置の発言が意図したものかは人にしか確かめられない**
 * （ACCEPTANCE.md H1 / G1）。テストが緑でも「再生を確認した」とは書かない。
 */
import { expect, test } from "@playwright/test";

const TOLERANCE = 0.05;

async function openProbe(page: import("@playwright/test").Page) {
  await page.goto("/dev/media-probe");
  const audio = page.getByTestId("probe-audio");
  await expect(audio).toHaveAttribute("data-ready", "true");
  return audio;
}

/** DOM の実値を読む。表示用の属性だけを信じない */
function currentTimeOf(audio: import("@playwright/test").Locator) {
  return audio.evaluate((el) => (el as HTMLAudioElement).currentTime);
}

test("メタデータが読め、長さが取得できる", async ({ page }) => {
  const audio = await openProbe(page);
  const duration = await audio.evaluate((el) => (el as HTMLAudioElement).duration);
  expect(duration).toBeGreaterThan(19);
  expect(duration).toBeLessThan(21);
});

test("区間の開始位置へ移動すると currentTime がその位置に来る", async ({ page }) => {
  const audio = await openProbe(page);

  await page.getByTestId("seek-seg-2").click();

  expect(await currentTimeOf(audio)).toBeCloseTo(12.5, 1);
  await expect(page.getByTestId("probe-current-time")).toHaveText(/^12\.5/);
});

test("複数の区間を続けて指定しても、そのつど指定位置に来る", async ({ page }) => {
  const audio = await openProbe(page);

  for (const { id, expected } of [
    { id: "seek-seg-3", expected: 18.25 },
    { id: "seek-seg-1", expected: 0.5 },
    { id: "seek-seg-2", expected: 12.5 },
  ]) {
    await page.getByTestId(id).click();
    const actual = await currentTimeOf(audio);
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(TOLERANCE);
  }
});

test("区間再生を押すと開始位置から始まり、終了位置で止まる", async ({ page }) => {
  const audio = await openProbe(page);

  await page.getByTestId("play-seg-1").click();

  // 開始位置に合っていること
  expect(await currentTimeOf(audio)).toBeGreaterThanOrEqual(0.5 - TOLERANCE);

  // 終了位置を過ぎたら止まること（音は聞けないが、停止位置は検証できる）
  await expect
    .poll(async () => audio.evaluate((el) => (el as HTMLAudioElement).paused), { timeout: 10_000 })
    .toBe(true);
  const stopped = await currentTimeOf(audio);
  expect(stopped).toBeGreaterThanOrEqual(2.0 - TOLERANCE);
  expect(stopped).toBeLessThan(4.0);
});

test("production ビルドに含めないページなので、開発サーバでのみ 200 を返す", async ({
  request,
}) => {
  // 開発サーバに対して実行している前提の確認。
  // production ビルドに現れないことは scripts/check-dev-routes.ts が検査する。
  const response = await request.get("/dev/media-probe");
  expect(response.status()).toBe(200);
});
