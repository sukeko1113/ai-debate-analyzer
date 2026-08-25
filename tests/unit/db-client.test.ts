/**
 * DB 接続方式（P0 受け入れ基準 ③ / ACCEPTANCE.md M17）。
 *
 * - postgres.js に prepare: false が設定されていること。
 *   Supavisor transaction mode（6543）は prepared statement を使えない。
 *   設定を忘れると本番でだけ落ちるので、grep ではなく実際のクライアントの
 *   options を読んで確かめる。
 * - supabase-js を DB アクセスに使っていないこと。
 * - クラウドセッションから実 Supabase へ接続しないこと。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  POSTGRES_OPTIONS,
  assertNotRealDatabaseFromCloudSession,
  createSqlClient,
} from "../../packages/core/src/db/client";

const LOCAL_URL = "postgres://app_server:devonly@127.0.0.1:5432/debate_dev";

describe("postgres.js の設定", () => {
  it("prepare: false が実際のクライアントに反映されている", async () => {
    const sql = createSqlClient(LOCAL_URL, {});
    try {
      expect(sql.options.prepare).toBe(false);
    } finally {
      await sql.end();
    }
  });

  it("サーバレス向けの接続設定（max / idle_timeout）が入っている", async () => {
    const sql = createSqlClient(LOCAL_URL, {});
    try {
      expect(sql.options.max).toBe(1);
      expect(sql.options.idle_timeout).toBe(20);
    } finally {
      await sql.end();
    }
  });

  it("POSTGRES_OPTIONS.prepare は false である", () => {
    expect(POSTGRES_OPTIONS.prepare).toBe(false);
  });
});

describe("クラウドセッションからの接続先", () => {
  const cloud = { CLAUDE_CODE_REMOTE: "true" };

  it("セッション内 Postgres への接続は通る", () => {
    expect(() => assertNotRealDatabaseFromCloudSession(LOCAL_URL, cloud)).not.toThrow();
  });

  it("実 Supabase（Supavisor）への接続は落とす", () => {
    expect(() =>
      assertNotRealDatabaseFromCloudSession(
        "postgres://app_server.abcdefgh:pw@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres",
        cloud,
      ),
    ).toThrow(/実 Supabase へは接続しません/);
  });

  it("クラウドセッション以外では制限しない（デスクトップ・CI）", () => {
    expect(() =>
      assertNotRealDatabaseFromCloudSession(
        "postgres://app_server.abcdefgh:pw@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres",
        {},
      ),
    ).not.toThrow();
  });
});

/**
 * supabase-js は Storage と Auth 専用。DB アクセスに使わない
 * （DATA_MODEL.md §0.1）。ブラウザから DB へ到達する経路を、設定ではなく構成で断つ。
 */
const SUPABASE_JS_ALLOWED_DIRS = ["packages/core/src/storage", "packages/core/src/auth"];

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".next", "dist", "build"].includes(entry.name)) continue;
      sourceFiles(full, acc);
    } else if (/\.(ts|tsx|mts|cts)$/.test(entry.name)) {
      acc.push(full.split(path.sep).join("/"));
    }
  }
  return acc;
}

describe("supabase-js の用途", () => {
  it("Storage / Auth 以外から import されていない", () => {
    const roots = ["app", "packages", "scripts"].filter((d) => {
      try {
        return statSync(d).isDirectory();
      } catch {
        return false;
      }
    });
    const offenders = roots
      .flatMap((d) => sourceFiles(d))
      .filter((file) => readFileSync(file, "utf8").includes("@supabase/supabase-js"))
      .filter((file) => !SUPABASE_JS_ALLOWED_DIRS.some((allowed) => file.startsWith(allowed)));

    expect(offenders).toEqual([]);
  });

  it("DB 経路のモジュールは postgres.js だけを使う", () => {
    const client = readFileSync("packages/core/src/db/client.ts", "utf8");
    expect(client).toContain('from "postgres"');
    expect(client).not.toContain("@supabase/supabase-js");
  });
});
