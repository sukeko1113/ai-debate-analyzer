/**
 * API を通らない経路でも DB が拒否すること。
 *
 * 受け入れ基準4は「API と DB トリガの両方で拒否する」である。
 * 片方だけにすると迂回経路ができる。ここでは **API を一切通さず**、
 * app_server 接続の生 SQL で直接叩いて、DB 側が落とすことを確かめる。
 *
 * ACCEPTANCE.md M14（許諾）と、DATA_MODEL.md §10（edit_logs は追記のみ）。
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql, TransactionSql } from "postgres";
import { withActor } from "../../packages/core/src/db/client";
import { migratorClient, serverClient, truncateMatchTables } from "./helpers/probe";
import { newActorId } from "./helpers/api";

let migrator: Sql;
let server: Sql;
const actor = newActorId();

/** API を通さずに match を作る。DB 側の防御だけを見たいので、あえて生 SQL で作る */
async function seedMatch(tx: TransactionSql): Promise<string> {
  const rows = await tx<{ id: string }[]>`
    INSERT INTO matches (motion, aff_team, neg_team, ruleset_version, created_by)
    VALUES ('合成データの論題', '架空第一高校', '架空第二高校', '2025-11-28', ${actor})
    RETURNING id`;
  const id = rows[0]!.id;
  await tx`INSERT INTO match_access (match_id, actor_id, role) VALUES (${id}, ${actor}, 'owner')`;
  return id;
}

beforeAll(async () => {
  migrator = migratorClient();
  server = serverClient();
  await truncateMatchTables(migrator);
});

afterAll(async () => {
  await truncateMatchTables(migrator);
  await migrator.end();
  await server.end();
});

