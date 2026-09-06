/**
 * フローのドメインスキーマ（ARGUMENT_MODEL.md §1・§2・§5 / ACCEPTANCE.md M21・M26）。
 *
 * fixture は手書きの小さなものを使う。fixtures/gold-01 はまだ存在しない。
 */
import { describe, expect, it } from "vitest";
import {
  AnswerEffectKind,
  ArgumentNode,
  ATTACK_TARGET_NODE_TYPE,
  AttackEffectKind,
  ComparisonAxis,
  DefendEffectKind,
  EffectKind,
  FlowLink,
  Issue,
  NodeType,
  RuleFlag,
  RuleFlagType,
  SummaryLink,
} from "./flow";

const ID = {
  node1: "11111111-1111-4111-8111-111111111111",
  node2: "22222222-2222-4222-8222-222222222222",
  link: "33333333-3333-4333-8333-333333333333",
  issue: "44444444-4444-4444-8444-444444444444",
  seg: "55555555-5555-4555-8555-555555555555",
  issue2: "66666666-6666-4666-8666-666666666666",
  summary: "77777777-7777-4777-8777-777777777777",
} as const;

const claim = {
  id: ID.node1,
  issueId: ID.issue,
  kind: "CLAIM",
  nodeType: "B_LINK",
  linkOrder: 1,
  stageNo: 1,
  text: "Plan により通学時間が短縮される",
  segmentIds: [ID.seg],
  reviewStatus: "suggested",
};

const link = {
  id: ID.link,
  from: ID.node2,
  to: ID.node1,
  relation: "ATTACKS",
  effectKind: "no_link",
  effectivenessAi: null,
  effectivenessHuman: null,
  effectivenessSetBy: null,
  confidence: 0.7,
  reviewStatus: "suggested",
};

describe("Issue", () => {
  it("AD/DA の4ラベルだけを受ける（条項 2.1.1.3 / 2.1.2.1）", () => {
    expect(
      Issue.safeParse({
        id: ID.issue,
        label: "AD1",
        side: "AFF",
        title: "通学時間の短縮",
        reviewStatus: "suggested",
      }).success,
    ).toBe(true);
    for (const label of ["AD3", "DA3", "AD0", "ISSUE1"]) {
      expect(
        Issue.safeParse({
          id: ID.issue,
          label,
          side: "AFF",
          title: "x",
          reviewStatus: "suggested",
        }).success,
      ).toBe(false);
    }
  });

  it("Advantage が否定側になっていると失敗する", () => {
    expect(
      Issue.safeParse({
        id: ID.issue,
        label: "AD1",
        side: "NEG",
        title: "x",
        reviewStatus: "suggested",
      }).success,
    ).toBe(false);
    expect(
      Issue.safeParse({
        id: ID.issue,
        label: "DA1",
        side: "AFF",
        title: "x",
        reviewStatus: "suggested",
      }).success,
    ).toBe(false);
  });
});

