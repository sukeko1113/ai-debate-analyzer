/**
 * 判定のドメインスキーマ（BASIC_DESIGN_v05 §13.3 / JUDGE_LOGIC.md）。
 *
 * 守ること:
 *   - 引き分けを表現できないこと。winner は AFF か NEG の二択（条項 4.2 / §1.2）
 *   - Communication Points は 1〜5 の整数のみ。0 や 0.5 は不可（条項 4.3）
 *   - Hi/Lo・Large/Small・Strong/Weak/None を数値へ置換しない（§1.1）
 *   - AD/DA は各側最大2なので assessments は最大4件
 *   - effectiveness と comparison の4軸は判定に入らない。ここから参照しない
 *     （ARGUMENT_MODEL.md §3.4 / ACCEPTANCE.md M22）
 */
import { z } from "zod";
import { Uuid } from "./ids";
import { IssueLabel } from "./flow";

/** 公式 Decision Making Chart の語彙。0〜100点へ変換しない */
export const Probability = z.enum(["Hi", "Lo"]);
export type Probability = z.infer<typeof Probability>;

export const ImpactValue = z.enum(["Large", "Small"]);
export type ImpactValue = z.infer<typeof ImpactValue>;

export const Strength = z.enum(["Strong", "Weak", "None"]);
export type Strength = z.infer<typeof Strength>;

/**
 * 比較演算が必要な場合も順序関係だけを使い、差の大きさを数値化しない
 * （JUDGE_LOGIC.md §1.1）。並べ替えのためだけの序数である。
 */
export const STRENGTH_ORDER = ["None", "Weak", "Strong"] as const satisfies readonly Strength[];

export const IssueAssessment = z.object({
  issueId: Uuid,
  probability: Probability,
  value: ImpactValue,
  strength: Strength,
  segmentIds: z.array(Uuid),
});
export type IssueAssessment = z.infer<typeof IssueAssessment>;

/** AI の判定候補。確定ではない。ruleset 版とモデル版はサーバが記録する（§2） */
export const JudgeRun = z.object({
  id: Uuid,
  matchId: Uuid,
  flowRunId: Uuid,
  rulesetVersion: z.string().min(1),
  model: z.string().min(1),
  /** AD/DA 各側最大2 なので4件まで */
  assessments: z.array(IssueAssessment).max(4),
  votingIssueDraft: IssueLabel.nullable(),
  winnerDraft: z.enum(["AFF", "NEG"]).nullable(),
  newArgumentFlags: z.array(Uuid),
});
export type JudgeRun = z.infer<typeof JudgeRun>;

/** 人の確定。AI 案を上書きしない */
export const JudgeDecision = z.object({
  id: Uuid,
  matchId: Uuid,
  /** 引き分けは存在しない（条項 4.2 / JUDGE_LOGIC.md §1.2） */
  winner: z.enum(["AFF", "NEG"]),
  votingIssue: IssueLabel,
  /** 1〜5 の整数のみ。勝敗とは別枠（条項 4.3） */
  commPoints: z.object({
    aff: z.number().int().min(1).max(5),
    neg: z.number().int().min(1).max(5),
  }),
  /** 候補を出さない。人が入力する（JUDGE_LOGIC.md §1） */
  bestDebater: z.string().nullable(),
  reason: z.string().min(1),
  decidedBy: Uuid,
  lockedAt: z.iso.datetime().nullable(),
});
export type JudgeDecision = z.infer<typeof JudgeDecision>;
