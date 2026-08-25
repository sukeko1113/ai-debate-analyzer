/**
 * Playwright のバージョン固定と、プリインストール済みブラウザの対応関係。
 *
 * クラウドセッションの /opt/pw-browsers には chromium-1194 だけが入っている。
 * これは playwright 1.56 系が要求するリビジョンである。
 * @playwright/test を上げると要求リビジョンが変わり、プリインストールが使えなくなる。
 * するとセットアップスクリプトでブラウザをダウンロードすることになり、
 * 5分の制限（超えると環境キャッシュが作られない）に当たる。
 *
 * 上げること自体を禁じるものではない。上げるなら、
 *   1. EXPECTED_CHROMIUM_REVISION を新しい値にする
 *   2. scripts/setup-cloud-env.sh に playwright install を戻す
 *      （そのうえで5分に収まるか測る）
 * を同時にやる、という取り決めを機械で担保するためのテストである。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** /opt/pw-browsers に入っているビルド（chromium-1194） */
const EXPECTED_CHROMIUM_REVISION = "1194";
const EXPECTED_PLAYWRIGHT_VERSION = "1.56.1";

interface BrowsersJson {
  browsers: { name: string; revision: string }[];
}

describe("Playwright のバージョン固定", () => {
  it("package.json で完全固定されている（^ や ~ を付けない）", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.devDependencies["@playwright/test"]).toBe(EXPECTED_PLAYWRIGHT_VERSION);
  });

  it("要求する chromium が、プリインストール済みのビルドと一致する", () => {
    const browsers: BrowsersJson = JSON.parse(
      readFileSync("node_modules/playwright-core/browsers.json", "utf8"),
    );
    const chromium = browsers.browsers.find((b) => b.name === "chromium");

    expect(chromium?.revision).toBe(EXPECTED_CHROMIUM_REVISION);
  });

  it("固定理由が package.json に書いてある", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.$comments?.["@playwright/test"]).toMatch(/1194/);
  });
});
