/**
 * Match 系スキーマ（API_SPEC.md §1）。
 *
 * HANDOFF.md 件6 の判断どおり、リクエスト用スキーマは Match から導出してある。
 * ここでは「導出しているから自動で正しい」で済ませず、
 * サーバが決める項目が入り込まないことを実際に確かめる。
 */
import { describe, expect, it } from "vitest";
import { ConsentReq, CreateMatchReq, Match, PatchMatchReq, PutMembersReq } from "./match";

const valid = {
  motion: "The Japanese government should abolish the death penalty.",
  heldOn: "2026-03-21",
  round: "予選1",
  affTeam: "架空第一高校",
  negTeam: "架空第二高校",
  rulesetId: "henda-20",
  rulesetVersion: "2025-11-28",
};

describe("CreateMatchReq（サーバが決める項目を受け取らない）", () => {
  it("正しい入力を通す", () => {
    expect(CreateMatchReq.safeParse(valid).success).toBe(true);
  });

  it("id / status / lockVersion / consent* / createdBy を持たない", () => {
    const keys = Object.keys(CreateMatchReq.shape);
    for (const forbidden of [
      "id",
      "status",
      "lockVersion",
      "createdBy",
      "createdAt",
      "consentScope",
      "consentRecordedAt",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("Match から導出されている（列が増えても手で写さない。HANDOFF 件6）", () => {
    for (const key of Object.keys(CreateMatchReq.shape)) {
      expect(Object.keys(Match.shape)).toContain(key);
    }
  });

  it("heldOn は日付の形でなければ落ちる", () => {
    expect(CreateMatchReq.safeParse({ ...valid, heldOn: "2026/03/21" }).success).toBe(false);
  });

  it("motion が空だと落ちる", () => {
    expect(CreateMatchReq.safeParse({ ...valid, motion: "" }).success).toBe(false);
  });
});

describe("PatchMatchReq（expectedVersion 必須。API_SPEC.md §0.3）", () => {
  it("expectedVersion を省略すると落ちる", () => {
    expect(PatchMatchReq.safeParse({ motion: "書き換え" }).success).toBe(false);
  });

  it("expectedVersion だけでは更新対象が無いので落ちる", () => {
    expect(PatchMatchReq.safeParse({ expectedVersion: 0 }).success).toBe(false);
  });

  it("expectedVersion ＋ 1 項目以上なら通る", () => {
    expect(PatchMatchReq.safeParse({ expectedVersion: 0, round: "Q-F" }).success).toBe(true);
  });

  it("consent は PATCH では書けない（POST /consent だけが書ける）", () => {
    const parsed = PatchMatchReq.safeParse({
      expectedVersion: 0,
      consentRecordedAt: "2026-03-21T00:00:00Z",
    });
    // 未知のキーは落とされるので、更新対象なしとして拒否される
    expect(parsed.success).toBe(false);
  });
});

describe("ConsentReq", () => {
  const consent = {
    expectedVersion: 0,
    scope: "practice_only",
    obtainedFrom: ["student"],
    expiresOn: null,
    note: "",
  };

  it("正しい入力を通す", () => {
    expect(ConsentReq.safeParse(consent).success).toBe(true);
  });

  it("expectedVersion を要求する（§0.3。§1 のスニペットには無いが一般規則を優先）", () => {
    const { expectedVersion: _drop, ...rest } = consent;
    expect(ConsentReq.safeParse(rest).success).toBe(false);
  });

  it("取得元が空だと落ちる", () => {
    expect(ConsentReq.safeParse({ ...consent, obtainedFrom: [] }).success).toBe(false);
  });

  it("知らない scope は落ちる", () => {
    expect(ConsentReq.safeParse({ ...consent, scope: "anything" }).success).toBe(false);
  });
});

describe("PutMembersReq（条項 2.2 の担当者表）", () => {
  const base = {
    expectedVersion: 0,
    teamSize: 4 as const,
    members: [{ side: "AFF" as const, seat: "A1" as const, displayName: "あ" }],
  };

  it("正しい入力を通す", () => {
    expect(PutMembersReq.safeParse(base).success).toBe(true);
  });

  it("seat と side が食い違うと落ちる（HANDOFF 件2 と同じ理屈）", () => {
    const bad = { ...base, members: [{ side: "NEG", seat: "A1", displayName: "あ" }] };
    expect(PutMembersReq.safeParse(bad).success).toBe(false);
  });

  it("3人チームに A4 を入れると落ちる", () => {
    const bad = {
      ...base,
      teamSize: 3 as const,
      members: [{ side: "AFF" as const, seat: "A4" as const, displayName: "あ" }],
    };
    expect(PutMembersReq.safeParse(bad).success).toBe(false);
  });

  it("4人チームなら A4 は通る", () => {
    const ok = {
      ...base,
      members: [{ side: "AFF" as const, seat: "A4" as const, displayName: "あ" }],
    };
    expect(PutMembersReq.safeParse(ok).success).toBe(true);
  });

  it("同じ座席の重複は落ちる", () => {
    const bad = {
      ...base,
      members: [
        { side: "AFF", seat: "A1", displayName: "あ" },
        { side: "AFF", seat: "A1", displayName: "い" },
      ],
    };
    expect(PutMembersReq.safeParse(bad).success).toBe(false);
  });

  it("teamSize は 3 か 4 だけ", () => {
    expect(PutMembersReq.safeParse({ ...base, teamSize: 5 }).success).toBe(false);
    expect(PutMembersReq.safeParse({ ...base, teamSize: 2 }).success).toBe(false);
  });

  it("expectedVersion を省略すると落ちる", () => {
    const { expectedVersion: _drop, ...rest } = base;
    expect(PutMembersReq.safeParse(rest).success).toBe(false);
  });
});
