/**
 * transcription_jobs の RLS と、システム actor の可視範囲
 * （ACCEPTANCE.md M40・M41 / DATA_MODEL.md §4.1）。
 *
 * **アプリの分岐だけで守らない。**
 * `defineHandler` の `auth` と `matchIdFrom` は二重目の網である。
 * ここでは、その分岐を通らない経路（生の SQL・リポジトリ関数の直接呼び出し）でも
 * 他人の行が 1 件も見えないことを確かめる。rls-media.test.ts と同じ構図。
 *
 * あわせて、内部ランナー用の主体（`public.system_actor_id()`）が
 * **何を見えて何を見えないか**を確かめる。0003 で節を足したのは
 * `transcription_jobs` と `edit_logs` の 2 表だけであり、
 * `matches` と `media_sources` には足していない。この非対称は意図である。
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
import { withSystemActor } from "../../packages/core/src/jobs/system-actor";
import { findJobById, listJobs } from "../../packages/core/src/db/repo/jobs";
import { henda20 } from "../../packages/core/src/ruleset";
import { POST as createMatchRoute } from "../../app/api/v1/matches/route";
import { POST as consentRoute } from "../../app/api/v1/matches/[id]/consent/route";
import { call, newActorId } from "./helpers/api";
import { migratorClient, serverClient, truncateMatchTables } from "./helpers/probe";

let migrator: Sql;
let server: Sql;

const owner = newActorId();
const stranger = newActorId();

let matchId: string;
let jobId: string;

function hash(): string {
  return randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
}

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

  const rows = await withActor(
    server,
    owner,
    (tx) => tx<{ id: string }[]>`
    INSERT INTO transcription_jobs (match_id, kind, target_stage_no, params_hash,
                                    provider_id, model)
    VALUES (${matchId}, 'align', NULL, ${hash()}, 'stub', 'stub-v1')
    RETURNING id`,
  );
  jobId = rows[0]!.id;
});

afterAll(async () => {
  await truncateMatchTables(migrator);
  await migrator.end();
  await server.end();
});

describe("RLS（アプリの認可分岐を通らない経路）", () => {
  it("生の SELECT でも、他人のジョブは 0 行", async () => {
    const rows = await withActor(
      server,
      stranger,
      (tx) => tx`SELECT id FROM transcription_jobs WHERE id = ${jobId}`,
    );
    expect(rows).toHaveLength(0);
  });

  it("リポジトリ関数を直接呼んでも見えない（assertMatchAccess を経由しない）", async () => {
    const byId = await withActor(server, stranger, (tx) => findJobById(tx, jobId));
    expect(byId).toBeNull();

    const list = await withActor(server, stranger, (tx) => listJobs(tx, matchId));
    expect(list).toEqual([]);
  });

  it("持ち主には見える（テストが「常に 0 行」で空回りしていないこと）", async () => {
    const mine = await withActor(server, owner, (tx) => findJobById(tx, jobId));
    expect(mine?.id).toBe(jobId);
  });

  it("app.actor_id を設定しない経路では 1 行も見えない", async () => {
    // withActor を通らない生の接続。ポリシーは current_setting を見るので、
    // 設定が無ければ誰にも一致しない
    const rows = await server`SELECT id FROM transcription_jobs`;
    expect(rows).toHaveLength(0);
  });

  /**
   * **止めているのは RLS ではなく許諾トリガである**（HANDOFF 件17）。
   *
   * BEFORE INSERT トリガが RLS の WITH CHECK より先に走る。
   * `assert_consent_recorded()` は SECURITY INVOKER なので呼び出し元のロールで
   * `matches` を読み、stranger には見えない。**見えない match は「許諾なし」に見える＝
   * 拒否側に倒れる。** よって AD001 で落ち、RLS の WITH CHECK までは届かない。
   *
   * この経路が表に出ることはない。API 層（`auth: "match:write"`）が先に 404 を返すためである。
   *
   * **SQLSTATE が AD001 であることを明示的に検査する。**
   * 「拒否されればどちらでもよい」と広げた条件（例: /許諾|row-level security/）にすると、
   * 許諾トリガが外れて RLS だけになっても、その逆になっても通ってしまう。
   * どちらの壁で止まるかは段階2 で確かめた設計の性質そのものなので、そこを固定する。
   * あわせて、行が増えていないことも見る（拒否の形だけを見て件数を見ないと、
   * 「例外は出たが行は入った」を見逃す）。
   */
  it("他人の match へジョブを差し込めない（許諾トリガ AD001 が先に効く）", async () => {
    const before = await withActor(server, owner, (tx) => listJobs(tx, matchId));

    await expect(
      withActor(
        server,
        stranger,
        (tx) => tx`
        INSERT INTO transcription_jobs (match_id, kind, target_stage_no, params_hash,
                                        provider_id, model)
        VALUES (${matchId}, 'anchor', NULL, ${hash()}, 'stub', 'stub-v1')`,
      ),
    ).rejects.toMatchObject({ code: SQLSTATE.CONSENT_REQUIRED });

    // 件12: 件数の比較は app_server ＋ withActor で読む。
    // 所有者接続で数えると 0 と 0 を比べて通ってしまう
    const after = await withActor(server, owner, (tx) => listJobs(tx, matchId));
    expect(after).toHaveLength(before.length);
  });

  it("他人のジョブを UPDATE できない（0 行で静かに終わる）", async () => {
    // 例外ではなく 0 行になる。RLS の UPDATE は「見えない行を対象にしない」ためである。
    // 静かに成功したように見えるので、呼び出し側は必ず RETURNING の件数を見ること
    const updated = await withActor(
      server,
      stranger,
      (tx) => tx`
      UPDATE transcription_jobs SET status = 'canceled', finished_at = now()
       WHERE id = ${jobId} RETURNING id`,
    );
    expect(updated).toHaveLength(0);
  });

  it("DELETE のポリシーが無いので、持ち主でも消せない", async () => {
    // retry は行を作り直さず status を戻す操作であり、ジョブを消す経路は設計に無い。
    // 実行履歴（attempt / metrics / error）はコスト実績の突合に使う
    const deleted = await withActor(
      server,
      owner,
      (tx) => tx`DELETE FROM transcription_jobs WHERE id = ${jobId} RETURNING id`,
    );
    expect(deleted).toHaveLength(0);
  });
});