describe("ArgumentNode", () => {
  it("node_type が証明構造の3ノード＋OTHER の4値（ARGUMENT_MODEL.md §1）", () => {
    expect(NodeType.options).toEqual(["A_OBSERVATION", "B_LINK", "C_IMPACT", "OTHER"]);
  });

  it("4値それぞれが受理される（linkOrder は B_LINK のときだけ入れる）", () => {
    for (const nodeType of NodeType.options) {
      const linkOrder = nodeType === "B_LINK" ? 1 : null;
      expect(ArgumentNode.safeParse({ ...claim, nodeType, linkOrder }).success).toBe(true);
    }
    expect(ArgumentNode.safeParse({ ...claim, nodeType: null, linkOrder: null }).success).toBe(
      true,
    );
  });

  it("表にない node_type は拒否される。v05 の role 語彙も通らない", () => {
    for (const nodeType of ["present", "effect", "importance", "evidence", "other", "SUPPORT"]) {
      expect(ArgumentNode.safeParse({ ...claim, nodeType }).success).toBe(false);
    }
  });

  it("linkOrder を持てるのは B_LINK だけ（ARGUMENT_MODEL.md §1）", () => {
    // B_LINK なのに順序が無い
    expect(ArgumentNode.safeParse({ ...claim, nodeType: "B_LINK", linkOrder: null }).success).toBe(
      false,
    );
    // B_LINK 以外なのに順序を持っている
    for (const nodeType of ["A_OBSERVATION", "C_IMPACT", "OTHER", null]) {
      expect(ArgumentNode.safeParse({ ...claim, nodeType, linkOrder: 1 }).success).toBe(false);
    }
  });

  it("linkOrder は正の整数（0 や小数は因果の順序にならない）", () => {
    for (const linkOrder of [0, -1, 1.5]) {
      expect(ArgumentNode.safeParse({ ...claim, linkOrder }).success).toBe(false);
    }
  });

  it("segmentIds が空だと失敗する（M21・原音の時刻へ戻れない議論は保存しない）", () => {
    expect(ArgumentNode.safeParse({ ...claim, segmentIds: [] }).success).toBe(false);
  });

  it("stageNo は 1..12", () => {
    expect(ArgumentNode.safeParse({ ...claim, stageNo: 0 }).success).toBe(false);
    expect(ArgumentNode.safeParse({ ...claim, stageNo: 13 }).success).toBe(false);
  });
});

describe("effect_kind の語彙（ARGUMENT_MODEL.md §2）", () => {
  it("ATTACKS の11種が §2.1 の表と一致する", () => {
    expect(AttackEffectKind.options).toEqual([
      "not_true",
      "not_unique",
      "not_necessary",
      "no_link",
      "no_solvency",
      "alternative_solves",
      "not_solvent",
      "not_important",
      "value_turn",
      "evidence_weak",
      "logic_jump",
    ]);
  });

  it("DEFENDS の7種が §2.2 の表と一致する", () => {
    expect(DefendEffectKind.options).toEqual([
      "re_evidence",
      "re_explain",
      "counter_example",
      "mitigate",
      "re_link",
      "concede",
      "alt_limited",
    ]);
  });

  it("ANSWERS の2種が §2.3 の表と一致する", () => {
    expect(AnswerEffectKind.options).toEqual(["admits", "declines_to_answer"]);
  });

  it("EffectKind は3者の和（20値）で、重複が無い", () => {
    expect(EffectKind.options).toEqual([
      ...AttackEffectKind.options,
      ...DefendEffectKind.options,
      ...AnswerEffectKind.options,
    ]);
    expect(new Set(EffectKind.options).size).toBe(EffectKind.options.length);
    expect(EffectKind.options).toHaveLength(20);
  });

  it("各 Attack の主な対象 node_type が §2.1 の表と一致する", () => {
    expect(ATTACK_TARGET_NODE_TYPE).toEqual({
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
    });
  });

  it("ATTACKS の全種別が対象表に載っている（表の取りこぼしを作らない）", () => {
    expect(Object.keys(ATTACK_TARGET_NODE_TYPE).sort()).toEqual(
      [...AttackEffectKind.options].sort(),
    );
  });

  it("case_flip は effect_kind ではない（立論での仕事であり rule_flags の候補）", () => {
    expect(EffectKind.options).not.toContain("case_flip");
  });
});

