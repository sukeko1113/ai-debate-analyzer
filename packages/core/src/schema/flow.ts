/**
 * フローのドメインスキーマ（BASIC_DESIGN_v05 §13.2 / ARGUMENT_MODEL.md §1・§2・§5）。
 *
 * 守ること:
 *   - ArgumentNode は segmentIds を1つ以上持つ。原音の時刻へ戻れない議論は保存しない
 *   - AI の出力は suggested 層に入る。confirmed / excluded はサーバの API だけが書く
 *   - RuleFlag は候補止まり。自動で判定から除外しない（条項 4.2.2）
 */
import { z } from "zod";
import { Uuid } from "./ids";
import { ReviewStatus } from "./review";

export const Side = z.enum(["AFF", "NEG"]);
export type Side = z.infer<typeof Side>;

/** AD/DA とも各側最大2（条項 2.1.1.3 / 2.1.2.1） */
export const IssueLabel = z.enum(["AD1", "AD2", "DA1", "DA2"]);
export type IssueLabel = z.infer<typeof IssueLabel>;

/**
 * Issue。label（AD1 等）はサーバが割り当てる。AI に生成させない（JUDGE_LOGIC.md §2）。
 */
export const Issue = z
  .object({
    id: Uuid,
    label: IssueLabel,
    side: Side,
    title: z.string().max(120),
    reviewStatus: ReviewStatus,
  })
  .refine((i) => (i.label.startsWith("AD") ? i.side === "AFF" : i.side === "NEG"), {
    message: "Advantage は肯定側、Disadvantage は否定側の Issue である（条項 2.1.1 / 2.1.2）",
    path: ["side"],
  });
export type Issue = z.infer<typeof Issue>;

export const NodeKind = z.enum([
  "CLAIM",
  "ATTACK",
  "DEFENSE",
  "QUESTION",
  "ANSWER",
  "SUMMARY_POINT",
]);
export type NodeKind = z.infer<typeof NodeKind>;

/**
 * 議論の4構成要素（ARGUMENT_MODEL.md §1）＋ どれにも当たらない `other`。
 *
 * `role: 'evidence'` は「なぜそう言えるか」を述べた言明であり、攻撃対象になる。
 * 引用の記録（出典・年度・氏名）である evidence_refs とは別物（§1.1）。
 */
export const ArgumentRole = z.enum(["present", "effect", "importance", "evidence", "other"]);
export type ArgumentRole = z.infer<typeof ArgumentRole>;

export const ArgumentNode = z.object({
  id: Uuid,
  issueId: Uuid.nullable(),
  kind: NodeKind,
  role: ArgumentRole.nullable(),
  stageNo: z.number().int().min(1).max(12),
  text: z.string(),
  /** 根拠時刻へ必ず戻れる。0件のノードは作らせない（ACCEPTANCE.md M21） */
  segmentIds: z.array(Uuid).min(1),
  reviewStatus: ReviewStatus,
});
export type ArgumentNode = z.infer<typeof ArgumentNode>;

/** ATTACKS の種別（ARGUMENT_MODEL.md §2.1） */
export const AttackEffectKind = z.enum([
  "not_true",
  "not_unique",
  "not_necessary",
  "no_link",
  "no_solvency",
  "not_important",
  "value_turn",
  "evidence_weak",
  "logic_jump",
]);
export type AttackEffectKind = z.infer<typeof AttackEffectKind>;

/** DEFENDS の種別（ARGUMENT_MODEL.md §2.2） */
export const DefendEffectKind = z.enum([
  "re_evidence",
  "re_explain",
  "counter_example",
  "mitigate",
]);
export type DefendEffectKind = z.infer<typeof DefendEffectKind>;

export const EffectKind = z.enum([...AttackEffectKind.options, ...DefendEffectKind.options]);
export type EffectKind = z.infer<typeof EffectKind>;

/**
 * 各 Attack が主に狙う role（ARGUMENT_MODEL.md §2.1 の「主な対象 role」列）。
 * 検出の手掛かりであり、これ以外の role を攻撃できないという意味ではない。
 */
