/**
 * transcription_jobs の読み書き（DATA_MODEL.md §4 / API_SPEC.md §3）。
 *
 * ここを通るクエリはすべて defineHandler が開いたトランザクション上で走る。
 * つまり SET LOCAL app.actor_id 済みであり、RLS が効いている。
 * tx を受け取らない関数をこのファイルに足さないこと。
 *
 * **状態を変える UPDATE は、DB のトリガ（transcription_jobs_guard_transition）が
 * 二重目の網になっている。** ここの分岐を消しても、不正な遷移は DB で止まる
 * （AD003 → 409 VERSION_CONFLICT）。
 */
import type { TransactionSql } from "postgres";
import { ApiError, SQLSTATE } from "../../http/errors";
import type { JobStatus } from "../../jobs/state";
import type { Job, JobKind, JobMetrics } from "../../schema/job";

interface JobRow {
  id: string;
  match_id: string;
  kind: string;
  target_stage_no: number | null;
  status: string;
  attempt: number;
  max_attempt: number;
  provider_id: string | null;
  model: string | null;
  params_hash: string;
  idempotency_key: string | null;
  lock_version: number;
  started_at: Date | null;
  finished_at: Date | null;
  metrics: Record<string, unknown>;
  error: string | null;
  created_at: Date;
}

export function toJob(row: JobRow): Job {
  return {
    id: row.id,
    matchId: row.match_id,
    kind: row.kind as JobKind,
    targetStageNo: row.target_stage_no,
    status: row.status as JobStatus,
    attempt: row.attempt,
    maxAttempt: row.max_attempt,
    providerId: row.provider_id,
    model: row.model,
    paramsHash: row.params_hash,
    lockVersion: row.lock_version,
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
    metrics: row.metrics,
    error: row.error,
    createdAt: row.created_at.toISOString(),
  };
}

/** id から引く。match_id も返るので matchIdFrom に使える（HANDOFF 件25） */
export async function findJobById(tx: TransactionSql, id: string): Promise<Job | null> {
  const rows = await tx<JobRow[]>`SELECT * FROM transcription_jobs WHERE id = ${id}`;
  const row = rows[0];
  return row ? toJob(row) : null;
}

/** 見えなければ 404。403 にすると存在が漏れる（HANDOFF 件14） */
export async function requireJob(tx: TransactionSql, id: string): Promise<Job> {
  const job = await findJobById(tx, id);
  if (!job) throw new ApiError("NOT_FOUND", "対象のジョブが見つかりません");
  return job;
}

/** ポーリング用（API_SPEC.md §3）。古い順 */
export async function listJobs(tx: TransactionSql, matchId: string): Promise<Job[]> {
  const rows = await tx<JobRow[]>`
    SELECT * FROM transcription_jobs
     WHERE match_id = ${matchId}
     ORDER BY created_at ASC`;
  return rows.map(toJob);
}

export interface CreateJobInput {
  matchId: string;
  kind: JobKind;
  targetStageNo: number | null;
  paramsHash: string;
  providerId: string;
  model: string;
  idempotencyKey: string | null;
}

export type CreateJobOutcome =
  { status: "created"; job: Job } | { status: "already_exists"; job: Job };

/**
 * 作成（API_SPEC.md §3）。
 *
 * **INSERT を先に撃ち、UNIQUE 違反（23505）を捕まえて SELECT し直す。**
 * 先に SELECT してから INSERT する形は、二つのリクエストが同時に来たときの
 * 競合を防げない（SELECT と INSERT の間に他方が INSERT できてしまう）。
 *
 * **savepoint で囲む。** postgres.js のトランザクションは、1 つ例外が出ると
 * 全体が中断する（HANDOFF 件13）。UNIQUE 違反をそのまま外へ出すと、
 * 続く SELECT が「current transaction is aborted」で落ちる（件26 で実測済み）。
 *
 * 許諾は BEFORE INSERT トリガが止める（AD001 → 409 CONSENT_REQUIRED）。
 * ここで consent_recorded_at を読み直さない。条件を 2 箇所に書くと、片方だけ直る。
 */
