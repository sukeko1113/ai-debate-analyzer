/**
 * ジョブの状態遷移（ACCEPTANCE.md M36 / TRANSCRIPTION.md §6.1）。
 *
 * **辺の定義は 2 箇所にある。**
 *   packages/core/src/jobs/state.ts の ALLOWED_TRANSITIONS
 *   drizzle/0003_p4_jobs.sql の transcription_jobs_guard_transition()
 *
 * 片方だけ直すと、アプリが許して DB が拒む（500 になる）か、
 * DB が許してアプリが拒む（経路によって挙動が違う）状態になる。
 * **全 25 組（5 状態 × 5 状態）を実物のトリガに当てて突き合わせる。**
 * 段階2 で SQLSTATE に対して行ったのと同じ形である。
 *
 * 【件13 に従う】
 * 例外を確かめる検査を 1 つの withActor に並べると、最初の例外で
 * トランザクションが中断し、rejects で受けたはずの例外が外へ抜ける。
 * **検査ごとに withActor を開き直す。**
 *
 * 【件12・件27 に従う】
 * 読みも書きも app_server 接続 ＋ withActor で行う。所有者接続は
 * FORCE ROW LEVEL SECURITY のため 0 行で静かに成功する。
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { withActor } from "../../packages/core/src/db/client";
import { SQLSTATE } from "../../packages/core/src/http/errors";
import { JOB_STATUSES, canTransition, type JobStatus } from "../../packages/core/src/jobs/state";
import { henda20 } from "../../packages/core/src/ruleset";
import { POST as createMatchRoute } from "../../app/api/v1/matches/route";
import { POST as consentRoute } from "../../app/api/v1/matches/[id]/consent/route";
import { call, newActorId } from "./helpers/api";
import { migratorClient, serverClient, truncateMatchTables } from "./helpers/probe";

let migrator: Sql;
let server: Sql;

const owner = newActorId();
let matchId: string;

/**
 * 遷移の**前段**。`status, started_at, finished_at, metrics` の順に並べた値である。
 *
 * **INSERT で直接その状態を作る。UPDATE で作らない。**
 * UPDATE で作ろうとすると、そのUPDATE自体が検査対象のトリガを通ってしまい、
 * 「queued から succeeded の行を用意する」ができない（許されない辺だからである）。
 * INSERT はトリガの対象外なので、CHECK を満たす限り任意の状態から始められる。
 */
const SEED: Record<JobStatus, string> = {
  queued: "'queued', NULL, NULL, '{}'::jsonb",
  running: "'running', now(), NULL, '{}'::jsonb",
  succeeded: "'succeeded', now(), now(), '{\"durationMs\": 1}'::jsonb",
  failed: "'failed', now(), now(), '{}'::jsonb",
  canceled: "'canceled', now(), now(), '{}'::jsonb",
};

/** 遷移先として書く列。CHECK を満たす最小限 */
const TARGET: Record<JobStatus, string> = {
  queued: "status = 'queued'",
  running: "status = 'running', started_at = now()",
  succeeded:
    "status = 'succeeded', finished_at = now()," +
    " provider_id = 'stub', model = 'stub-v1', metrics = '{\"durationMs\": 1}'::jsonb",
  failed: "status = 'failed', finished_at = now()",
  canceled: "status = 'canceled', finished_at = now()",
};

beforeAll(async () => {
  migrator = migratorClient();
  server = serverClient();
  await truncateMatchTables(migrator);

  const created = await call<{ data: { id: string; lockVersion: number } }>(
    createMatchRoute,
    "POST",
    "/matches",
    {
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
    },
  );
  expect(created.status).toBe(201);
  matchId = created.body.data.id;

  // 許諾を記録しないとジョブを作れない（件17。M14 が別途それを確かめる）
  const consent = await call(consentRoute, "POST", `/matches/${matchId}/consent`, {
    actorId: owner,
    params: { id: matchId },
    body: {
      expectedVersion: created.body.data.lockVersion,
      scope: "practice_only",
      obtainedFrom: ["student", "school"],
      expiresOn: null,
      note: "合成データ。実試合ではない",
    },
  });
  expect(consent.status).toBe(200);
});