describe("許諾（DB トリガ・受け入れ基準4の DB 側）", () => {
  it("consent_recorded_at が null のまま status を draft から動かすと SQLSTATE AD001 で拒否される", async () => {
    await expect(
      withActor(server, actor, async (tx) => {
        const id = await seedMatch(tx);
        await tx`UPDATE matches SET status = 'analyzing' WHERE id = ${id}`;
      }),
    ).rejects.toMatchObject({ code: "AD001" });
  });

  it("draft のままの更新は通る", async () => {
    await withActor(server, actor, async (tx) => {
      const id = await seedMatch(tx);
      const res = await tx`UPDATE matches SET round = 'Final' WHERE id = ${id}`;
      expect(res.count).toBe(1);
    });
  });

  it("許諾を記録したあとは status を動かせる", async () => {
    await withActor(server, actor, async (tx) => {
      const id = await seedMatch(tx);
      await tx`
        UPDATE matches
           SET consent_scope = 'practice_only',
               consent_obtained_from = ARRAY['student'],
               consent_recorded_at = now()
         WHERE id = ${id}`;
      const res = await tx`UPDATE matches SET status = 'analyzing' WHERE id = ${id}`;
      expect(res.count).toBe(1);
    });
  });

  it("INSERT の時点で draft 以外にしようとしても拒否される（トリガの抜け道を作らない）", async () => {
    await expect(
      withActor(
        server,
        actor,
        (tx) => tx`
          INSERT INTO matches (motion, aff_team, neg_team, ruleset_version, created_by, status)
          VALUES ('抜け道', 'A', 'B', '2025-11-28', ${actor}, 'analyzing')`,
      ),
    ).rejects.toMatchObject({ code: "AD001" });
  });

  it("assert_consent_recorded() は P4 のジョブ表からも使える形になっている", async () => {
    // P2 に transcription_jobs は無い。関数が再利用できる形であることだけを確かめる。
    // P4 はこの関数を BEFORE INSERT トリガから呼ぶこと。
    //
    // 例外が出るとトランザクション全体が中断されるので、検査ごとに開き直す。
    const id = await withActor(server, actor, (tx) => seedMatch(tx));

    await expect(
      withActor(server, actor, (tx) => tx`SELECT public.assert_consent_recorded(${id})`),
    ).rejects.toMatchObject({ code: "AD001" });

    await withActor(
      server,
      actor,
      (tx) => tx`
        UPDATE matches SET consent_scope = 'practice_only',
                           consent_obtained_from = ARRAY['student'],
                           consent_recorded_at = now()
         WHERE id = ${id}`,
    );

    await expect(
      withActor(server, actor, (tx) => tx`SELECT public.assert_consent_recorded(${id})`),
    ).resolves.toBeDefined();
  });

  it("見えない match に対しては拒否側へ倒れる", async () => {
    const stranger = newActorId();
    const id = await withActor(server, actor, (tx) => seedMatch(tx));
    await expect(
      withActor(server, stranger, (tx) => tx`SELECT public.assert_consent_recorded(${id})`),
    ).rejects.toMatchObject({ code: "AD001" });
  });

  it("記録済みと言うなら範囲と取得元が埋まっていること（CHECK 制約）", async () => {
    await expect(
      withActor(server, actor, async (tx) => {
        const id = await seedMatch(tx);
        await tx`UPDATE matches SET consent_recorded_at = now() WHERE id = ${id}`;
      }),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

describe("edit_logs は追記のみ（DATA_MODEL.md §10）", () => {
  it("UPDATE は SQLSTATE AD002 で拒否される", async () => {
    await expect(
      withActor(server, actor, async (tx) => {
        const id = await seedMatch(tx);
        await tx`
          INSERT INTO edit_logs (match_id, entity, entity_id, before, after, actor)
          VALUES (${id}, 'matches', ${id}, ${null}, ${tx.json({ a: 1 })}, ${actor})`;
        await tx`UPDATE edit_logs SET after = ${tx.json({ a: 2 })} WHERE match_id = ${id}`;
      }),
    ).rejects.toMatchObject({ code: "AD002" });
  });

  it("DELETE も SQLSTATE AD002 で拒否される", async () => {
    await expect(
      withActor(server, actor, async (tx) => {
        const id = await seedMatch(tx);
        await tx`
          INSERT INTO edit_logs (match_id, entity, entity_id, before, after, actor)
          VALUES (${id}, 'matches', ${id}, ${null}, ${tx.json({ a: 1 })}, ${actor})`;
        await tx`DELETE FROM edit_logs WHERE match_id = ${id}`;
      }),
    ).rejects.toMatchObject({ code: "AD002" });
  });

  it("拒否は『0 行更新』ではなく例外である（消えたと誤解させない）", async () => {
    // UPDATE / DELETE にもポリシーを置いてあるため、RLS で静かに 0 行になるのではなく
    // トリガが明示的に落とす。ポリシーを外すと、この検査は「例外なし」で落ちる
    const policies = await migrator<{ cmd: string }[]>`
      SELECT cmd FROM pg_policies WHERE tablename = 'edit_logs'`;
    expect(policies.map((p) => p.cmd).sort()).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"]);
  });

  it("他人になりすました actor では INSERT できない", async () => {
    const other = newActorId();
    await expect(
      withActor(server, actor, async (tx) => {
        const id = await seedMatch(tx);
        await tx`
          INSERT INTO edit_logs (match_id, entity, entity_id, before, after, actor)
          VALUES (${id}, 'matches', ${id}, ${null}, ${null}, ${other})`;
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("match_members の座席（条項 2.2）", () => {
  it("3人チームに A4 は入らない（CHECK 制約）", async () => {
    await expect(
      withActor(server, actor, async (tx) => {
        const id = await seedMatch(tx);
        await tx`
          INSERT INTO match_members (match_id, side, seat, display_name, team_size)
          VALUES (${id}, 'AFF', 'A4', '名前', 3)`;
      }),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("side と seat の食い違いは DB でも作れない", async () => {
    await expect(
      withActor(server, actor, async (tx) => {
        const id = await seedMatch(tx);
        await tx`
          INSERT INTO match_members (match_id, side, seat, display_name, team_size)
          VALUES (${id}, 'NEG', 'A1', '名前', 4)`;
      }),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("同じ座席を二人に割り当てられない", async () => {
    await expect(
      withActor(server, actor, async (tx) => {
        const id = await seedMatch(tx);
        await tx`
          INSERT INTO match_members (match_id, side, seat, display_name, team_size)
          VALUES (${id}, 'AFF', 'A1', '一人目', 4), (${id}, 'AFF', 'A1', '二人目', 4)`;
      }),
    ).rejects.toMatchObject({ code: "23505" });
  });
});

describe("Idempotency-Key の記録（API_SPEC.md §0.4）", () => {
  it("他人のキーは見えない", async () => {
    const other = newActorId();
    const key = randomUUID();
    await withActor(
      server,
      actor,
      (tx) => tx`
        INSERT INTO api_idempotency_keys (actor_id, key, endpoint, request_hash, status_code, response)
        VALUES (${actor}, ${key}, 'POST /matches', 'hash', 201, ${tx.json({ data: {} })})`,
    );
    const rows = await withActor(
      server,
      other,
      (tx) => tx`SELECT * FROM api_idempotency_keys WHERE key = ${key}`,
    );
    expect(rows).toHaveLength(0);
  });
});
