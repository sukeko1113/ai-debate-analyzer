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
    // クラウドセッションから実 Supabase へは接続しない（DEV_ENVIRONMENTS.md §4）
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

describe("scripts/install_pkgs.sh（ローカル分岐が DB の準備までを面倒見る）", () => {
  // ローカルへ移行したときの実測（HANDOFF.md 件32〜34）:
  //   - .env.local が無く、db-migrate.ts はそれを読まないので DIRECT_URL が未設定です。で落ちた
  //   - ロールを手で CREATE した結果、42501 permission denied for database で落ちた
  // スクリプトは応答確認と bootstrap SQL・.env.local・migrate までを持ち、
  // コンテナのライフサイクル（起動・作成・削除）は持たない。
  const script = readFileSync(SCRIPT, "utf8");
  /** 案内文（heredoc GUIDE）とコメント行を除いた、実際に実行される部分 */
  const executable = script
    .replace(/<<GUIDE\n[\s\S]*?\nGUIDE\n/g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");

  it("docker コンテナを起動も作成もしない（案内文としてだけ現れる）", () => {
    expect(executable).not.toMatch(/docker (run|start)\b/);
  });

  it("応答が無いときの案内に、そのまま貼れる docker run の一行がある", () => {
    // 欠けた案内は復旧に使えない。POSTGRES_DB は渡さない（DB は db-bootstrap.sql が OWNER app_migrator で作る）
    expect(script).toMatch(
      /docker run -d --name \$\{PG_CONTAINER\} -e POSTGRES_PASSWORD=\$\{PG_PASS\} -p \$\{PG_PORT\}:5432 postgres:16/,
    );
    expect(script).not.toMatch(/POSTGRES_DB=/);
  });

  it("破壊操作を持ち込まない", () => {
    expect(script).not.toMatch(/docker rm|DROP DATABASE|DROP ROLE|DROP SCHEMA/);
  });

  it("既存の .env.local を上書きしない（ローカルの .env.local は実キーの唯一の置き場）", () => {
    expect(script).toMatch(/write_env_local keep/);
    expect(script).toMatch(/\[ -f \.env\.local \]/);
  });

  it("ロールを手で CREATE せず、CI・クラウドと同じ bootstrap SQL を流す", () => {
    expect(executable).not.toMatch(/CREATE ROLE/);
    expect(executable).toMatch(/db-bootstrap\.sql/);
    expect(executable).toMatch(/db-bootstrap-schema\.sql/);
  });

  it("package.json が無ければ DB にも docker にも触れずに終わる", () => {
    const local = script.slice(script.indexOf('!= "true" ]; then'), script.indexOf("pg_ready()"));
    expect(local).toMatch(/\[ -f package\.json \] \|\| exit 0/);
  });
});
