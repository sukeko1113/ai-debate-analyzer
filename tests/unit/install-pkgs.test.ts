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

describe("scripts/install_pkgs.sh がマイグレーションまで面倒を見る（P2 受け入れ基準7）", () => {
  // 対応前の実測（HANDOFF.md 件1）: 新しいクラウドセッションで最初に npm run test:db を叩くと
  //   PostgresError: function public.app_actor_id() does not exist
  //   Test Files  2 failed (2) / Tests  12 skipped (12)
  // で落ちていた。install_pkgs.sh が migrate を流さなかったためである。
  const script = readFileSync(SCRIPT, "utf8");

  it("db:migrate を実行する", () => {
    expect(script).toMatch(/npm run db:migrate/);
  });

  it("依存の導入がマイグレーションより前にある", () => {
    // migrate は tsx（node_modules）で走る。順序が逆だと初回セッションで必ず失敗する
    const npmCi = script.lastIndexOf("npm ci");
    const migrate = script.indexOf("npm run db:migrate");
    expect(npmCi).toBeGreaterThan(-1);
    expect(migrate).toBeGreaterThan(npmCi);
  });

  it("マイグレーションが失敗してもセッションを止めない", () => {
    // ここで exit 1 すると、マイグレーションを直したくても Claude Code が上がってこない
    const tail = script.slice(script.indexOf("npm run db:migrate"));
    expect(tail).toMatch(/warning:/);
    expect(tail.trimEnd().endsWith("exit 0")).toBe(true);
  });

  it("JWT の検証鍵を .env.local に書く（API が 500 にならないように）", () => {
    const heredoc = script.slice(script.indexOf("cat > .env.local"), script.indexOf("\nEOF"));
    expect(heredoc).toMatch(/^SUPABASE_JWT_SECRET=/m);
  });

  it("実 Supabase の接続先を書かない", () => {
    // クラウドセッションから実 Supabase へは接続しない（DEV_ENVIRONMENTS.md §2）
    expect(script).not.toMatch(/supabase\.co|pooler\.supabase\.com/);
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