describe("FlowLink", () => {
  it("ATTACKS は攻撃の語彙を要求する", () => {
    expect(FlowLink.safeParse(link).success).toBe(true);
    expect(FlowLink.safeParse({ ...link, effectKind: "re_explain" }).success).toBe(false);
    expect(FlowLink.safeParse({ ...link, effectKind: null }).success).toBe(false);
  });

  it("DEFENDS は防御の語彙を要求する", () => {
    const defends = { ...link, relation: "DEFENDS", effectKind: "re_evidence" };
    expect(FlowLink.safeParse(defends).success).toBe(true);
    expect(FlowLink.safeParse({ ...defends, effectKind: "no_link" }).success).toBe(false);
  });

  it("ANSWERS は effectKind が任意（付けなくても、応答の語彙なら付けても通る）", () => {
    const answers = { ...link, relation: "ANSWERS", effectKind: null };
    expect(FlowLink.safeParse(answers).success).toBe(true);
    for (const effectKind of AnswerEffectKind.options) {
      expect(FlowLink.safeParse({ ...answers, effectKind }).success).toBe(true);
    }
    // 任意であっても語彙は閉じている。攻防の語彙は入れられない
    expect(FlowLink.safeParse({ ...answers, effectKind: "no_link" }).success).toBe(false);
    expect(FlowLink.safeParse({ ...answers, effectKind: "re_explain" }).success).toBe(false);
  });

  it("ATTACKS / DEFENDS に応答の語彙は入れられない", () => {
    expect(FlowLink.safeParse({ ...link, effectKind: "admits" }).success).toBe(false);
    expect(
      FlowLink.safeParse({ ...link, relation: "DEFENDS", effectKind: "declines_to_answer" })
        .success,
    ).toBe(false);
  });

  it("それ以外の relation は effectKind を持たない", () => {
    const cites = { ...link, relation: "CITES", effectKind: null };
    expect(FlowLink.safeParse(cites).success).toBe(true);
    expect(FlowLink.safeParse({ ...cites, effectKind: "no_link" }).success).toBe(false);
    expect(FlowLink.safeParse({ ...cites, effectKind: "admits" }).success).toBe(false);
  });

  it("比較の中身はもう FlowLink に無い（v09 で summary_links へ分離）", () => {
    const axis = {
      axis: "magnitude",
      favors: "AFF",
      rationale: "影響人数が桁違いに大きい",
      source: "judge",
      segmentIds: [],
    };
    const parsed = FlowLink.parse({ ...link, relation: "COMPARES", effectKind: null });
    expect(parsed).not.toHaveProperty("comparison");
    // 余計な comparison を渡しても、リンク側には保存されない
    expect(
      FlowLink.parse({ ...link, relation: "COMPARES", effectKind: null, comparison: [axis] }),
    ).not.toHaveProperty("comparison");
  });

  it("effectiveness は ai / human を別に持ち、既定は両方 null", () => {
    expect(FlowLink.safeParse({ ...link, effectivenessAi: "strong" }).success).toBe(true);
    expect(FlowLink.safeParse({ ...link, effectivenessHuman: "partial" }).success).toBe(true);
    expect(FlowLink.safeParse({ ...link, effectivenessAi: "weak" }).success).toBe(false);
    // 判定に使う語彙ではない。Strength の語彙（Strong/Weak/None）と混ぜない
    expect(FlowLink.safeParse({ ...link, effectivenessAi: "None" }).success).toBe(false);
  });

  it("confidence は 0..1", () => {
    expect(FlowLink.safeParse({ ...link, confidence: 1.1 }).success).toBe(false);
    expect(FlowLink.safeParse({ ...link, confidence: -0.1 }).success).toBe(false);
  });
});

