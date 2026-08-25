/**
 * RLS テストが空回りしていないことの検証（P0 受け入れ基準 ②）。
 *
 * テーブルの所有者は RLS を素通りする（DEV_ENVIRONMENTS.md §5）。
 * 所有者で接続したまま rls.test.ts と同じ検証を書くと、
 * 「通ったように見えて何も検証していない」状態になる。
 *
 * ここでは rls.test.ts が使うのと同じ assertTenantIsolation を、
 * 接続ロールだけ所有者（app_migrator）に替えて呼び、**落ちること**を確かめる。
 * 検証内容が同一でなければ比較にならないので、同じ関数を使う。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { withActor } from "../../packages/core/src/db/client";
import {
  ACTOR_A,
  PROBE_FORCED,
  PROBE_UNFORCED,
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

describe("所有者を接続ロールにすると RLS テストは空回りする", () => {
  it("同じ表・同じ検証でも、app_server なら通り、所有者なら落ちる", async () => {
    // 接続ロール app_server: RLS が効く
    await expect(assertTenantIsolation(server, PROBE_UNFORCED)).resolves.toBeUndefined();

    // 接続ロール app_migrator（＝この表の所有者）: FORCE が無ければ素通りする
    await expect(assertTenantIsolation(migrator, PROBE_UNFORCED)).rejects.toThrow(/素通り/);
  });

  it("所有者には他人の行がそのまま見える（FORCE なしの表）", async () => {
    const rows = await withActor(migrator, ACTOR_A, async (tx) =>
      tx.unsafe<{ actor_id: string }[]>(`SELECT actor_id FROM public.${PROBE_UNFORCED}`),
    );
    expect(rows.length).toBe(2);
    expect(rows.some((r) => r.actor_id !== ACTOR_A)).toBe(true);
  });

  it("FORCE ROW LEVEL SECURITY を付けると所有者も素通りしない", async () => {
    // app_migrator に適用されるポリシーは無い（ポリシーは TO app_server）ので 0 行になる。
    // 「所有者にも全部見える」の反対側であり、FORCE がこの穴を塞ぐことの確認。
    const rows = await withActor(migrator, ACTOR_A, async (tx) =>
      tx.unsafe<{ actor_id: string }[]>(`SELECT actor_id FROM public.${PROBE_FORCED}`),
    );
    expect(rows).toHaveLength(0);

    // 素通りはしないが、これはこれで検証としては成立しない（自分の行すら見えない）。
    // つまり所有者接続では、どちらに転んでも RLS の検証にならない。
    await expect(assertTenantIsolation(migrator, PROBE_FORCED)).rejects.toThrow(
      /自分の行すら見えていません/,
    );
  });

  it("プローブ表に GRANT を書いていないのに app_server が読めている（DEFAULT PRIVILEGES の確認）", async () => {
    const [priv] = await migrator<{ ok: boolean }[]>`
      SELECT has_table_privilege('app_server', ${"public." + PROBE_FORCED}, 'SELECT') AS ok`;
    expect(priv?.ok).toBe(true);
  });
});