afterAll(async () => {
  await truncateMatchTables(migrator);
  await migrator.end();
  await server.end();
});

/**
 * その状態のジョブを 1 件作って id を返す。**検査ごとに新しい行を使う。**
 *
 * `params_hash` は毎回変える。同じにすると UNIQUE NULLS NOT DISTINCT
 * （match_id + kind + NULL + params_hash）に当たり、2 件目が作れない。
 * 書き込みも app_server ＋ withActor で行う（件27）。
 */
async function seedJob(status: JobStatus): Promise<string> {
  const hash = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");

  return withActor(server, owner, async (tx) => {
    const rows = await tx.unsafe<{ id: string }[]>(
      `INSERT INTO transcription_jobs (match_id, kind, target_stage_no, params_hash,
                                       provider_id, model,
                                       status, started_at, finished_at, metrics)
       VALUES ($1, 'align', NULL, $2, 'stub', 'stub-v1', ${SEED[status]})
       RETURNING id`,
      [matchId, hash],
    );
    return rows[0]!.id;
  });
}

describe("transcription_jobs の状態遷移トリガ", () => {
  // 直接 SEED で置く UPDATE 自体がトリガを通るため、
  // まずその足場が成立していることを確かめる
  it("足場: 各状態のジョブを用意できる", async () => {
    for (const status of JOB_STATUSES) {
      const id = await seedJob(status);
      const rows = await withActor(
        server,
        owner,
        (tx) => tx<{ status: string }[]>`SELECT status FROM transcription_jobs WHERE id = ${id}`,
      );
      expect(rows[0]?.status, status).toBe(status);
    }
  });

  it("全 25 組が ALLOWED_TRANSITIONS と一致する", async () => {
    const disagreements: string[] = [];

    for (const from of JOB_STATUSES) {
      for (const to of JOB_STATUSES) {
        const expected = canTransition(from, to);
        const id = await seedJob(from);

        // **検査ごとに withActor を開き直す**（件13）。
        // 例外が出た時点でそのトランザクションは中断する
        let actual: boolean | string;
        try {
          await withActor(server, owner, (tx) =>
            tx.unsafe(`UPDATE transcription_jobs SET ${TARGET[to]} WHERE id = $1`, [id]),
          );
          actual = true;
        } catch (error) {
          const code = (error as { code?: string })?.code;
          // AD003 だけが「トリガが拒んだ」。それ以外の SQLSTATE は
          // 「トリガを素通りして別の防壁に当たった」であり、同じ扱いにしない。
          // ここで throw すると 25 組の途中でループが止まり、
          // **どの組が食い違ったのかが出ない**（守りを外したときに一番知りたい情報である）
          actual = code === SQLSTATE.INVALID_JOB_TRANSITION ? false : (code ?? "unknown");
        }

        if (actual !== expected) {
          const got =
            actual === true ? "許した" : actual === false ? "拒んだ（AD003）" : `別の例外 ${actual}`;
          disagreements.push(`${from} → ${to}: TS は ${expected ? "許す" : "拒む"}、DB は ${got}`);
        }
      }
    }

    expect(disagreements, disagreements.join("\n")).toEqual([]);
  });

  it("状態を変えない UPDATE は素通りする（metrics の追記）", async () => {
    const id = await seedJob("running");
    await withActor(server, owner, (tx) =>
      tx.unsafe(
        `UPDATE transcription_jobs SET metrics = '{"durationMs": 5}'::jsonb WHERE id = $1`,
        [id],
      ),
    );

    const rows = await withActor(
      server,
      owner,
      (tx) =>
        tx<{ metrics: Record<string, unknown> }[]>`
        SELECT metrics FROM transcription_jobs WHERE id = ${id}`,
    );
    expect(rows[0]?.metrics).toEqual({ durationMs: 5 });
  });

  it("succeeded から running へは戻せない（AD003）", async () => {
    const id = await seedJob("succeeded");
    await expect(
      withActor(server, owner, (tx) =>
        tx.unsafe(`UPDATE transcription_jobs SET status = 'running' WHERE id = $1`, [id]),
      ),
    ).rejects.toMatchObject({ code: SQLSTATE.INVALID_JOB_TRANSITION });
  });
});
