/**
 * フローのドメインスキーマ（BASIC_DESIGN_v09.md §13.2 / ARGUMENT_MODEL.md §1・§2・§5）。
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
    /**
     * そのやりとりがどれだけ効いたか。再解析は *_ai だけを更新し、*_human に触らない。
     * 表示は COALESCE(human, ai)。判定（Human Ballot）はここを読まない（JUDGE_LOGIC.md §1.1）。
     */
    effectivenessAi: z.enum(["strong", "partial", "none"]).nullable(),
    effectivenessHuman: z.enum(["strong", "partial", "none"]).nullable(),
    /** 人が書いたときだけサーバが入れる。AI は書けない */
    effectivenessSetBy: Uuid.nullable(),
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
  );
export type FlowLink = z.infer<typeof FlowLink>;

/**
 * Summary の COMPARES リンクに付く比較の中身（ARGUMENT_MODEL.md §5.1）。
 *
 * v05 では flow_links.comparison（jsonb）に持っていた。どの Issue とどの Issue を
 * 比べたのかがリンクの端点からしか分からず、比較そのものをレビュー単位にできなかったので、
 * 別テーブルへ分離した（v09 §13.2）。
 *
 * axes[].source と SummaryLink.source は一致させる。「ディベーターの比較」と
 * 「ジャッジ独自の比較」が1つの SummaryLink に混ざると、判定理由に
 * 「試合中に比較基準が示されなかった」と書くべきかを機械で決められなくなる（§5.2）。
 */
export const SummaryLink = z
  .object({
    id: Uuid,
    /** COMPARES の flow_link */
    linkId: Uuid,
    ownIssueId: Uuid,
    opponentIssueId: Uuid,
    source: z.enum(["debater", "judge"]),
    axes: z.array(ComparisonAxis).min(1),
    reviewStatus: ReviewStatus,
  })
  .refine((s) => s.axes.every((a) => a.source === s.source), {
    message: "axes の source は SummaryLink の source と一致する（ARGUMENT_MODEL.md §5.2）",
    path: ["axes"],
  });
export type SummaryLink = z.infer<typeof SummaryLink>;

/**
 * ルール違反の候補（HENDA_RULESET.md §3）。
 *
 * すべて候補フラグであり、自動で判定から除外しない。
 * 条項 4.2.2 は「新しい議論かどうかの判断はジャッジが行う」と定めている。
 *
 * audibility_gap / stage_coverage_gap は「聞き取れなかった」「記録が無い」の印であり、
 * DROPS（応答しなかった）とは別の事象である。判定材料になるのは DROPS だけで、
 * この2つは**DROPS を導出できないこと**を人に伝えるために立てる。
 * 逆向きに使って DROPS を作らない（CLAUDE.md の絶対原則）。
 */
export const RuleFlagType = z.enum([
  // 大会ルールの条項に対応する9種
  "new_argument",
  "extra_issue",
  "over_time",
  "over_word_limit",
  "over_speech_rate",
  "speaker_role_mismatch",
  "evidence_incomplete",
  "own_calculation",
  "premature_rebuttal",
  // 以下6種は条項番号を持たない。記録の欠損と、判定理由への混入に関する本アプリ側の規則
  /** 対象区間に audibility = unheard があり、DROPS を導出できない */
  "audibility_gap",
  /** 応答義務のあったステージの coverage_status が complete でない */
  "stage_coverage_gap",
  "stage_duration_anomaly",
  "segment_duration_anomaly",
  /** delivery の語彙が Voting Issue / Strength の理由に混入している */
  "communication_in_content",
  /** 相手ステージにノードが1つも無く、DROPS リンクを作れない */
  "dropped",
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
