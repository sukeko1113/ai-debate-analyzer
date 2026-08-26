/**
 * 試合登録まわりの API（API_SPEC.md §1）。
 *
 * 実際の app/api/v1/... の route.ts をそのまま呼ぶ。
 * DB も RLS も本物である。ここで確かめるのは TASKS.md P2 の受け入れ基準
 * 1（expectedVersion 省略 → 400）/ 2（不一致 → 409）/ 4（許諾）/ 5（担当者表）/ 6（edit_logs）。
 * 3（RLS）は rls-matches.test.ts で、アプリの分岐を通さずに確かめる。
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { GET as listMatchesRoute, POST as createMatchRoute } from "../../app/api/v1/matches/route";
import {
  GET as getMatchRoute,
  PATCH as patchMatchRoute,
} from "../../app/api/v1/matches/[id]/route";
import { POST as consentRoute } from "../../app/api/v1/matches/[id]/consent/route";
import { PUT as membersRoute } from "../../app/api/v1/matches/[id]/members/route";
import { henda20 } from "../../packages/core/src/ruleset";
import { call, newActorId, readAsActor, tokenFor } from "./helpers/api";
import { migratorClient, truncateMatchTables } from "./helpers/probe";

let migrator: Sql;

beforeAll(async () => {
  migrator = migratorClient();
});

afterAll(async () => {
  await truncateMatchTables(migrator);
  await migrator.end();
});

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    motion: "The Japanese government should abolish the death penalty.",
    heldOn: "2026-03-21",
    round: "予選1",
    affTeam: "架空第一高校",
    negTeam: "架空第二高校",
    rulesetId: henda20.id,
    rulesetVersion: henda20.version,
    ...overrides,
  };
}

async function createMatch(actorId: string, overrides: Record<string, unknown> = {}) {
  const res = await call<{ data: { id: string; lockVersion: number } }>(
    createMatchRoute,
    "POST",
    "/matches",
    { actorId, body: createBody(overrides), idempotencyKey: randomUUID() },
  );
  expect(res.status).toBe(201);
  return res.body.data;
}

/** 許諾を記録して、返ってきた版を渡す */
async function recordConsent(actorId: string, matchId: string, expectedVersion: number) {
  return call<{ data: { version: number; consentRecordedAt: string } }>(
    consentRoute,
    "POST",
    `/matches/${matchId}/consent`,
    {
      actorId,
      params: { id: matchId },
      body: {
        expectedVersion,
        scope: "practice_only",
        obtainedFrom: ["student", "school"],
        expiresOn: null,
        note: "合成データ。実試合ではない",
      },
    },
  );
}

