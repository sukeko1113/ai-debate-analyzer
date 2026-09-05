/**
 * ジョブのドメインスキーマ（DATA_MODEL.md §4 / API_SPEC.md §3 / TRANSCRIPTION.md §6）。
 *
 * 件6 の判断に従い、リクエスト用スキーマは「保存済みの形」から導出する。
 * サーバが決める列（id / status / attempt / paramsHash / metrics …）は
 * リクエスト側に現れない。
 */
import { z } from "zod";
import { JOB_STATUSES } from "../jobs/state";
import { Uuid } from "./ids";

/**
 * 4 種（DATA_MODEL.md §4）。
 *
 * P4 の時点で実際に走るのは stub である。`stage_transcribe` は
 * `stage_segments` が無いため必ず 409 STAGES_NOT_CONFIRMED になる（P7 で実体が入る）。
 */
export const JobKind = z.enum(["align", "stage_detect", "stage_transcribe", "anchor"]);
export type JobKind = z.infer<typeof JobKind>;

export const JobStatus = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof JobStatus>;

/**
 * 実績（TRANSCRIPTION.md §6.2）。コスト実績の突合に使う。
 *
 * **`durationMs` は必須。** DB の CHECK
 * （transcription_jobs_success_metrics_check）が succeeded の行に要求する。
 * トークン量とコストは provider が返したときだけ入る（stub は返さない）。
 */
export const JobMetrics = z.object({
  durationMs: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
});
export type JobMetrics = z.infer<typeof JobMetrics>;

/** 保存済みの形（DATA_MODEL.md §4） */
export const Job = z.object({
  id: Uuid,
  matchId: Uuid,
  kind: JobKind,
  /** `stage_transcribe` のときだけ 1〜12。他は null（DB の CHECK が両方向で縛る） */
  targetStageNo: z.number().int().min(1).max(12).nullable(),
  status: JobStatus,
  attempt: z.number().int().nonnegative(),
  maxAttempt: z.number().int().positive(),
  providerId: z.string().nullable(),
  model: z.string().nullable(),
  /** サーバが決める。リクエストからは受け取らない（API_SPEC.md §3） */
  paramsHash: z.string().length(64),
  lockVersion: z.number().int().nonnegative(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
  metrics: z.record(z.string(), z.unknown()),
  error: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type Job = z.infer<typeof Job>;

// ---------------------------------------------------------------------------
// リクエスト / レスポンス（API_SPEC.md §3）
// ---------------------------------------------------------------------------

/**
 * ジョブ作成（API_SPEC.md §3）。
 *
 * **`paramsHash` も `providerId` も受け取らない。** 受け取ると、クライアントが
 * 冪等キーを選べる＝同じ内容の二重実行を自分で作れることになる。
 */
export const CreateJobReq = z.object({
  kind: JobKind,
  targetStageNo: z.number().int().min(1).max(12).nullable(),
});
export type CreateJobReq = z.infer<typeof CreateJobReq>;

/**
 * 作成の 2 通り。
 *
 * 同じ冪等キーのジョブが既にあれば `already_exists`（200）。
 * ここで 409 JOB_ALREADY_RUNNING を返さない（API_SPEC.md §3）。
 * 「二度押したら怒られる」ではなく「二度押しても同じものが返る」が冪等である。
 */
export const CreateJobRes = z.discriminatedUnion("status", [
  z.object({ status: z.literal("created"), job: Job }),
  z.object({ status: z.literal("already_exists"), job: Job }),
]);
export type CreateJobRes = z.infer<typeof CreateJobRes>;

/** ポーリング用（API_SPEC.md §3）。status / attempt / metrics を含む */
export const ListJobsRes = z.object({ jobs: z.array(Job) });
export type ListJobsRes = z.infer<typeof ListJobsRes>;

/**
 * 実行の結果（API_SPEC.md §3.1）。
 *
 * **1 回の呼び出しで最大 1 件。** 進めるものが無ければ `idle`。
 * 「何件進んだか」を返さないのは、上限が 1 件だと決まっているためである。
 */
export const RunJobRes = z.discriminatedUnion("status", [
  z.object({ status: z.literal("idle") }),
  z.object({ status: z.literal("ran"), job: Job }),
]);
export type RunJobRes = z.infer<typeof RunJobRes>;
