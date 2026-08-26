/**
 * 画面A（試合登録）で担当者表が team_size に応じて切り替わること
 * （TASKS.md P2 受け入れ基準5 / BASIC_DESIGN_v05 §15「音の確認が必要: 不要」）。
 *
 * ここで検証するのは表示の切り替えと入力欄の増減だけである。
 * DB へは触れない（CI の e2e ジョブに Postgres が無いため、
 * 送信までを e2e に含めない）。送信の検証は tests/db/api-matches.test.ts が
 * 実際の route を叩いて行っている。
 *
 * 画面の見た目（レイアウトが崩れないか）は人にしか確かめられない。
 */
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/matches/new");
  await expect(page.getByTestId("match-form")).toBeVisible();
});

test("既定は4人チームで、⑪肯定総括の担当は A4", async ({ page }) => {
  await expect(page.getByTestId("team-size-4")).toBeChecked();
  await expect(page.getByTestId("roster-seat-11")).toContainText("A4");
  await expect(page.getByTestId("roster-seat-12")).toContainText("N4");
});

test("3人チームに切り替えると ⑪肯定総括の担当が A1 になる", async ({ page }) => {
  await page.getByTestId("team-size-3").check();

  await expect(page.getByTestId("roster-seat-11")).toContainText("A1");
  await expect(page.getByTestId("roster-seat-12")).toContainText("N1");
});

test("4人と3人で担当が変わるのは ②④⑪⑫ の4ステージだけ", async ({ page }) => {
  const seats = async () => {
    const values: string[] = [];
    for (let stage = 1; stage <= 12; stage++) {
      values.push(((await page.getByTestId(`roster-seat-${stage}`).textContent()) ?? "").trim());
    }
    return values;
  };

  const four = await seats();
  await page.getByTestId("team-size-3").check();
  const three = await seats();

  const changed = four
    .map((seat, index) => (seat === three[index] ? null : index + 1))
    .filter((n): n is number => n !== null);
  expect(changed).toEqual([2, 4, 11, 12]);
});

test("3人チームでは A4 / N4 の入力欄が消える", async ({ page }) => {
  await expect(page.getByTestId("seat-A4")).toBeVisible();
  await expect(page.getByTestId("seat-N4")).toBeVisible();

  await page.getByTestId("team-size-3").check();

  await expect(page.getByTestId("seat-A4")).toHaveCount(0);
  await expect(page.getByTestId("seat-N4")).toHaveCount(0);
  await expect(page.getByTestId("seat-A3")).toBeVisible();
});

test("担当者表は12ステージ分ある", async ({ page }) => {
  await expect(page.getByTestId("roster-table").locator("tbody tr")).toHaveCount(12);
});
