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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findSupabaseJsOffenders } from "../../scripts/lib/supabase-imports";
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
 * （DATA_MODEL.md §0.1 / ACCEPTANCE.md M35）。
 * ブラウザから DB へ到達する経路を、設定ではなく構成で断つ。
 */
describe("M35 supabase-js の用途", () => {
  it("Storage / Auth 以外から import されていない", () => {
    expect(findSupabaseJsOffenders()).toEqual([]);
  });

  it("検査が空回りしていない（違反を置けば検出される）", () => {
    // 「常に [] を返す関数」でも上の検査は通ってしまう。
    // 実際に違反を作って、検出されることを確かめる（ACCEPTANCE.md §1.1）
    const dir = mkdtempSync(path.join(tmpdir(), "supabase-import-check-"));
    try {
      const offender = path.join(dir, "db-access.ts");
      writeFileSync(offender, 'import { createClient } from "@supabase/supabase-js";\n', "utf8");
      const found = findSupabaseJsOffenders([dir], ["packages/core/src/storage"]);
      expect(found).toHaveLength(1);
      expect(found[0]).toContain("db-access.ts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("許可ディレクトリの中なら検出されない", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "supabase-import-check-"));
    try {
      const allowedDir = path.join(dir, "storage");
      mkdirSync(allowedDir);
      writeFileSync(
        path.join(allowedDir, "signer.ts"),
        'import { createClient } from "@supabase/supabase-js";\n',
        "utf8",
      );
      expect(findSupabaseJsOffenders([dir], [`${dir.split(path.sep).join("/")}/storage`])).toEqual(
        [],
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("実際に Storage 層は supabase-js を使っている（検査の対象が存在する）", () => {
    const signer = readFileSync("packages/core/src/storage/supabase.ts", "utf8");
    expect(signer).toContain("@supabase/supabase-js");
  });

  it("DB 経路のモジュールは postgres.js だけを使う", () => {
    const client = readFileSync("packages/core/src/db/client.ts", "utf8");
    expect(client).toContain('from "postgres"');
    expect(client).not.toContain("@supabase/supabase-js");
  });
});
