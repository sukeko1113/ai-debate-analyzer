/**
 * defineHandler が担保する7つ（API_SPEC.md §11）。
 *
 * ここでは route ではなく、検査したい形だけを持つ小さなハンドラを組み立てて叩く。
 * 実際の route を通す検証は api-matches.test.ts にある。
 * 両方あるのは、**ハンドラの書き手が間違えたときに落ちること**を
 * 確かめたいからである（規約ではなく仕組みで守る、の確認）。
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import { defineHandler } from "../../packages/core/src/http/define-handler";
import { ApiError, ERROR_STATUS } from "../../packages/core/src/http/errors";
import { POST as createMatchRoute } from "../../app/api/v1/matches/route";
import { henda20 } from "../../packages/core/src/ruleset";
import { call, newActorId } from "./helpers/api";
import { migratorClient, truncateMatchTables } from "./helpers/probe";

let migrator: Sql;

beforeAll(async () => {
  migrator = migratorClient();
  await truncateMatchTables(migrator);
});

afterAll(async () => {
  await truncateMatchTables(migrator);
  await migrator.end();
});

async function seedMatch(actorId: string): Promise<string> {
  const res = await call<{ data: { id: string } }>(createMatchRoute, "POST", "/matches", {
    actorId,
    idempotencyKey: randomUUID(),
    body: {
      motion: "合成データの論題",
      heldOn: null,
      round: null,
      affTeam: "架空第一高校",
      negTeam: "架空第二高校",
      rulesetId: henda20.id,
      rulesetVersion: henda20.version,
    },
  });
  expect(res.status).toBe(201);
  return res.body.data.id;
}

describe("(2) トランザクションと SET LOCAL app.actor_id", () => {
  it("ハンドラの中では app.actor_id が JWT の sub になっている", async () => {
    const actorId = newActorId();
    const route = defineHandler({
      auth: "authenticated",
      handler: async ({ tx }) => {
        const rows = await tx<{ v: string }[]>`SELECT public.app_actor_id()::text AS v`;
        return { data: { actorIdInDb: rows[0]!.v } };
      },
    });

    const res = await call<{ data: { actorIdInDb: string } }>(route, "GET", "/probe", { actorId });
    expect(res.body.data.actorIdInDb).toBe(actorId);
  });

  it("ハンドラが例外を投げるとトランザクションが巻き戻る", async () => {
    const actorId = newActorId();
    const matchId = await seedMatch(actorId);

    const route = defineHandler({
      auth: "match:write",
      params: z.object({ id: z.uuid() }),
      handler: async ({ params, tx, audit }) => {
        await tx`UPDATE matches SET motion = '巻き戻るはず' WHERE id = ${params.id}`;
        audit.record({
          entity: "matches",
          entityId: params.id,
          matchId: params.id,
          before: null,
          after: null,
        });
        throw new ApiError("INTERNAL", "わざと失敗させる");
      },
    });

    const res = await call(route, "PATCH", `/matches/${matchId}`, {
      actorId,
      params: { id: matchId },
    });
    expect(res.status).toBe(500);

    const rows = await migrator<{ motion: string }[]>`
      SELECT motion FROM matches WHERE id = ${matchId}`;
    expect(rows).toHaveLength(0); // 所有者接続では FORCE RLS で見えない
    const check = await call<{ data: { match: { motion: string } } }>(
      (await import("../../app/api/v1/matches/[id]/route")).GET,
      "GET",
      `/matches/${matchId}`,
      { actorId, params: { id: matchId } },
    );
    expect(check.body.data.match.motion).toBe("合成データの論題");
  });
});

describe("(3) Zod検証", () => {
  it("params が合わなければ 400 VALIDATION_FAILED で issue 配列が返る", async () => {
    const route = defineHandler({
      auth: "authenticated",
      params: z.object({ id: z.uuid() }),
      handler: async () => ({ data: {} }),
    });

    const res = await call<{ error: { code: string; details: unknown[] } }>(
      route,
      "GET",
      "/probe",
      { actorId: newActorId(), params: { id: "uuid ではない" } },
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(Array.isArray(res.body.error.details)).toBe(true);
  });

  it("ボディが JSON でなければ 400", async () => {
    const route = defineHandler({
      auth: "authenticated",
      body: z.object({ a: z.number() }),
      handler: async () => ({ data: {} }),
    });
    const request = new Request("http://localhost/api/v1/probe", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${(await import("./helpers/api")).tokenFor(newActorId())}`,
      },
      body: "{ こわれた",
    });
    const response = await route(request);
    expect(response.status).toBe(400);
  });
});

describe("(4) expectedVersion", () => {
  it("body スキーマが expectedVersion を要求し忘れても 400 で止まる", async () => {
    // 二重の網。route が body スキーマに書き忘れても、
    // requireExpectedVersion がリクエストを通さない（API_SPEC.md §0.3）
    const route = defineHandler({
      auth: "authenticated",
      body: z.object({ motion: z.string() }), // ← expectedVersion が無い
      requireExpectedVersion: true,
      handler: async () => ({ data: {} }),
    });

    const res = await call<{ error: { code: string; message: string } }>(route, "PATCH", "/probe", {
      actorId: newActorId(),
      body: { motion: "書き換え" },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(res.body.error.message).toContain("expectedVersion");
  });

  it("整数でない expectedVersion も通さない", async () => {
    const route = defineHandler({
      auth: "authenticated",
      body: z.object({ expectedVersion: z.number(), motion: z.string() }),
      requireExpectedVersion: true,
      handler: async () => ({ data: {} }),
    });
    const res = await call(route, "PATCH", "/probe", {
      actorId: newActorId(),
      body: { expectedVersion: 1.5, motion: "x" },
    });
    expect(res.status).toBe(400);
  });
});

describe("(6) 例外 → エラーコードへの変換", () => {
  it("ApiError はそのままのコードと HTTP で返る", async () => {
    for (const code of Object.keys(ERROR_STATUS) as (keyof typeof ERROR_STATUS)[]) {
      const route = defineHandler({
        auth: "authenticated",
        handler: async () => {
          throw new ApiError(code, "テスト");
        },
      });
      const res = await call<{ error: { code: string } }>(route, "GET", "/probe", {
        actorId: newActorId(),
      });
      expect(res.status).toBe(ERROR_STATUS[code]);
      expect(res.body.error.code).toBe(code);
    }
  });

  it("素の例外は 500 になり、本文をクライアントへ返さない", async () => {
    // DB のエラーメッセージには行の中身が混じる。RLS で隠したものを漏らさない
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const route = defineHandler({
      auth: "authenticated",
      handler: async () => {
        throw new Error("内部の秘密が混じったメッセージ");
      },
    });
    const res = await call<{ error: { code: string; message: string } }>(route, "GET", "/probe", {
      actorId: newActorId(),
    });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL");
    expect(res.body.error.message).not.toContain("秘密");
    spy.mockRestore();
  });

  it("DB の SQLSTATE AD001 は 409 CONSENT_REQUIRED になる", async () => {
    const actorId = newActorId();
    const matchId = await seedMatch(actorId);

    // API 側の分岐を通さず、ハンドラから直接 UPDATE してトリガを踏ませる
    const route = defineHandler({
      auth: "match:write",
      params: z.object({ id: z.uuid() }),
      handler: async ({ params, tx, audit }) => {
        audit.record({
          entity: "matches",
          entityId: params.id,
          matchId: params.id,
          before: null,
          after: null,
        });
        await tx`UPDATE matches SET status = 'analyzing' WHERE id = ${params.id}`;
        return { data: {} };
      },
    });

    const res = await call<{ error: { code: string } }>(route, "PATCH", `/matches/${matchId}`, {
      actorId,
      params: { id: matchId },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONSENT_REQUIRED");
  });
});

describe("(7) edit_logs への追記", () => {
  it("変更系なのに何も記録しないハンドラは 500 で落ちる", async () => {
    // ここが警告どまりだと、記録の無い変更がいつか必ず本番へ出る
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const actorId = newActorId();
    const matchId = await seedMatch(actorId);

    const route = defineHandler({
      auth: "match:write",
      params: z.object({ id: z.uuid() }),
      handler: async ({ params, tx }) => {
        await tx`UPDATE matches SET round = '記録し忘れ' WHERE id = ${params.id}`;
        return { data: {} };
      },
    });

    const res = await call<{ error: { code: string } }>(route, "PATCH", `/matches/${matchId}`, {
      actorId,
      params: { id: matchId },
    });

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL");
    // 巻き戻っていること（記録の無い変更が残らない）
    const check = await call<{ data: { match: { round: string | null } } }>(
      (await import("../../app/api/v1/matches/[id]/route")).GET,
      "GET",
      `/matches/${matchId}`,
      { actorId, params: { id: matchId } },
    );
    expect(check.body.data.match.round).toBeNull();
    spy.mockRestore();
  });

  it("GET は記録が無くても通る", async () => {
    const route = defineHandler({
      auth: "authenticated",
      handler: async () => ({ data: { ok: true } }),
    });
    const res = await call(route, "GET", "/probe", { actorId: newActorId() });
    expect(res.status).toBe(200);
  });
});

describe("認可（RLS の二重目）", () => {
  // viewer / member の分岐は DB で作れない。
  // P2 の match_access には owner の行しか入らない（共有機能は後の PR）。
  // app_migrator で挿し込もうとしても FORCE ROW LEVEL SECURITY に阻まれる。
  // 役割ごとの可否は tests/unit/match-access.test.ts が全組み合わせを確かめる。
  it("owner は match:write / match:owner のどちらも通る", async () => {
    const ownerId = newActorId();
    const matchId = await seedMatch(ownerId);

    for (const auth of ["match:read", "match:write", "match:owner"] as const) {
      const route = defineHandler({
        auth,
        params: z.object({ id: z.uuid() }),
        handler: async () => ({ data: { ok: true } }),
      });
      const res = await call(route, "GET", `/matches/${matchId}`, {
        actorId: ownerId,
        params: { id: matchId },
      });
      expect(res.status, auth).toBe(200);
    }
  });

  it("P2 では他人を match_access に足せない（共有機能が無いことの確認）", async () => {
    const ownerId = newActorId();
    const matchId = await seedMatch(ownerId);
    const other = newActorId();

    // テーブル所有者でも FORCE ROW LEVEL SECURITY に阻まれる
    await expect(
      migrator`INSERT INTO match_access (match_id, actor_id, role)
               VALUES (${matchId}, ${other}, 'viewer')`,
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("member でない actor には 404（存在を漏らさない）", async () => {
    const ownerId = newActorId();
    const matchId = await seedMatch(ownerId);
    const route = defineHandler({
      auth: "match:read",
      params: z.object({ id: z.uuid() }),
      handler: async () => ({ data: { ok: true } }),
    });
    const res = await call<{ error: { code: string } }>(route, "GET", `/matches/${matchId}`, {
      actorId: newActorId(),
      params: { id: matchId },
    });
    expect(res.status).toBe(404);
  });
});