export async function createJob(
  tx: TransactionSql,
  input: CreateJobInput,
): Promise<CreateJobOutcome> {
  let inserted: JobRow | undefined;
  try {
    inserted = await tx.savepoint(async (sp) => {
      const rows = await sp<JobRow[]>`
        INSERT INTO transcription_jobs (match_id, kind, target_stage_no, params_hash,
                                        provider_id, model, idempotency_key)
        VALUES (${input.matchId}, ${input.kind}, ${input.targetStageNo}, ${input.paramsHash},
                ${input.providerId}, ${input.model}, ${input.idempotencyKey})
        RETURNING *`;
      return rows[0];
    });
  } catch (error) {
    if ((error as { code?: string })?.code !== SQLSTATE.UNIQUE_VIOLATION) throw error;
  }

  if (inserted) return { status: "created", job: toJob(inserted) };

  // ここから先は「同じ冪等キーの行が既にある」場合だけ。
  // target_stage_no が NULL の kind でも当たる（UNIQUE NULLS NOT DISTINCT）
  const rows = await tx<JobRow[]>`
    SELECT * FROM transcription_jobs
     WHERE match_id = ${input.matchId}
       AND kind = ${input.kind}
       AND target_stage_no IS NOT DISTINCT FROM ${input.targetStageNo}
       AND params_hash = ${input.paramsHash}`;

  const existing = rows[0];
  if (!existing) {
    // UNIQUE に当たったのに引けない＝同じ match の行が見えない、は起こり得ない
    // （match_id が同じなら同じ可視性）。起きたら設計の想定違反なので隠さない
    throw new ApiError("INTERNAL", "重複を検出しましたが対象の行を読み出せませんでした");
  }

  return { status: "already_exists", job: toJob(existing) };
}

/**
 * 失敗したジョブを queued へ戻す（部分再実行。ACCEPTANCE.md M42）。
 *
 * **行を作り直さない。** attempt / metrics / error / started_at をそのまま残す。
 * 消すと「何回失敗したか」「何が起きたか」が分からなくなる
 * （TRANSCRIPTION.md §6.3「失敗時に人手の確認結果ごとリセットする」）。
 */
export async function retryJob(
  tx: TransactionSql,
  id: string,
  expectedVersion: number,
): Promise<Job> {
  const job = await requireJob(tx, id);

  if (job.status !== "failed") {
    throw new ApiError(
      "JOB_ALREADY_RUNNING",
      `再実行できるのは failed のジョブだけです（現在: ${job.status}）`,
    );
  }

  // **`max_attempt` は総試行回数の上限である**（判断: 利用者・2026-09-03。
  // TRANSCRIPTION.md §6.2）。人の retry を別勘定にしない。
  // 別勘定にすると attempt が実際の試行回数を表さなくなり、
  // 「行を作り直さず attempt を積み上げる」という決め方と食い違う。
  //
  // ここで止めないと、queued に戻したのに claimNextJob（attempt < max_attempt）が
  // 永遠に拾わないジョブができる。黙って進まないのが一番悪い。
  //
  // 409 VERSION_CONFLICT にする。cancel を終了状態に撃ったときと同じ
  // 「この行はもう動かせない」という事実であり、新しい語彙を増やさない。
  // JOB_ALREADY_RUNNING は「走っている」の意味なので、走っていないここでは嘘になる。
  // ただし VERSION_CONFLICT だけでは理由が分からないので、数字をメッセージに入れる。
  if (job.attempt >= job.maxAttempt) {
    throw new ApiError(
      "VERSION_CONFLICT",
      `試行回数の上限に達しています（${job.attempt}/${job.maxAttempt}）`,
      { currentVersion: job.lockVersion },
    );
  }

  const rows = await tx<JobRow[]>`
    UPDATE transcription_jobs
       SET status = 'queued', lock_version = lock_version + 1
     WHERE id = ${id} AND lock_version = ${expectedVersion}
    RETURNING *`;

  return toJob(assertUpdated(rows, job.lockVersion));
}

/**
 * 実行前・実行中のジョブを止める（API_SPEC.md §3）。
 *
 * 終端（succeeded / canceled）と failed には効かない。
 * 「終わったものを取り消す」を許すと、実績（metrics）の意味が変わる。
 */
export async function cancelJob(
  tx: TransactionSql,
  id: string,
  expectedVersion: number,
): Promise<Job> {
  const job = await requireJob(tx, id);

  if (job.status !== "queued" && job.status !== "running") {
    throw new ApiError(
      "VERSION_CONFLICT",
      `このジョブはもう取り消せません（現在: ${job.status}）`,
      { currentVersion: job.lockVersion },
    );
  }

  const rows = await tx<JobRow[]>`
    UPDATE transcription_jobs
       SET status = 'canceled', finished_at = now(), lock_version = lock_version + 1
     WHERE id = ${id} AND lock_version = ${expectedVersion}
    RETURNING *`;

  return toJob(assertUpdated(rows, job.lockVersion));
}

