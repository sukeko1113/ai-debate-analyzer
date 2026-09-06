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
 * 証明構造の3ノード（ARGUMENT_MODEL.md §1）＋ どれにも当たらない `OTHER`。
 *
 * Evidence / Warrant は**第4のノードではない**。A/B/C が成立する理由の質を表す
 * Support Quality タグ（EVIDENCE / WARRANT / RELEVANCE / BURDEN）として
 * argument_node_scores の level 理由に保存する（§1.1）。
 * 引用の記録（出典・年度・氏名）である evidence_refs とはさらに別物である。
 */
export const NodeType = z.enum(["A_OBSERVATION", "B_LINK", "C_IMPACT", "OTHER"]);
export type NodeType = z.infer<typeof NodeType>;

export const ArgumentNode = z
  .object({
    id: Uuid,
    issueId: Uuid.nullable(),
    kind: NodeKind,
    /** CLAIM 以外は null 可 */
    nodeType: NodeType.nullable(),
    /** 因果の順序。B_LINK だけが持つ（P = chain_rule(A, B1..Bn)） */
    linkOrder: z.number().int().positive().nullable(),
    stageNo: z.number().int().min(1).max(12),
    text: z.string(),
    /** 根拠時刻へ必ず戻れる。0件のノードは作らせない（ACCEPTANCE.md M21） */
    segmentIds: z.array(Uuid).min(1),
    reviewStatus: ReviewStatus,
  })
  .refine((n) => (n.nodeType === "B_LINK" ? n.linkOrder !== null : n.linkOrder === null), {
    message: "linkOrder は B_LINK だけが持つ（ARGUMENT_MODEL.md §1）",
    path: ["linkOrder"],
  });
export type ArgumentNode = z.infer<typeof ArgumentNode>;

/** ATTACKS の種別（ARGUMENT_MODEL.md §2.1）。11値 */
export const AttackEffectKind = z.enum([
  // → A_OBSERVATION
  "not_true",
  "not_unique",
  "not_necessary",
  // → B_LINK
  "no_link",
  "no_solvency",
  "alternative_solves",
  "not_solvent",
  // → C_IMPACT
  "not_important",
  "value_turn",
  // → Support Quality
  "evidence_weak",
  "logic_jump",
]);
export type AttackEffectKind = z.infer<typeof AttackEffectKind>;

/** DEFENDS の種別（ARGUMENT_MODEL.md §2.2）。7値 */
export const DefendEffectKind = z.enum([
  "re_evidence",
  "re_explain",
  "counter_example",
  "mitigate",
  "re_link",
  "concede",
  "alt_limited",
]);
export type DefendEffectKind = z.infer<typeof DefendEffectKind>;

/**
 * ANSWERS の種別（ARGUMENT_MODEL.md §2.3）。2値。
 *
 * ANSWERS では effect_kind は**任意**である。質疑で答えをずらしたこと自体は
 * 判定材料になるが、後続スピーチで明示的に引用されたときだけ AI 参考 P/V へ反映する
 * （scoring_config.qa_effect_mode = 'cited_only' が既定）。
 */
export const AnswerEffectKind = z.enum(["admits", "declines_to_answer"]);
export type AnswerEffectKind = z.infer<typeof AnswerEffectKind>;

/** 3者の和（20値）。clash_events.attack_type（8値）とは別語彙である（§2.4） */
export const EffectKind = z.enum([
  ...AttackEffectKind.options,
  ...DefendEffectKind.options,
  ...AnswerEffectKind.options,
]);
export type EffectKind = z.infer<typeof EffectKind>;

/**
 * 各 Attack が主に狙う node_type（ARGUMENT_MODEL.md §2.1 の「主な対象 node_type」列）。
 * 検出の手掛かりであり、これ以外のノードを攻撃できないという意味ではない。
 *
 * `SUPPORT` は node_type の値ではない。A/B/C ノードの Support Quality タグ（§1.1）へ
 * 向かう攻撃であることを示す。evidence がノードでなくなったため、行き先も node_type ではない。
 */
export const ATTACK_TARGET_NODE_TYPE: Record<AttackEffectKind, NodeType | "SUPPORT"> = {
  not_true: "A_OBSERVATION",
  not_unique: "A_OBSERVATION",
  not_necessary: "A_OBSERVATION",
  no_link: "B_LINK",
  no_solvency: "B_LINK",
  alternative_solves: "B_LINK",
  not_solvent: "B_LINK",
  not_important: "C_IMPACT",
  value_turn: "C_IMPACT",
  evidence_weak: "SUPPORT",
  logic_jump: "SUPPORT",
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
const isAnswerKind = (k: EffectKind): k is AnswerEffectKind =>
  (AnswerEffectKind.options as readonly string[]).includes(k);

export const FlowLink = z
  .object({
    id: Uuid,
    from: Uuid,
    to: Uuid,
    relation: Relation,
    /** そのやりとりが何をしたか（ARGUMENT_MODEL.md §2）。ATTACKS / DEFENDS / ANSWERS のみ持つ */
    effectKind: EffectKind.nullable().default(null),
    /** 比較の中身。Summary の COMPARES リンクだけが持つ（ARGUMENT_MODEL.md §5） */
    comparison: z.array(ComparisonAxis).default([]),
    confidence: z.number().min(0).max(1),
    reviewStatus: ReviewStatus,
  })
  .refine(
    (l) => {
      switch (l.relation) {
        case "ATTACKS":
          return l.effectKind !== null && isAttackKind(l.effectKind);
        case "DEFENDS":
          return l.effectKind !== null && isDefendKind(l.effectKind);
        // 質疑の応答は「答えをずらした」を必ず付けられるとは限らない。任意にする
        case "ANSWERS":
          return l.effectKind === null || isAnswerKind(l.effectKind);
        default:
          return l.effectKind === null;
      }
    },
    {
      message:
        "relation に許されない effectKind（ARGUMENT_MODEL.md §2）。ATTACKS / DEFENDS では必須、ANSWERS では任意、それ以外は null",
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
