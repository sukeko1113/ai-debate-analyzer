/**
 * 判定スキーマ（JUDGE_LOGIC.md §1 / BASIC_DESIGN_v05 §13.3）。
 *
 * 引き分けは型でも表現できない。型レベルの検査は judge.test-d.ts にあり、
 * `npm run typecheck` で落ちる。ここでは実行時の検証を確かめる。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { IssueAssessment, JudgeDecision, JudgeRun, Strength, STRENGTH_ORDER } from "./judge";

const ID = {
  decision: "11111111-1111-4111-8111-111111111111",
  match: "22222222-2222-4222-8222-222222222222",
  run: "33333333-3333-4333-8333-333333333333",
  flowRun: "44444444-4444-4444-8444-444444444444",
  issue: "55555555-5555-4555-8555-555555555555",
  actor: "66666666-6666-4666-8666-666666666666",
} as const;

const decision = {
  id: ID.decision,
  matchId: ID.match,
  winner: "AFF",
  votingIssue: "AD1",
  commPoints: { aff: 4, neg: 3 },
  bestDebater: null,
  reason: "AD1 の Effect が Defense で回復し、DA1 の Probability が Lo に留まったため",
  decidedBy: ID.actor,
  lockedAt: null,
};

const assessment = {
  issueId: ID.issue,
  probability: "Hi",
  value: "Large",
  strength: "Strong",
  segmentIds: [],
};

describe("JudgeDecision.winner（条項 4.2 / §1.2）", () => {
  it("AFF と NEG だけを受ける", () => {
    expect(JudgeDecision.safeParse(decision).success).toBe(true);
    expect(JudgeDecision.safeParse({ ...decision, winner: "NEG" }).success).toBe(true);
  });

  it("引き分けを表す値はすべて拒否される", () => {
    for (const winner of ["DRAW", "TIE", "SPLIT", "draw", "", null]) {
      expect(JudgeDecision.safeParse({ ...decision, winner }).success).toBe(false);
    }
  });

  it("型レベルでも引き分けを書けない（judge.test-d.ts が typecheck で守る）", () => {
    const src = readFileSync(new URL("./judge.test-d.ts", import.meta.url), "utf8");
    expect(src).toContain("@ts-expect-error");
    expect(src).toContain('"DRAW"');
  });
});

describe("JudgeDecision.commPoints（条項 4.3）", () => {
  it("1〜5の整数を受ける", () => {
    for (const p of [1, 2, 3, 4, 5]) {
      expect(JudgeDecision.safeParse({ ...decision, commPoints: { aff: p, neg: p } }).success).toBe(
        true,
      );
    }
  });

  it("0 / 0.5 / 6 は拒否される", () => {
    for (const bad of [0, 0.5, 6]) {
      expect(
        JudgeDecision.safeParse({ ...decision, commPoints: { aff: bad, neg: 3 } }).success,
      ).toBe(false);
      expect(
        JudgeDecision.safeParse({ ...decision, commPoints: { aff: 3, neg: bad } }).success,
      ).toBe(false);
    }
  });

  it("負の値や 4.5 のような小数も拒否される", () => {
    for (const bad of [-1, 2.5, 4.5, 10]) {
      expect(
        JudgeDecision.safeParse({ ...decision, commPoints: { aff: bad, neg: 3 } }).success,
      ).toBe(false);
    }
  });
});

describe("JudgeDecision のその他", () => {
  it("votingIssue は AD/DA の4ラベルから1つ。省略できない", () => {
    expect(JudgeDecision.safeParse({ ...decision, votingIssue: "AD3" }).success).toBe(false);
    const { votingIssue: _omit, ...withoutVotingIssue } = decision;
    expect(JudgeDecision.safeParse(withoutVotingIssue).success).toBe(false);
  });

  it("判定理由は空にできない", () => {
    expect(JudgeDecision.safeParse({ ...decision, reason: "" }).success).toBe(false);
  });

  it("bestDebater は null を許す（AI は候補を出さず、人が入力する）", () => {
    expect(JudgeDecision.safeParse({ ...decision, bestDebater: "A1 の選手" }).success).toBe(true);
  });

  it("lockedAt は ISO8601 か null", () => {
    expect(JudgeDecision.safeParse({ ...decision, lockedAt: "2026-08-26T00:00:00Z" }).success).toBe(
      true,
    );
    expect(JudgeDecision.safeParse({ ...decision, lockedAt: "2026-08-26" }).success).toBe(false);
  });
});

describe("JudgeRun", () => {
  const run = {
    id: ID.run,
    matchId: ID.match,
    flowRunId: ID.flowRun,
    rulesetVersion: "2025-11-28",
    model: "stub",
    assessments: [assessment],
    votingIssueDraft: null,
    winnerDraft: null,
    newArgumentFlags: [],
  };

  it("AD/DA は各側最大2なので assessments は4件まで", () => {
    expect(JudgeRun.safeParse({ ...run, assessments: Array(4).fill(assessment) }).success).toBe(
      true,
    );
    expect(JudgeRun.safeParse({ ...run, assessments: Array(5).fill(assessment) }).success).toBe(
      false,
    );
  });

  it("候補は null を許す（AI が既定値を自動適用しないため）", () => {
    expect(JudgeRun.safeParse(run).success).toBe(true);
  });

  it("winnerDraft にも引き分けは入らない", () => {
    expect(JudgeRun.safeParse({ ...run, winnerDraft: "DRAW" }).success).toBe(false);
  });

  it("ruleset 版とモデル版は空にできない（どのルールとモデルで作られたかを追う）", () => {
    expect(JudgeRun.safeParse({ ...run, rulesetVersion: "" }).success).toBe(false);
    expect(JudgeRun.safeParse({ ...run, model: "" }).success).toBe(false);
  });
});

describe("Decision Chart の語彙（§1.1 数値へ置換しない）", () => {
  it("Probability / Value / Strength は公式の語彙のまま", () => {
    expect(IssueAssessment.safeParse(assessment).success).toBe(true);
    expect(IssueAssessment.safeParse({ ...assessment, probability: 80 }).success).toBe(false);
    expect(IssueAssessment.safeParse({ ...assessment, value: 3 }).success).toBe(false);
    expect(IssueAssessment.safeParse({ ...assessment, strength: 100 }).success).toBe(false);
    expect(Strength.options).toEqual(["Strong", "Weak", "None"]);
  });

  it("Strength の順序関係だけを持ち、点数化しない", () => {
    expect(STRENGTH_ORDER).toEqual(["None", "Weak", "Strong"]);
  });
});