export const ATTACK_TARGET_ROLE: Record<AttackEffectKind, ArgumentRole> = {
  not_true: "present",
  not_unique: "present",
  not_necessary: "present",
  no_link: "effect",
  no_solvency: "effect",
  not_important: "importance",
  value_turn: "importance",
  evidence_weak: "evidence",
  logic_jump: "evidence",
};

/**
 * Impact 比較の4軸（ARGUMENT_MODEL.md §5）。
 *
 * 4軸はいずれも理由の記述であり、点数ではない。数値へ置換しない（JUDGE_LOGIC.md §1.1）。
 * 比較基準が試合中に示されなければジャッジ独自の判断で比較してよいので、
 * `source` で誰が持ち出した比較かを区別する（§5.2）。
 */
export const ComparisonAxis = z
  .object({
    axis: z.enum(["magnitude", "probability", "timeframe", "value"]),
    favors: z.enum(["AFF", "NEG", "neither"]),
    rationale: z.string().min(1),
    source: z.enum(["debater", "judge"]),
    segmentIds: z.array(Uuid),
  })
  .refine((o) => o.source === "judge" || o.segmentIds.length >= 1, {
    message: "ディベーター由来の比較は根拠segmentを必須とする",
    path: ["segmentIds"],
  });
export type ComparisonAxis = z.infer<typeof ComparisonAxis>;

export const Relation = z.enum([
  "ATTACKS",
  "DEFENDS",
  "EXTENDS",
  "COMPARES",
  "QUESTIONS",
  "ANSWERS",
  "CITES",
  "DROPS",
]);
export type Relation = z.infer<typeof Relation>;

const isAttackKind = (k: EffectKind): k is AttackEffectKind =>
  (AttackEffectKind.options as readonly string[]).includes(k);
const isDefendKind = (k: EffectKind): k is DefendEffectKind =>
  (DefendEffectKind.options as readonly string[]).includes(k);

export const FlowLink = z
  .object({
    id: Uuid,
    from: Uuid,
    to: Uuid,
    relation: Relation,
    /** そのやりとりが何をしたか（ARGUMENT_MODEL.md §2）。ATTACKS / DEFENDS のみ持つ */
    effectKind: EffectKind.nullable().default(null),
    /** 比較の中身。Summary の COMPARES リンクだけが持つ（ARGUMENT_MODEL.md §5） */
    comparison: z.array(ComparisonAxis).default([]),
    confidence: z.number().min(0).max(1),
    reviewStatus: ReviewStatus,
  })
  .refine(
    (l) => {
      if (l.relation === "ATTACKS") return l.effectKind !== null && isAttackKind(l.effectKind);
      if (l.relation === "DEFENDS") return l.effectKind !== null && isDefendKind(l.effectKind);
      return l.effectKind === null;
    },
    {
      message:
        "effectKind は ATTACKS / DEFENDS のときだけ持ち、語彙もそれぞれの表に従う（ARGUMENT_MODEL.md §2）",
      path: ["effectKind"],
    },
  )
  .refine((l) => l.relation === "COMPARES" || l.comparison.length === 0, {
    message: "comparison を持てるのは COMPARES のリンクだけ（ARGUMENT_MODEL.md §5）",
    path: ["comparison"],
  });
export type FlowLink = z.infer<typeof FlowLink>;

/**
 * ルール違反の候補（HENDA_RULESET.md §3）。
 *
 * すべて候補フラグであり、自動で判定から除外しない。
 * 条項 4.2.2 は「新しい議論かどうかの判断はジャッジが行う」と定めている。
 */
export const RuleFlagType = z.enum([
  "new_argument",
  "extra_issue",
  "over_time",
  "over_word_limit",
  "over_speech_rate",
  "speaker_role_mismatch",
  "evidence_incomplete",
  "own_calculation",
  "premature_rebuttal",
]);
export type RuleFlagType = z.infer<typeof RuleFlagType>;

export const RuleFlag = z.object({
  id: Uuid,
  type: RuleFlagType,
  targetRef: z.string().min(1),
  rationale: z.string().min(1),
  status: z.enum(["candidate", "confirmed", "rejected"]),
});
export type RuleFlag = z.infer<typeof RuleFlag>;