describe("SummaryLink（ARGUMENT_MODEL.md §5.1）", () => {
  const axis = {
    axis: "magnitude",
    favors: "AFF",
    rationale: "影響人数が桁違いに大きい",
    source: "debater",
    segmentIds: [ID.seg],
  };
  const summaryLink = {
    id: ID.summary,
    linkId: ID.link,
    ownIssueId: ID.issue,
    opponentIssueId: ID.issue2,
    source: "debater",
    axes: [axis],
    reviewStatus: "suggested",
  };

  it("自分の Issue と相手の Issue、比較の軸、レビュー状態を持つ", () => {
    expect(SummaryLink.safeParse(summaryLink).success).toBe(true);
  });

  it("軸が空だと失敗する（比較の中身の無い比較を作らない）", () => {
    expect(SummaryLink.safeParse({ ...summaryLink, axes: [] }).success).toBe(false);
  });

  it("axes の source が SummaryLink の source と食い違うと失敗する（§5.2）", () => {
    expect(SummaryLink.safeParse({ ...summaryLink, source: "judge", axes: [axis] }).success).toBe(
      false,
    );
    expect(
      SummaryLink.safeParse({
        ...summaryLink,
        source: "judge",
        axes: [{ ...axis, source: "judge", segmentIds: [] }],
      }).success,
    ).toBe(true);
  });

  it("ディベーター由来の軸は根拠 segment を要求する（ComparisonAxis の refine が効く）", () => {
    expect(
      SummaryLink.safeParse({ ...summaryLink, axes: [{ ...axis, segmentIds: [] }] }).success,
    ).toBe(false);
  });
});

describe("ComparisonAxis（M26）", () => {
  const base = {
    axis: "probability",
    favors: "NEG",
    rationale: "Attack 後も因果が残っている",
    segmentIds: [ID.seg],
  };

  it("source='debater' かつ segmentIds が空だと失敗する", () => {
    expect(ComparisonAxis.safeParse({ ...base, source: "debater", segmentIds: [] }).success).toBe(
      false,
    );
  });

  it("source='debater' で根拠 segment があれば通る", () => {
    expect(ComparisonAxis.safeParse({ ...base, source: "debater" }).success).toBe(true);
  });

  it("source='judge' は segment 無しを許す（試合中に比較基準が示されなかった場合）", () => {
    expect(ComparisonAxis.safeParse({ ...base, source: "judge", segmentIds: [] }).success).toBe(
      true,
    );
  });

  it("4軸以外は受けない。rationale は必須（点数ではなく理由の記述）", () => {
    expect(ComparisonAxis.safeParse({ ...base, source: "judge", axis: "score" }).success).toBe(
      false,
    );
    expect(ComparisonAxis.safeParse({ ...base, source: "judge", rationale: "" }).success).toBe(
      false,
    );
  });
});

describe("RuleFlag", () => {
  it("HENDA_RULESET.md §3 の15種", () => {
    expect(RuleFlagType.options).toEqual([
      "new_argument",
      "extra_issue",
      "over_time",
      "over_word_limit",
      "over_speech_rate",
      "speaker_role_mismatch",
      "evidence_incomplete",
      "own_calculation",
      "premature_rebuttal",
      "audibility_gap",
      "stage_coverage_gap",
      "stage_duration_anomaly",
      "segment_duration_anomaly",
      "communication_in_content",
      "dropped",
    ]);
  });

  it("case_flip は RuleFlagType にも無い（立論での case flip は new_argument 候補）", () => {
    expect(RuleFlagType.options).not.toContain("case_flip");
  });

  it("聞き取れなかった・記録が無い・応答しなかったを別々の値で持つ", () => {
    // 判定材料になるのは DROPS だけ。unheard と欠損ステージからは DROPS を導出できない。
    // 導出できないことを人へ伝えるための印が、この2つである（HENDA_RULESET.md §3）
    expect(RuleFlagType.options).toContain("audibility_gap");
    expect(RuleFlagType.options).toContain("stage_coverage_gap");
    expect(RuleFlagType.options).toContain("dropped");
  });

  it("候補・確定・却下の3状態を持ち、根拠と対象が必須", () => {
    const flag = {
      id: ID.link,
      type: "new_argument",
      targetRef: ID.node1,
      rationale: "肯定総括で初出の Advantage（条項 4.2.2）",
      status: "candidate",
    };
    expect(RuleFlag.safeParse(flag).success).toBe(true);
    expect(RuleFlag.safeParse({ ...flag, status: "excluded" }).success).toBe(false);
    expect(RuleFlag.safeParse({ ...flag, rationale: "" }).success).toBe(false);
  });
});
