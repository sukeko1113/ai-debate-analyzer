/**
 * ジョブを 1 件進める（API_SPEC.md §3.1 / TRANSCRIPTION.md §6）。
 *
 * 【3 つに分けてある（判断: 利用者・2026-09-03）】
 *
 *   claimNextJob(tx, matchId)      … DB。queued → running（db/repo/jobs.ts）
 *   executeJob(job, providers)     … **DB を見ない。** ネットワークはここだけ
 *   finishJob(tx, id, result)      … DB。succeeded / failed と metrics（db/repo/jobs.ts）
 *
 * **P4 では、この 3 つを 1 つのトランザクションの中で順に呼ぶ**（下の runOneJob）。
 * P4 の provider は stub でネットワークを使わず瞬時に終わるため、それで成り立つ。
 *
 * **P5 では成り立たない。** 実 provider は 1 ジョブ 2〜4 分のネットワーク呼び出しになり、
 * その間トランザクションを開けたままにすると Supavisor の接続を占有し続ける。
 * P5 で変えるのは**呼び方だけ**である。
 *
 *   claim（tx1） → executeJob（tx の外） → finish（tx2）
 *
 * 3 つの関数の中身は直さない。そのために分けてある。
 *
 * 1 回の呼び出しで進めるのは**最大 1 件**。
 * ポーリング（POST /matches/{id}/jobs/run）と Cron（POST /internal/jobs/run）の
 * どちらも同じ上限である。
 */
import type { TransactionSql } from "postgres";
import { claimNextJob, finishJob } from "../db/repo/jobs";
import type { Job, JobMetrics } from "../schema/job";
import { ProviderError, type Providers } from "../transcription";

export type RunOutcome = { status: "idle" } | { status: "ran"; job: Job };

export type JobResult =
  | { status: "succeeded"; providerId: string; model: string; metrics: JobMetrics }
  | { status: "failed"; message: string; metrics: JobMetrics };

/**
 * 種類ごとの実行。**DB を見ない。トランザクションを受け取らない。**
 *
 * P5 でこの関数だけがトランザクションの外へ出る。DB を触らせないのは、
 * そのときに「実は tx が要る」と分かって作り直しになるのを防ぐためである。
 *
 * **P4 は結果を保存しない。** stub が形を返すところまでで、
 * align_words（P5）・stage_segments（P6/P7）・transcript_segments（P8）は作らない。
 * 保存先の表がまだ無いのに書く経路を作ると、Phase A の縦切りが崩れる。
 */
export async function executeJob(job: Job, providers: Providers): Promise<JobResult> {
  const startedAt = Date.now();
  const metrics = (): JobMetrics => ({ durationMs: Date.now() - startedAt });

  try {
    switch (job.kind) {
      case "align":
        // 署名URLは P5 で渡す。stub は URL を見ない
        await providers.align.align({ signedUrl: "", durationMs: 0 });
        break;

      case "stage_detect":
      case "anchor":
        // 純粋計算。P6・P9 で中身が入る。provider は要らない
        break;

      case "stage_transcribe":
        // ここへは来ない。POST /jobs が stage_segments 未確定として
        // 409 STAGES_NOT_CONFIRMED で作成を止めている（API_SPEC.md §3）。
        // 来たなら、その門が外れている
        throw new ProviderError(
          "stage_transcribe のジョブが作成されています（stage_segments の確認が先です）",
        );
    }

    return {
      status: "succeeded",
      providerId: job.providerId ?? providers.align.id,
      model: job.model ?? providers.align.model,
      metrics: metrics(),
    };
  } catch (error) {
    // **失敗を例外として外へ出さない。** 出すと claim ごと巻き戻り、
    // 「実行しようとした記録」が消える（attempt も error も残らない）。
    // 結果として返し、finishJob が failed として行に残す
    if (!(error instanceof ProviderError)) {
      // 想定外の例外の中身は応答に載せない（errors.ts と同じ方針）。ログにだけ残す
      console.error("[executeJob] 未処理の例外", error);
    }
    const message = error instanceof ProviderError ? error.message : "ジョブの実行に失敗しました";

    return { status: "failed", message, metrics: metrics() };
  }
}

/**
 * P4 の呼び方。3 つを 1 つのトランザクションで順に呼ぶ。
 *
 * **P5 で書き換わるのはこの関数だけ。3 つの中身は触らない。**
 * route に順序を書かせず、ここへ寄せてあるのはそのためでもある
 * （`/matches/{id}/jobs/run` と `/internal/jobs/run` の 2 本が同じ順序を持たない）。
 *
 * @param matchId その match に絞る。null なら全 match（Cron 用）
 */
export async function runOneJob(
  tx: TransactionSql,
  matchId: string | null,
  providers: Providers,
): Promise<RunOutcome> {
  const claimed = await claimNextJob(tx, matchId);
  if (!claimed) return { status: "idle" };

  const result = await executeJob(claimed, providers);
  const job = await finishJob(tx, claimed.id, result);

  return { status: "ran", job };
}
