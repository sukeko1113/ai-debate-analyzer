/**
 * RLS が app_server 接続で効いていること（P0 受け入れ基準 ①）。
 *
 * 前提: service postgresql start → npm run db:migrate が済んでいること。
 * このテストは GRANT を一切書かない表に対して実行する。読み書きできれば
 * P0 マイグレーションの ALTER DEFAULT PRIVILEGES が効いている。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { withActor } from "../../packages/core/src/db/client";
import {
  ACTOR_A,
  ACTOR_B,
  PROBE_FORCED,
  assertTenantIsolation,
  createProbeTables,
  dropProbeTables,
  migratorClient,
  serverClient,
} from "./helpers/probe";

let migrator: Sql;
let server: Sql;

beforeAll(async () => {
  migrator = migratorClient();
  server = serverClient();
  await createProbeTables(migrator);
});

afterAll(async () => {
  await dropProbeTables(migrator);
  await migrator.end();
  await server.end();
});

describe("RLS（接続ロール app_server）", () => {
  it("他人の行が SELECT / UPDATE / DELETE のいずれでも見えない", async () => {
    await expect(assertTenantIsolation(server, PROBE_FORCED)).resolves.toBeUndefined();
  });

  it("app.actor_id を設定しない経路では 1 行も見えない", async () => {
    // SET LOCAL を発行しない経路が生まれても「全部見える」ではなく
    // 「何も見えない」側へ倒れる、という設計の確認。
    const rows = await server.unsafe(`SELECT * FROM public.${PROBE_FORCED}`);
    expect(rows).toHaveLength(0);
  });

  it("app.actor_id はトランザクションの外へ漏れない（SET LOCAL の性質）", async () => {
    await withActor(server, ACTOR_A, async (tx) => {
      const [row] = await tx<{ v: string | null }[]>`
        SELECT current_setting('app.actor_id', true) AS v`;
      expect(row?.v).toBe(ACTOR_A);
    });
    const [after] = await server<{ v: string | null }[]>`
      SELECT current_setting('app.actor_id', true) AS v`;
    expect(after?.v ?? "").toBe("");
  });

  it("自分の actor_id の行は INSERT できる", async () => {
    const inserted = await withActor(server, ACTOR_A, async (tx) =>
      tx.unsafe(
        `INSERT INTO public.${PROBE_FORCED} (actor_id, note) VALUES ('${ACTOR_A}', 'A が足した行')`,
      ),
    );
    expect(inserted.count).toBe(1);
  });

  it("他人の actor_id を騙った INSERT は WITH CHECK で拒否される", async () => {
    await expect(
      withActor(server, ACTOR_A, async (tx) =>
        tx.unsafe(
          `INSERT INTO public.${PROBE_FORCED} (actor_id, note) VALUES ('${ACTOR_B}', 'なりすまし')`,
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("app_server は NOSUPERUSER かつ NOBYPASSRLS である", async () => {
    const [role] = await migrator<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'app_server'`;
    expect(role).toBeDefined();
    expect(role!.rolsuper).toBe(false);
    expect(role!.rolbypassrls).toBe(false);
  });

  it("app_server は public スキーマのテーブルを 1 枚も所有していない", async () => {
    // 所有者は RLS を素通りする。app_server が所有者になった時点で RLS は無意味になる。
    const owned = await migrator<{ relname: string }[]>`
      SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_roles r ON r.oid = c.relowner
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND r.rolname = 'app_server'`;
    expect(owned).toHaveLength(0);
  });

  it("public のテーブルはすべて ENABLE かつ FORCE ROW LEVEL SECURITY である", async () => {
    // P0 の時点でドメインのテーブルは無い。P2 以降で RLS を付け忘れたらここで落ちる。
    const naked = await migrator<{ relname: string; rls: boolean; force: boolean }[]>`
      SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS force
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname <> ${"__rls_probe_noforce"}
        AND (c.relrowsecurity IS FALSE OR c.relforcerowsecurity IS FALSE)`;
    expect(naked).toHaveLength(0);
  });
});
