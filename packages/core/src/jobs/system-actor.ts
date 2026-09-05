/**
 * 内部ジョブランナーの実行主体（DATA_MODEL.md §4.1 / API_SPEC.md §0.2）。
 *
 * 【UUID をここに書かない】
 * 値の定義は drizzle/0003_p4_jobs.sql の public.system_actor_id() ただ 1 つである。
 * このファイルは値を**読み出しもしない**。set_config に SQL 式を渡し、比較も SQL でする。
 * TS が値を持たなければ、SQL 側と食い違いようがない。
 *
 * 2 箇所に UUID を書くと、片方だけ変えたときに
 *   - ポリシーが誰にも一致しない → ランナーが黙って 0 行になる
 *   - 古い値が通り続ける         → 塞いだつもりの穴が開いたまま
 * のどちらかになり、どちらもテストが緑のまま起きる。
 */
import type { Sql, TransactionSql } from "postgres";
import { ApiError } from "../http/errors";

/**
 * ランナー用にトランザクションを開く。
 *
 * actor id は SQL 側で決まる。`withActor` と違い、呼び出し側が値を渡さない
 * （渡せるようにすると、そこがもう 1 つの定義箇所になる）。
 *
 * この主体が見えるのは `transcription_jobs` と `edit_logs` だけである
 * （0003 でその 2 表のポリシーにだけ節を足した）。`matches` も `media_sources` も見えない。
 */
export async function withSystemActor<T>(
  sql: Sql,
  fn: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('app.actor_id', public.system_actor_id()::text, true)`;
    return fn(tx);
  }) as Promise<T>;
}

/**
 * JWT 経路のガード。**`SET LOCAL` の直後、ハンドラの最初のクエリより前に呼ぶ。**
 *
 * `sub` がシステム actor の JWT を弾かないと、その UUID のトークンを作れる者が
 * 全 match のジョブと編集履歴を読める。RLS はこの主体を「ランナー」として通すためである。
 *
 * 401 にする。403 だと「その actor は存在するが権限が無い」と読めてしまい、
 * システム actor の値を探る手掛かりになる。
 */
export async function assertNotSystemActor(tx: TransactionSql): Promise<void> {
  const rows = await tx<{ is_system: boolean }[]>`
    SELECT public.app_actor_id() = public.system_actor_id() AS is_system`;

  if (rows[0]?.is_system) {
    throw new ApiError("UNAUTHENTICATED", "このトークンでは操作できません");
  }
}