/**
 * 次の 1 件を `running` にして返す。無ければ null。
 *
 * **`FOR UPDATE SKIP LOCKED`。** 無いと、二つのランナーが同じ行で待ち合わせ、
 * 片方が「1 件進めた」もう片方が「同じ 1 件を進めた」になる。
 * `SKIP LOCKED` なら後発は次の行へ進み、行が無ければ何もせず終わる。
 *
 * `attempt` はここで増やす。走らせた回数であって、成功した回数ではない。
 */
export async function claimNextJob(
  tx: TransactionSql,
  matchId: string | null,
): Promise<Job | null> {
  const rows = await tx<JobRow[]>`
    UPDATE transcription_jobs
       SET status       = 'running',
           started_at   = now(),
           attempt      = attempt + 1,
           lock_version = lock_version + 1
     WHERE id = (
       SELECT id FROM transcription_jobs
        WHERE status = 'queued'
          AND (${matchId}::uuid IS NULL OR match_id = ${matchId}::uuid)
          AND attempt < max_attempt
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
    RETURNING *`;

  const row = rows[0];
  return row ? toJob(row) : null;
}

/**
 * 実行の結果を書く（runner.ts の 3 分割のうちの 1 つ）。
 *
 * 成功か失敗かで列が違うだけなので、呼び出し側に分岐を書かせない。
 * `JobResult` は判別可能なユニオンなので、片方を書き忘れると型検査で落ちる。
 */
export async function finishJob(
  tx: TransactionSql,
  id: string,
  result:
    | { status: "succeeded"; providerId: string; model: string; metrics: JobMetrics }
    | { status: "failed"; message: string; metrics: JobMetrics },
): Promise<Job> {
  return result.status === "succeeded" ? markSucceeded(tx, id, result) : markFailed(tx, id, result);
}

/** 成功。metrics と provider を残す（ACCEPTANCE.md M43。DB の CHECK も要求する） */
async function markSucceeded(
  tx: TransactionSql,
  id: string,
  input: { providerId: string; model: string; metrics: JobMetrics },
): Promise<Job> {
  const rows = await tx<JobRow[]>`
    UPDATE transcription_jobs
       SET status       = 'succeeded',
           finished_at  = now(),
           provider_id  = ${input.providerId},
           model        = ${input.model},
           metrics      = ${tx.json(input.metrics as never)},
           error        = NULL,
           lock_version = lock_version + 1
     WHERE id = ${id}
    RETURNING *`;

  const row = rows[0];
  if (!row) throw new ApiError("NOT_FOUND", "対象のジョブが見つかりません");
  return toJob(row);
}

/**
 * 失敗。**metrics は残す。** 失敗までに掛かった時間もコスト実績である。
 *
 * `attempt < max_attempt` なら queued へ戻すのはランナーの判断であり、
 * ここではしない（TRANSCRIPTION.md §6.1 の「attempt < max なら queued へ戻す」は
 * failed を経由する）。1 つの UPDATE で 2 つの遷移を表すと、
 * 失敗したことが履歴に残らない。
 */
async function markFailed(
  tx: TransactionSql,
  id: string,
  input: { message: string; metrics: JobMetrics },
): Promise<Job> {
  const rows = await tx<JobRow[]>`
    UPDATE transcription_jobs
       SET status       = 'failed',
           finished_at  = now(),
           metrics      = ${tx.json(input.metrics as never)},
           error        = ${input.message},
           lock_version = lock_version + 1
     WHERE id = ${id}
    RETURNING *`;

  const row = rows[0];
  if (!row) throw new ApiError("NOT_FOUND", "対象のジョブが見つかりません");
  return toJob(row);
}

/**
 * 条件付き UPDATE が 0 行だったときの切り分け。
 *
 * ここへ来る時点で requireJob が通っている（＝RLS では見えている）ので、
 * 0 行の理由は版のずれだけである。updateWithVersion を使わないのは、
 * 状態の検査を先に済ませてあり、もう一度 SELECT し直す必要が無いからである。
 */
function assertUpdated(rows: JobRow[], currentVersion: number): JobRow {
  const row = rows[0];
  if (row) return row;
  throw new ApiError("VERSION_CONFLICT", "他の変更と競合しました", { currentVersion });
}
