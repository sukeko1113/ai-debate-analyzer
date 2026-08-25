/**
 * check-no-real-data が実データ混入を検出すること（P0 受け入れ基準 ④）。
 *
 * ダミーの .mp3 は .gitignore の対象なのでリポジトリに置けない。
 * テストの中で一時ディレクトリに作り、終わったら消す。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanForRealData } from "../../scripts/lib/no-real-data";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "no-real-data-"));
  mkdirSync(path.join(root, "fixtures", "gold-01"), { recursive: true });
  writeFileSync(path.join(root, "README.md"), "# 合成データだけを置く\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** CLI として実行し、終了コードを見る。「失敗する」の実体はこれ。 */
function runCli(target: string): { status: number; output: string } {
  try {
    const stdout = execFileSync("npx", ["tsx", "scripts/check-no-real-data.ts", target], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, output: stdout };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

describe("check-no-real-data", () => {
  it("実データが無ければ終了コード 0", () => {
    const result = runCli(root);
    expect(result.status).toBe(0);
  });

  it("ダミーの .mp3 を検出して終了コード 1 で失敗する", () => {
    writeFileSync(path.join(root, "match-2024-final.mp3"), "dummy audio bytes");

    const result = runCli(root);

    expect(result.status).toBe(1);
    expect(result.output).toContain("match-2024-final.mp3");
    expect(result.output).toContain("[media]");
  });

  it("サブディレクトリに隠した .mp4 も検出する", () => {
    mkdirSync(path.join(root, "app", "assets"), { recursive: true });
    writeFileSync(path.join(root, "app/assets/round3.mp4"), "dummy video bytes");

    const violations = scanForRealData(root);

    expect(violations.map((v) => v.file)).toContain("app/assets/round3.mp4");
  });

  it("fixtures/ の外の *.speakers.json を検出する", () => {
    writeFileSync(path.join(root, "meeting.speakers.json"), "{}");

    const violations = scanForRealData(root);

    expect(violations).toContainEqual(
      expect.objectContaining({ kind: "speakers-json", file: "meeting.speakers.json" }),
    );
  });

  it("大容量ファイルを検出する（実試合の音声は数十MBになる）", () => {
    writeFileSync(path.join(root, "fixtures/gold-01/gold-01.mp3"), Buffer.alloc(1024 * 64));

    // fixtures 配下なので拡張子では止めないが、上限を超えれば止まる
    expect(scanForRealData(root, { maxFileBytes: 1024 * 1024 })).toHaveLength(0);
    expect(scanForRealData(root, { maxFileBytes: 1024 })).toContainEqual(
      expect.objectContaining({ kind: "large-file" }),
    );
  });

  it("fixtures/ の中の連絡先らしき文字列を検出する", () => {
    writeFileSync(
      path.join(root, "fixtures/gold-01/speakers.json"),
      JSON.stringify({ contact: "coach@example.school.jp" }),
    );

    const violations = scanForRealData(root);

    expect(violations).toContainEqual(expect.objectContaining({ kind: "contact-in-fixture" }));
  });

  it("このリポジトリ自身は違反ゼロである", () => {
    expect(scanForRealData(process.cwd())).toEqual([]);
  });
});
