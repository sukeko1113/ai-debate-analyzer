/**
 * ジョブの状態機械（TRANSCRIPTION.md §6.1）。
 *
 *   queued ──> running ──> succeeded
 *                 │
 *                 ├──> failed     (attempt < max なら queued へ戻す)
 *                 └──> canceled
 *
 * 【ここと DB のトリガは同じ表である】
 * 辺の定義は 2 箇所にある。この表と、drizzle/0003_p4_jobs.sql の
 * transcription_jobs_guard_transition() である。片方だけ直すと、
 * アプリが許して DB が拒む（500 になる）か、DB が許してアプリが拒む
 * （経路によって挙動が違う）状態になる。
 *
 * **tests/db/job-transitions.test.ts が全 25 組（5 状態 × 5 状態）で
 * この表と実物のトリガを突き合わせる。** ずれたらそこで落ちる。
 *
 * DB を持たないのは、こちらが二重目だからである。一重目はトリガであり、
 * この表を消しても不正な遷移は DB で止まる。
 * ここに置くのは、API が 409 を返す判断を DB 往復なしで行うためである。
 */

export const JOB_STATUSES = ["queued", "running", "succeeded", "failed", "canceled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * 許す辺だけを列挙する。
 *
 * - `succeeded` / `canceled` は終端。ここから動かない
 * - `failed → queued` が retry（部分再実行。ACCEPTANCE.md M42）。
 *   **行を作り直さない。** attempt / metrics / error を消すと、
 *   何回失敗したかが分からなくなる
 */
export const ALLOWED_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  queued: ["running", "canceled"],
  running: ["succeeded", "failed", "canceled"],
  succeeded: [],
  failed: ["queued"],
  canceled: [],
};

/**
 * 遷移できるか。
 *
 * **同じ状態への「遷移」は true を返す。** metrics の追記など、状態を変えない更新を
 * 弾かないためである。トリガも `NEW.status = OLD.status` を素通しにしている。
 */
export function canTransition(from: JobStatus, to: JobStatus): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** 終端。retry も cancel も効かない */
export function isTerminal(status: JobStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}
