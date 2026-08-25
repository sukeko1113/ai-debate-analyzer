/**
 * SessionStart フックが余計なファイルを作らないこと。
 *
 * package.json が無い状態で `npm ci` を走らせると、依存ゼロの package-lock.json が
 * できてしまう（P0 着手前に実際に起きた）。ガードが効いていることを確かめる。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve("scripts/install_pkgs.sh");
let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "install-pkgs-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("scripts/install_pkgs.sh が生成する .env.local", () => {
  it("NODE_ENV を書かない", () => {
    // export された NODE_ENV=development のまま next build を走らせると、
    // React の本番/開発が食い違って /_global-error のプリレンダで落ちる。
    const script = readFileSync(SCRIPT, "utf8");
    const heredoc = script.slice(script.indexOf("cat > .env.local"), script.indexOf("\nEOF"));
    expect(heredoc).not.toMatch(/^NODE_ENV=/m);
  });
});

describe("scripts/install_pkgs.sh（ローカル分岐）", () => {
  it("package.json が無いディレクトリで実行しても何も作らない", () => {
    execFileSync("bash", [SCRIPT], {
      cwd,
      env: { ...process.env, CLAUDE_CODE_REMOTE: "false" },
      stdio: "ignore",
    });

    expect(readdirSync(cwd)).toEqual([]);
  });
});