describe("システム actor（DATA_MODEL.md §4.1）", () => {
  it("UUID は SQL 関数だけが持つ（TS 側から値を渡していない）", async () => {
    // withSystemActor は set_config に SQL 式を渡す。TS は値を知らない。
    // 実際に app.actor_id が設定されていることを SQL 側で確かめる
    const rows = await withSystemActor(
      server,
      (tx) => tx<{ ok: boolean }[]>`
      SELECT public.app_actor_id() = public.system_actor_id() AS ok`,
    );
    expect(rows[0]?.ok).toBe(true);
  });

  it("全 match のジョブが見える（match_access に居なくても）", async () => {
    const rows = await withSystemActor(
      server,
      (tx) => tx`SELECT id FROM transcription_jobs WHERE id = ${jobId}`,
    );
    expect(rows).toHaveLength(1);
  });

  it("ジョブを UPDATE できる（ランナーの仕事）", async () => {
    const updated = await withSystemActor(
      server,
      (tx) => tx`
      UPDATE transcription_jobs
         SET status = 'running', started_at = now(), attempt = attempt + 1,
             lock_version = lock_version + 1
       WHERE id = ${jobId} RETURNING id`,
    );
    expect(updated).toHaveLength(1);

    // 戻す。以降の検査に影響させない
    await withSystemActor(
      server,
      (tx) => tx`
      UPDATE transcription_jobs SET status = 'canceled', finished_at = now()
       WHERE id = ${jobId}`,
    );
  });

  it("edit_logs を書ける（ランナーが何をしたかを残せる）", async () => {
    // **RETURNING を付けない。** audit.flush も付けていない（下の検査がその理由）
    await withSystemActor(
      server,
      (tx) => tx`
      INSERT INTO edit_logs (match_id, entity, entity_id, before, after, actor)
      VALUES (${matchId}, 'transcription_jobs', ${jobId}, NULL, NULL,
              public.app_actor_id())`,
    );

    // 書けたことは、その match の持ち主から読んで確かめる。
    // システム actor 自身は edit_logs を読めない（最後の検査）
    const rows = await withActor(
      server,
      owner,
      (tx) => tx`
      SELECT actor FROM edit_logs
       WHERE match_id = ${matchId} AND entity = 'transcription_jobs'`,
    );
    expect(rows).toHaveLength(1);
  });

  /**
   * **`INSERT ... RETURNING` は通らない。実測:**
   *
   *   RETURNING あり: new row violates row-level security policy for table "edit_logs"
   *   RETURNING なし: OK（行は入る）
   *
   * `RETURNING` は挿入した行を読み返すため、INSERT の WITH CHECK に加えて
   * **SELECT ポリシーが適用される**。`edit_logs_select_member` にはシステム actor の節が無い
   * （0003 で意図的に足していない。ランナーは edit_logs を読まない）。
   *
   * `audit.flush()` は `RETURNING` を付けていないので、本番の経路は通る。
   * **付けた瞬間に内部ジョブの経路だけが落ちる。** この検査はその線を固定するためにある。
   */
  it("edit_logs への INSERT に RETURNING を付けると落ちる（SELECT ポリシーが効くため）", async () => {
    await expect(
      withSystemActor(
        server,
        (tx) => tx`
        INSERT INTO edit_logs (match_id, entity, entity_id, before, after, actor)
        VALUES (${matchId}, 'returning-probe', NULL, NULL, NULL, public.app_actor_id())
        RETURNING id`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("他人の名前では edit_logs を書けない（actor = app_actor_id() の縛りは残っている）", async () => {
    await expect(
      withSystemActor(
        server,
        (tx) => tx`
        INSERT INTO edit_logs (match_id, entity, entity_id, before, after, actor)
        VALUES (${matchId}, 'transcription_jobs', ${jobId}, NULL, NULL, ${owner})`,
      ),
    ).rejects.toThrow(/row-level security|violates/);
  });

  /**
   * **節を足したのは 2 表だけである。**
   * matches / media_sources には足していない。ランナーは INSERT をしない（UPDATE だけ）ので、
   * 許諾トリガ（assert_consent_recorded は SECURITY INVOKER）に当たらない。
   * P5 で署名URLを取りに media_sources を読む必要が出たら、この検査が落ちる。
   * そのとき「節を足す」か「専用ロールへ移す」かを判断すること（HANDOFF 件36 の隣）。
   */
  it("matches は見えない（節を足していない）", async () => {
    const rows = await withSystemActor(
      server,
      (tx) => tx`SELECT id FROM matches WHERE id = ${matchId}`,
    );
    expect(rows).toHaveLength(0);
  });

  it("media_sources は見えない（節を足していない）", async () => {
    const rows = await withSystemActor(server, (tx) => tx`SELECT id FROM media_sources`);
    expect(rows).toHaveLength(0);
  });

  it("edit_logs は読めない（書けるが読めない。読む必要が無い）", async () => {
    const rows = await withSystemActor(
      server,
      (tx) => tx`SELECT id FROM edit_logs WHERE match_id = ${matchId}`,
    );
    expect(rows).toHaveLength(0);
  });
});
