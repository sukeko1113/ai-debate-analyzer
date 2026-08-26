/**
 * 他人の match が RLS レベルで見えないこと（TASKS.md P2 受け入れ基準3 / ACCEPTANCE.md M18）。
 *
 * **アプリの分岐だけで守らない。**
 * defineHandler は assertMatchAccess() で 403 / 404 を書き分けるが、それは二重目の網である。
 * ここでは、その分岐を通らない経路（生の SQL・リポジトリ関数の直接呼び出し）でも
 * 他人の行が 1 件も見えないことを確かめる。
 *
 * 同時に「テストが空回りしていないこと」も確かめる。
 * 所有者（app_migrator）で同じ SELECT を投げると、FORCE ROW LEVEL SECURITY が
 * 無ければ他人の行が見えてしまう。P0 の rls-owner-bypass.test.ts と同じ構図。
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { withActor } from "../../packages/core/src/db/client";
import { POST as createMatchRoute } from "../../app/api/v1/matches/route";
import {
  GET as getMatchRoute,
  PATCH as patchMatchRoute,
} from "../../app/api/v1/matches/[id]/route";
import { PUT as membersRoute } from "../../app/api/v1/matches/[id]/members/route";
import { findMatch, listMatches } from "../../packages/core/src/db/repo/matches";
import { henda20 } from "../../packages/core/src/ruleset";
import { call, newActorId } from "./helpers/api";
import { migratorClient, serverClient, truncateMatchTables } from "./helpers/probe";

let migrator: Sql;
let server: Sql;

/** 試合を持っている人 */
const owner = newActorId();
/** 何の関係も無い人 */
const stranger = newActorId();

let matchId: string;

beforeAll(async () => {
  migrator = migratorClient();
  server = serverClient();
  await truncateMatchTables(migrator);

  const res = await call<{ data: { id: string } }>(createMatchRoute, "POST", "/matches", {
    actorId: owner,
    idempotencyKey: randomUUID(),
    body: {
      motion: "The Japanese government should abolish the death penalty.",
      heldOn: "2026-03-21",
      round: "予選1",
      affTeam: "架空第一高校",
      negTeam: "架空第二高校",
      rulesetId: henda20.id,
      rulesetVersion: henda20.version,
    },
  });
  expect(res.status).toBe(201);
  matchId = res.body.data.id;
});

afterAll(async () => {
  await truncateMatchTables(migrator);
  await migrator.end();
  await server.end();
});

