/**
 * negative test の無効化確認（ACCEPTANCE.md §1.1）の作業用。**一時ファイル。作業後に消す。**
 *
 * 守りを 1 つずつ外し、対応するテストが落ちることを確かめて戻す。
 *
 * 【戻せることを先に担保する】
 *   snapshot → 外す前の定義を JSON に控える
 *   off      → 外す
 *   on       → 控えから戻す（手で書き写さない）
 *   verify   → 戻した定義が控えと同一文字列であることを検査する
 *
 * Postgres は pg_get_triggerdef / pg_get_expr を正規化して返すので、
 * 同一文字列であれば「一字一句同じ」が保証される。
 *
 * db:migrate は __drizzle_migrations を見て 0003 を飛ばすため、戻しには使えない。
 */
import { readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";

const SNAP = "zz-snapshot.json";
const sql = postgres(process.env.DIRECT_URL, { max: 1, prepare: false, onnotice: () => {} });

async function shape() {
  const [trg] = await sql`
    SELECT pg_get_triggerdef(oid) AS def FROM pg_trigger
     WHERE tgrelid = 'public.transcription_jobs'::regclass
       AND tgname = 'transcription_jobs_guard_transition_trg'`;
  const [pol] = await sql`
    SELECT pg_get_expr(polqual, polrelid) AS qual FROM pg_policy
     WHERE polrelid = 'public.transcription_jobs'::regclass
       AND polname = 'transcription_jobs_select_member'`;
  return { trigger: trg?.def ?? null, policy: pol?.qual ?? null };
}

const cmd = process.argv[2];

try {
  if (cmd === "snapshot") {
    const s = await shape();
    writeFileSync(SNAP, JSON.stringify(s, null, 2));
    console.log("控えました:\n" + JSON.stringify(s, null, 2));
  } else if (cmd === "trigger:off") {
    await sql.unsafe(
      `DROP TRIGGER transcription_jobs_guard_transition_trg ON public.transcription_jobs`,
    );
    console.log("M36 の守りを外しました（状態遷移トリガ）");
  } else if (cmd === "trigger:on") {
    // 控えた定義文をそのまま流す。手で書き写さない
    const snap = JSON.parse(readFileSync(SNAP, "utf8"));
    await sql.unsafe(snap.trigger);
    console.log("戻しました");
  } else if (cmd === "policy:off") {
    // システム actor の節だけを外す。match_access 側の条件はそのまま
    await sql.unsafe(`
      DROP POLICY transcription_jobs_select_member ON public.transcription_jobs;
      CREATE POLICY transcription_jobs_select_member ON public.transcription_jobs
        FOR SELECT TO app_server
        USING (EXISTS (SELECT 1 FROM public.match_access ma
                        WHERE ma.match_id = transcription_jobs.match_id
                          AND ma.actor_id = public.app_actor_id()))`);
    console.log("M40 の守りを外しました（システム actor の節）");
  } else if (cmd === "policy:on") {
    const snap = JSON.parse(readFileSync(SNAP, "utf8"));
    await sql.unsafe(`
      DROP POLICY transcription_jobs_select_member ON public.transcription_jobs;
      CREATE POLICY transcription_jobs_select_member ON public.transcription_jobs
        FOR SELECT TO app_server USING (${snap.policy})`);
    console.log("戻しました");
  } else if (cmd === "verify") {
    const snap = JSON.parse(readFileSync(SNAP, "utf8"));
    const now = await shape();
    for (const key of ["trigger", "policy"]) {
      const same = snap[key] === now[key];
      console.log(`${key}: ${same ? "一致" : "不一致"}`);
      if (!same) console.log(`  控え: ${snap[key]}\n  現在: ${now[key]}`);
    }
  } else {
    throw new Error(`不明な指示: ${cmd}`);
  }
} finally {
  await sql.end();
}
