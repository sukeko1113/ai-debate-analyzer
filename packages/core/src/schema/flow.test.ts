/**
 * フローのドメインスキーマ（ARGUMENT_MODEL.md §1・§2・§5 / ACCEPTANCE.md M21・M26）。
 *
 * fixture は手書きの小さなものを使う。fixtures/gold-01 はまだ存在しない。
 */
import { describe, expect, it } from "vitest";
import {
  ArgumentNode,
  ArgumentRole,
  ATTACK_TARGET_ROLE,
  AttackEffectKind,
  ComparisonAxis,
  DefendEffectKind,
  EffectKind,
  FlowLink,
  Issue,
  RuleFlag,
  RuleFlagType,
} from "./flow";

const ID = {
  node1: "11111111-1111-4111-8111-111111111111",
  node2: "22222222-2222-4222-8222-222222222222",
  link: "33333333-3333-4333-8333-333333333333",
  issue: "44444444-4444-4444-8444-444444444444",
  seg: "55555555-5555-4555-8555-555555555555",
} as const;

const claim = {
  id: ID.node1,
  issueId: ID.issue,
  kind: "CLAIM",
  role: "effect",
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
  comparison: [],
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
  it("role が議論の4構成要素＋other の5値（ARGUMENT_MODEL.md §1）", () => {
    expect(ArgumentRole.options).toEqual(["present", "effect", "importance", "evidence", "other"]);
  });

  it("5値それぞれが受理される", () => {
    for (const role of ArgumentRole.options) {
      expect(ArgumentNode.safeParse({ ...claim, role }).success).toBe(true);
    }
    expect(ArgumentNode.safeParse({ ...claim, role: null }).success).toBe(true);
  });

  it("表にない role は拒否される", () => {
    for (const role of ["warrant", "impact", "inherency", "solvency"]) {
      expect(ArgumentNode.safeParse({ ...claim, role }).success).toBe(false);
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
  it("ATTACKS の9種が §2.1 の表と一致する", () => {
    expect(AttackEffectKind.options).toEqual([
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
  });

  it("DEFENDS の4種が §2.2 の表と一致する", () => {
    expect(DefendEffectKind.options).toEqual([
      "re_evidence",
      "re_explain",
      "counter_example",
      "mitigate",
    ]);
  });

  it("EffectKind は両者の和で、重複が無い", () => {
    expect(EffectKind.options).toEqual([...AttackEffectKind.options, ...DefendEffectKind.options]);
    expect(new Set(EffectKind.options).size).toBe(EffectKind.options.length);
  });

  it("各 Attack の主な対象 role が §2.1 の表と一致する", () => {
    expect(ATTACK_TARGET_ROLE).toEqual({
      not_true: "present",
      not_unique: "present",
      not_necessary: "present",
      no_link: "effect",
      no_solvency: "effect",
      not_important: "importance",
      value_turn: "importance",
      evidence_weak: "evidence",
      logic_jump: "evidence",
    });
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

  it("それ以外の relation は effectKind を持たない", () => {
    const cites = { ...link, relation: "CITES", effectKind: null };
    expect(FlowLink.safeParse(cites).success).toBe(true);
    expect(FlowLink.safeParse({ ...cites, effectKind: "no_link" }).success).toBe(false);
  });

  it("comparison を持てるのは COMPARES だけ（ARGUMENT_MODEL.md §5）", () => {
    const axis = {
      axis: "magnitude",
      favors: "AFF",
      rationale: "影響人数が桁違いに大きい",
      source: "judge",
      segmentIds: [],
    };
    expect(
      FlowLink.safeParse({
        ...link,
        relation: "COMPARES",
        effectKind: null,
        comparison: [axis],
      }).success,
    ).toBe(true);
    expect(FlowLink.safeParse({ ...link, comparison: [axis] }).success).toBe(false);
  });

  it("confidence は 0..1", () => {
    expect(FlowLink.safeParse({ ...link, confidence: 1.1 }).success).toBe(false);
    expect(FlowLink.safeParse({ ...link, confidence: -0.1 }).success).toBe(false);
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
  it("HENDA_RULESET.md §3 の9種", () => {
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
    ]);
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