describe("RLS（アプリの認可分岐を通らない経路）", () => {
  it("生の SELECT でも、他人の match は 0 行", async () => {
    const rows = await withActor(
      server,
      stranger,
      (tx) => tx<{ id: string }[]>`SELECT id FROM matches WHERE id = ${matchId}`,
    );
    expect(rows).toHaveLength(0);
  });

  it("リポジトリ関数を直接呼んでも見えない（assertMatchAccess を経由しない）", async () => {
    const found = await withActor(server, stranger, (tx) => findMatch(tx, matchId));
    expect(found).toBeNull();

    const all = await withActor(server, stranger, (tx) => listMatches(tx));
    expect(all).toHaveLength(0);
  });

  it("本人には同じ経路で見える（ポリシーが厳しすぎて空回りしていないこと）", async () => {
    const found = await withActor(server, owner, (tx) => findMatch(tx, matchId));
    expect(found?.id).toBe(matchId);
  });

  it("他人は UPDATE / DELETE でも他人の match に届かない", async () => {
    const updated = await withActor(
      server,
      stranger,
      (tx) => tx`UPDATE matches SET motion = '改ざん' WHERE id = ${matchId}`,
    );
    expect(updated.count).toBe(0);

    const deleted = await withActor(
      server,
      stranger,
      (tx) => tx`DELETE FROM matches WHERE id = ${matchId}`,
    );
    expect(deleted.count).toBe(0);

    const stillThere = await withActor(server, owner, (tx) => findMatch(tx, matchId));
    expect(stillThere?.motion).not.toBe("改ざん");
  });

  it("他人の match の出場者・監査ログも見えない", async () => {
    await call(membersRoute, "PUT", `/matches/${matchId}/members`, {
      actorId: owner,
      params: { id: matchId },
      body: {
        expectedVersion: 0,
        teamSize: 4,
        members: [{ side: "AFF", seat: "A1", displayName: "あ" }],
      },
    });

    const members = await withActor(
      server,
      stranger,
      (tx) => tx`SELECT * FROM match_members WHERE match_id = ${matchId}`,
    );
    expect(members).toHaveLength(0);

    const logs = await withActor(
      server,
      stranger,
      (tx) => tx`SELECT * FROM edit_logs WHERE match_id = ${matchId}`,
    );
    expect(logs).toHaveLength(0);

    // 本人には見えている（ポリシーが全部を隠しているのではないこと）
    const mine = await withActor(
      server,
      owner,
      (tx) => tx`SELECT * FROM match_members WHERE match_id = ${matchId}`,
    );
    expect(mine).toHaveLength(1);
  });

  it("app.actor_id を設定しない経路では 1 行も見えない", async () => {
    // SET LOCAL を発行し忘れた経路が生まれても「全部見える」ではなく
    // 「何も見えない」側へ倒れる（P0 の app_actor_id() が NULL を返す設計）
    const rows = await server`SELECT id FROM matches`;
    expect(rows).toHaveLength(0);
  });

  it("他人の match_access を作れない（権限昇格の穴が塞がっている）", async () => {
    await expect(
      withActor(
        server,
        stranger,
        (tx) =>
          tx`INSERT INTO match_access (match_id, actor_id, role)
           VALUES (${matchId}, ${stranger}, 'owner')`,
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("API から見た他人の match", () => {
  it("GET は 404（403 で存在を漏らさない）", async () => {
    const res = await call<{ error: { code: string } }>(
      getMatchRoute,
      "GET",
      `/matches/${matchId}`,
      { actorId: stranger, params: { id: matchId } },
    );
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("PATCH も 404", async () => {
    const res = await call<{ error: { code: string } }>(
      patchMatchRoute,
      "PATCH",
      `/matches/${matchId}`,
      {
        actorId: stranger,
        params: { id: matchId },
        body: { expectedVersion: 0, motion: "改ざん" },
      },
    );
    expect(res.status).toBe(404);
  });
});

describe("このテストが空回りしていないこと", () => {
  it("所有者接続では『他人の行が見えない』の検証が成立しない", async () => {
    // app_migrator は matches の所有者である。
    // FORCE ROW LEVEL SECURITY が無ければ、ここで他人の行がそのまま見える。
    // FORCE がある現状では、逆に自分の行すら見えない（ポリシーが TO app_server のため）。
    // どちらに転んでも所有者接続は RLS の検証にならない、というのがこのテストの主張。
    const asOwnerRole = await withActor(
      migrator,
      owner,
      (tx) => tx<{ id: string }[]>`SELECT id FROM matches WHERE id = ${matchId}`,
    );
    expect(asOwnerRole).toHaveLength(0);

    // 比較対象: 同じ SELECT を app_server で投げれば見える
    const asAppRole = await withActor(
      server,
      owner,
      (tx) => tx<{ id: string }[]>`SELECT id FROM matches WHERE id = ${matchId}`,
    );
    expect(asAppRole).toHaveLength(1);
  });

  it("P2 で足した表はすべて ENABLE かつ FORCE ROW LEVEL SECURITY である", async () => {
    const tables = [
      "matches",
      "match_access",
      "match_members",
      "edit_logs",
      "api_idempotency_keys",
    ];
    const rows = await migrator<{ relname: string; rls: boolean; force: boolean }[]>`
      SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS force
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = ANY(${tables})`;
    expect(rows).toHaveLength(tables.length);
    expect(rows.every((r) => r.rls && r.force)).toBe(true);
  });

  it("GRANT を 1 行も書いていないのに app_server が読み書きできる（DEFAULT PRIVILEGES）", async () => {
    // drizzle/0001_p2_match_core.sql はテーブルへの GRANT を書いていない。
    // P0 の ALTER DEFAULT PRIVILEGES が効いていなければ、ここで落ちる
    const rows = await migrator<{ relname: string; ok: boolean }[]>`
      SELECT c.relname,
             has_table_privilege('app_server', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS ok
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname = ANY(${["matches", "match_access", "match_members", "edit_logs"]})`;
    expect(rows.every((r) => r.ok)).toBe(true);
  });
});