describe("認証（API_SPEC.md §0.2）", () => {
  it("Authorization が無いと 401 UNAUTHENTICATED", async () => {
    const res = await call<{ error: { code: string } }>(createMatchRoute, "POST", "/matches", {
      token: "",
      body: createBody(),
      idempotencyKey: randomUUID(),
    });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("署名が違うトークンは 401", async () => {
    const forged = tokenFor(newActorId()).slice(0, -3) + "aaa";
    const res = await call<{ error: { code: string } }>(createMatchRoute, "POST", "/matches", {
      token: forged,
      body: createBody(),
      idempotencyKey: randomUUID(),
    });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("期限切れのトークンは 401", async () => {
    const actorId = newActorId();
    const expired = tokenFor(actorId, { exp: Math.floor(Date.now() / 1000) - 10 });
    const res = await call<{ error: { code: string; message: string } }>(
      createMatchRoute,
      "POST",
      "/matches",
      { token: expired, body: createBody(), idempotencyKey: randomUUID() },
    );
    expect(res.status).toBe(401);
    expect(res.body.error.message).toContain("有効期限");
  });
});

describe("POST /matches", () => {
  it("作成すると 201 で match が返り、作成者が owner になる", async () => {
    const actorId = newActorId();
    const match = await createMatch(actorId);

    expect(match.lockVersion).toBe(0);
    const res = await call<{ data: { match: { status: string; createdBy: string } } }>(
      getMatchRoute,
      "GET",
      `/matches/${match.id}`,
      { actorId, params: { id: match.id } },
    );
    expect(res.status).toBe(200);
    expect(res.body.data.match.status).toBe("draft");
    expect(res.body.data.match.createdBy).toBe(actorId);
  });

  it("Idempotency-Key が無いと 400（API_SPEC.md §0.4）", async () => {
    const res = await call<{ error: { code: string; message: string } }>(
      createMatchRoute,
      "POST",
      "/matches",
      { actorId: newActorId(), body: createBody() },
    );
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain("Idempotency-Key");
  });

  it("同じ Idempotency-Key の再送は新規作成せず、同じ結果を返す", async () => {
    const actorId = newActorId();
    const key = randomUUID();
    const first = await call<{ data: { id: string } }>(createMatchRoute, "POST", "/matches", {
      actorId,
      body: createBody(),
      idempotencyKey: key,
    });
    const second = await call<{ data: { id: string } }>(createMatchRoute, "POST", "/matches", {
      actorId,
      body: createBody(),
      idempotencyKey: key,
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(second.headers.get("idempotent-replay")).toBe("true");

    const list = await call<{ data: { matches: { id: string }[] } }>(
      listMatchesRoute,
      "GET",
      "/matches",
      { actorId },
    );
    expect(list.body.data.matches).toHaveLength(1);
  });

  it("同じキーで別の内容を送ると 400", async () => {
    const actorId = newActorId();
    const key = randomUUID();
    await call(createMatchRoute, "POST", "/matches", {
      actorId,
      body: createBody(),
      idempotencyKey: key,
    });
    const res = await call<{ error: { message: string } }>(createMatchRoute, "POST", "/matches", {
      actorId,
      body: createBody({ motion: "別の論題" }),
      idempotencyKey: key,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain("別の内容");
  });

  it("サーバが持っていない ruleset 版は 400", async () => {
    const res = await call<{ error: { code: string } }>(createMatchRoute, "POST", "/matches", {
      actorId: newActorId(),
      body: createBody({ rulesetVersion: "1999-01-01" }),
      idempotencyKey: randomUUID(),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });
});

describe("楽観ロック（受け入れ基準 1・2 / ACCEPTANCE.md M19）", () => {
  it("expectedVersion を省略した更新は 400 で拒否される", async () => {
    const actorId = newActorId();
    const match = await createMatch(actorId);

    const res = await call<{ error: { code: string } }>(
      patchMatchRoute,
      "PATCH",
      `/matches/${match.id}`,
      { actorId, params: { id: match.id }, body: { motion: "書き換え" } },
    );

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("不一致のときは 409 VERSION_CONFLICT で details.currentVersion が返る", async () => {
    const actorId = newActorId();
    const match = await createMatch(actorId);

    const res = await call<{
      error: { code: string; details: { currentVersion: number } };
    }>(patchMatchRoute, "PATCH", `/matches/${match.id}`, {
      actorId,
      params: { id: match.id },
      body: { expectedVersion: 99, motion: "書き換え" },
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("VERSION_CONFLICT");
    expect(res.body.error.details.currentVersion).toBe(0);
  });

  it("一致すれば更新でき、版が 1 つ進む", async () => {
    const actorId = newActorId();
    const match = await createMatch(actorId);

    const res = await call<{ data: { version: number } }>(
      patchMatchRoute,
      "PATCH",
      `/matches/${match.id}`,
      {
        actorId,
        params: { id: match.id },
        body: { expectedVersion: 0, round: "Q-F" },
      },
    );

    expect(res.status).toBe(200);
    expect(res.body.data.version).toBe(1);

    // 同じ expectedVersion での二度目は競合する
    const again = await call<{ error: { code: string } }>(
      patchMatchRoute,
      "PATCH",
      `/matches/${match.id}`,
      { actorId, params: { id: match.id }, body: { expectedVersion: 0, round: "S-F" } },
    );
    expect(again.status).toBe(409);
  });
});

describe("許諾（受け入れ基準 4 / ACCEPTANCE.md M14）", () => {
  it("consent_recorded_at が null のまま status を analyzing にすると 409 CONSENT_REQUIRED", async () => {
    const actorId = newActorId();
    const match = await createMatch(actorId);

    const res = await call<{ error: { code: string } }>(
      patchMatchRoute,
      "PATCH",
      `/matches/${match.id}`,
      { actorId, params: { id: match.id }, body: { expectedVersion: 0, status: "analyzing" } },
    );

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONSENT_REQUIRED");
  });

  it("許諾を記録したあとは analyzing にできる", async () => {
    const actorId = newActorId();
    const match = await createMatch(actorId);

    const consent = await recordConsent(actorId, match.id, 0);
    expect(consent.status).toBe(200);
    expect(consent.body.data.consentRecordedAt).toBeTruthy();

    const res = await call<{ data: { version: number } }>(
      patchMatchRoute,
      "PATCH",
      `/matches/${match.id}`,
      {
        actorId,
        params: { id: match.id },
        body: { expectedVersion: consent.body.data.version, status: "analyzing" },
      },
    );
    expect(res.status).toBe(200);
  });

  it("consent も expectedVersion を要求する（API_SPEC.md §0.3）", async () => {
    const actorId = newActorId();
    const match = await createMatch(actorId);

    const res = await call<{ error: { code: string } }>(
      consentRoute,
      "POST",
      `/matches/${match.id}/consent`,
      {
        actorId,
        params: { id: match.id },
        body: {
          scope: "practice_only",
          obtainedFrom: ["student"],
          expiresOn: null,
          note: "",
        },
      },
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });
});

describe("出場者と担当者表（受け入れ基準 5）", () => {
  it("team_size = 4 なら ⑪肯定総括の担当は A4", async () => {
    const actorId = newActorId();
    const match = await createMatch(actorId);

    const res = await call<{
      data: { teamSize: number; roster: { stageNo: number; seat: string }[] };
    }>(membersRoute, "PUT", `/matches/${match.id}/members`, {
      actorId,
      params: { id: match.id },
      body: {
        expectedVersion: 0,
        teamSize: 4,
        members: [
          { side: "AFF", seat: "A1", displayName: "あ" },
          { side: "AFF", seat: "A4", displayName: "い" },
          { side: "NEG", seat: "N1", displayName: "う" },
        ],
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.data.teamSize).toBe(4);
    expect(res.body.data.roster.find((r) => r.stageNo === 11)?.seat).toBe("A4");
  });

  it("team_size = 3 なら ⑪肯定総括の担当は A1 に切り替わる", async () => {
    const actorId = newActorId();
    const match = await createMatch(actorId);

    const res = await call<{ data: { roster: { stageNo: number; seat: string }[] } }>(
      membersRoute,
      "PUT",
      `/matches/${match.id}/members`,
      {
        actorId,
        params: { id: match.id },
        body: {
          expectedVersion: 0,
          teamSize: 3,
          members: [
            { side: "AFF", seat: "A1", displayName: "あ" },
            { side: "NEG", seat: "N3", displayName: "う" },
          ],
        },
      },
    );

    expect(res.status).toBe(200);
    expect(res.body.data.roster.find((r) => r.stageNo === 11)?.seat).toBe("A1");
  });

  it("3人チームに A4 を入れると 400（条項 2.2 の担当者表に無い座席）", async () => {
    const actorId = newActorId();
    const match = await createMatch(actorId);

    const res = await call<{ error: { code: string } }>(
      membersRoute,
      "PUT",
      `/matches/${match.id}/members`,
      {
        actorId,
        params: { id: match.id },
        body: {
          expectedVersion: 0,
          teamSize: 3,
          members: [{ side: "AFF", seat: "A4", displayName: "あ" }],
        },
      },
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("seat と side が食い違うと 400（A* は AFF）", async () => {
    const actorId = newActorId();
    const match = await createMatch(actorId);

    const res = await call<{ error: { code: string } }>(
      membersRoute,
      "PUT",
      `/matches/${match.id}/members`,
      {
        actorId,
        params: { id: match.id },
        body: {
          expectedVersion: 0,
          teamSize: 4,
          members: [{ side: "NEG", seat: "A1", displayName: "あ" }],
        },
      },
    );
    expect(res.status).toBe(400);
  });

  it("一括置換である（前の出場者が残らない）", async () => {
    const actorId = newActorId();
    const match = await createMatch(actorId);

    await call(membersRoute, "PUT", `/matches/${match.id}/members`, {
      actorId,
      params: { id: match.id },
      body: {
        expectedVersion: 0,
        teamSize: 4,
        members: [
          { side: "AFF", seat: "A1", displayName: "あ" },
          { side: "AFF", seat: "A2", displayName: "い" },
        ],
      },
    });
    const res = await call<{ data: { members: { seat: string }[] } }>(
      membersRoute,
      "PUT",
      `/matches/${match.id}/members`,
      {
        actorId,
        params: { id: match.id },
        body: {
          expectedVersion: 1,
          teamSize: 4,
          members: [{ side: "NEG", seat: "N1", displayName: "う" }],
        },
      },
    );

    expect(res.status).toBe(200);
    expect(res.body.data.members.map((m) => m.seat)).toEqual(["N1"]);
  });
});

describe("edit_logs（受け入れ基準 6）", () => {
  it("作成・更新・許諾・出場者置換のすべてが記録される", async () => {
    const actorId = newActorId();
    const match = await createMatch(actorId);

    await call(patchMatchRoute, "PATCH", `/matches/${match.id}`, {
      actorId,
      params: { id: match.id },
      body: { expectedVersion: 0, round: "Final" },
    });
    await recordConsent(actorId, match.id, 1);
    await call(membersRoute, "PUT", `/matches/${match.id}/members`, {
      actorId,
      params: { id: match.id },
      body: {
        expectedVersion: 2,
        teamSize: 4,
        members: [{ side: "AFF", seat: "A1", displayName: "あ" }],
      },
    });

    // 読むのも app_server 接続で行う。所有者接続では FORCE RLS のため 0 行になり、
    // 「数えたつもりで何も見ていない」テストになる
    const logs = await readAsActor(
      actorId,
      (tx) =>
        tx<{ entity: string; actor: string; before: unknown; after: unknown }[]>`
        SELECT entity, actor, before, after FROM edit_logs
         WHERE match_id = ${match.id} ORDER BY at, entity`,
    );

    // 作成で matches と match_access の 2 件、PATCH で 1 件、consent で 1 件、members で 1 件
    expect(logs).toHaveLength(5);
    expect(logs.every((l) => l.actor === actorId)).toBe(true);
    expect(logs.map((l) => l.entity)).toContain("match_access");
    expect(logs.filter((l) => l.entity === "matches")).toHaveLength(3);
    expect(logs.filter((l) => l.entity === "match_members")).toHaveLength(1);

    // before / after が両方入っている（DATA_MODEL.md §10）
    const patchLog = logs.find(
      (l) => l.entity === "matches" && (l.after as { round?: string } | null)?.round === "Final",
    );
    expect(patchLog).toBeDefined();
    expect((patchLog!.before as { round: string | null }).round).toBe("予選1");
  });

  it("読み取り（GET）では記録されない", async () => {
    const actorId = newActorId();
    const match = await createMatch(actorId);
    const count = () =>
      readAsActor(
        actorId,
        (tx) =>
          tx<{ n: string }[]>`SELECT count(*) AS n FROM edit_logs WHERE match_id = ${match.id}`,
      );

    const before = await count();
    // 作成の 2 件が見えていること。0 と 0 を比べて通る形にしない
    expect(Number(before[0]!.n)).toBe(2);

    await call(getMatchRoute, "GET", `/matches/${match.id}`, { actorId, params: { id: match.id } });

    const after = await count();
    expect(after[0]!.n).toBe(before[0]!.n);
  });
});
