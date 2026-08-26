/**
 * ruleset の整合テスト（ACCEPTANCE.md M1）。
 *
 * 正しいデータで通るだけのテストは、ルールを守れているかを検証していない。
 * したがってここでは「壊した ruleset で必ず失敗すること」を主に確かめる。
 * fixture は手書きの小さなもの（henda-20.json を1点だけ壊した写し）を使う。
 */
import { describe, expect, it } from "vitest";
import henda20Raw from "./henda-20.json" with { type: "json" };
import { henda20, seatFor, getStage, getRuleset } from "./index";
import { Ruleset, TOTAL_MATCH_SEC, TOTAL_PREP_SEC, TOTAL_SPEECH_SEC } from "./schema";

/** JSON を1点だけ壊すための写し。元データには触らない */
function broken(mutate: (r: Record<string, unknown>) => void): unknown {
  const copy = structuredClone(henda20Raw) as unknown as Record<string, unknown>;
  mutate(copy);
  return copy;
}

function stagesOf(r: Record<string, unknown>): Record<string, unknown>[] {
  return r.stages as Record<string, unknown>[];
}

describe("henda-20 の整合", () => {
  it("そのままの ruleset は検証を通る", () => {
    expect(Ruleset.safeParse(henda20Raw).success).toBe(true);
  });

  it("12ステージある（条項 2.1）", () => {
    expect(henda20.stages).toHaveLength(12);
    expect(henda20.stages.map((s) => s.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("スピーチ34分・準備8分・合計42分（条項 2.1）", () => {
    const speech = henda20.stages.reduce((a, s) => a + s.durationSec, 0);
    const prep = henda20.stages.reduce((a, s) => a + s.prepAfterSec, 0);
    expect(speech).toBe(TOTAL_SPEECH_SEC);
    expect(prep).toBe(TOTAL_PREP_SEC);
    expect(speech + prep).toBe(TOTAL_MATCH_SEC);
    expect(TOTAL_MATCH_SEC).toBe(42 * 60);
  });

  it("side と type が全ステージで一致している", () => {
    for (const s of henda20.stages) {
      expect(s.side).toBe(s.type.startsWith("AFF_") ? "AFF" : "NEG");
    }
  });

  it("担当者表に穴が無い。4人・3人とも12ステージ分そろっている（条項 2.2）", () => {
    for (const s of henda20.stages) {
      expect(seatFor(henda20, s.no, 4)).toMatch(/^[AN][1-4]$/);
      expect(seatFor(henda20, s.no, 3)).toMatch(/^[AN][1-4]$/);
      // 発言側と座席の接頭辞が一致する
      expect(seatFor(henda20, s.no, 4).startsWith("A")).toBe(s.side === "AFF");
      expect(seatFor(henda20, s.no, 3).startsWith("A")).toBe(s.side === "AFF");
    }
  });

  it("担当者表が HENDA_RULESET.md §2 の表と一致する", () => {
    const seat4 = henda20.stages.map((s) => s.seat4);
    const seat3 = henda20.stages.map((s) => s.seat3);
    expect(seat4).toEqual(["A1", "N4", "N1", "A4", "N2", "A3", "A2", "N3", "A3", "N3", "A4", "N4"]);
    expect(seat3).toEqual(["A1", "N2", "N1", "A2", "N2", "A3", "A2", "N3", "A3", "N3", "A1", "N1"]);
  });

  it("3人チームで担当が変わるのは②④⑪⑫だけ", () => {
    const differ = henda20.stages.filter((s) => s.seat4 !== s.seat3).map((s) => s.no);
    expect(differ).toEqual([2, 4, 11, 12]);
  });

  it("新しい Issue を出せるのは立論の2ステージだけ（条項 2.1.1 / 2.1.2）", () => {
    expect(henda20.stages.filter((s) => s.allowsNewIssue).map((s) => s.no)).toEqual([1, 3]);
  });

  it("Attack は⑤⑦、Defense は⑨⑩、比較は⑨⑩⑪⑫（HENDA_RULESET.md §5）", () => {
    expect(henda20.stages.filter((s) => s.allowsAttack).map((s) => s.no)).toEqual([5, 7]);
    expect(henda20.stages.filter((s) => s.allowsDefense).map((s) => s.no)).toEqual([9, 10]);
    expect(henda20.stages.filter((s) => s.allowsComparison).map((s) => s.no)).toEqual([
      9, 10, 11, 12,
    ]);
  });

  it("定数がルールどおり固定されている", () => {
    expect(henda20.maxIssuesPerSide).toBe(2);
    expect(henda20.constructiveMaxWords).toBe(600);
    expect(henda20.maxWordsPerMinute).toBe(150);
    expect(henda20.graceSecAfterBell).toBe(10);
    expect(henda20.communicationPoints).toEqual({ min: 1, max: 5, integerOnly: true });
    expect(henda20.tieBreak).toBe("NEG");
  });

  it("証拠資料の必須読み上げ要素（条項 3.2.1）", () => {
    expect(henda20.evidenceRequirements).toEqual({
      factData: ["source", "year"],
      expert: ["name", "credential"],
      news: ["outlet", "date"],
    });
  });
});

describe("chairCues（HENDA_RULESET.md §8）", () => {
  it("12ステージすべてに対応する定型句がある", () => {
    const covered = new Set(
      henda20.chairCues.filter((c) => c.kind === "stage_start").flatMap((c) => c.stageNo),
    );
    expect([...covered].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("質疑の文言は重複するので、1エントリが複数ステージを持つ", () => {
    const negQ = henda20.chairCues.find((c) => c.pattern === "Questions from the Negative");
    const affQ = henda20.chairCues.find((c) => c.pattern === "Questions from the Affirmative");
    expect(negQ?.stageNo).toEqual([2, 8]);
    expect(affQ?.stageNo).toEqual([4, 6]);
  });

  it("ステージに紐づかない合図（準備時間・名乗り・終了）も辞書に入っている", () => {
    const kinds = henda20.chairCues.map((c) => c.kind);
    expect(kinds).toContain("prep");
    expect(kinds).toContain("speech_start");
    expect(kinds).toContain("debate_end");
    for (const cue of henda20.chairCues.filter((c) => c.kind !== "stage_start")) {
      expect(cue.stageNo).toEqual([]);
    }
  });

  it("stage_start なのに stageNo が空だと失敗する", () => {
    const result = Ruleset.safeParse(
      broken((r) => {
        (r.chairCues as Record<string, unknown>[])[0]!.stageNo = [];
      }),
    );
    expect(result.success).toBe(false);
  });
});

/**
 * 壊した ruleset で必ず失敗すること（ACCEPTANCE.md M1・TASKS.md P1）。
 * ここが通らないと、整合テストは正しいデータを撫でているだけになる。
 */
describe("壊した ruleset は検証に失敗する", () => {
  it("ステージが11個しかない", () => {
    const result = Ruleset.safeParse(
      broken((r) => {
        stagesOf(r).pop();
      }),
    );
    expect(result.success).toBe(false);
  });

  it("時間の合計が42分にならない", () => {
    const result = Ruleset.safeParse(
      broken((r) => {
        stagesOf(r)[0]!.durationSec = 300; // 肯定立論を5分にする
      }),
    );
    expect(result.success).toBe(false);
  });

  it("準備時間を削っても合計42分から外れる", () => {
    const result = Ruleset.safeParse(
      broken((r) => {
        stagesOf(r)[0]!.prepAfterSec = 0;
      }),
    );
    expect(result.success).toBe(false);
  });

  it("担当者表に穴がある（あるステージの seat4 が空）", () => {
    const result = Ruleset.safeParse(
      broken((r) => {
        stagesOf(r)[6]!.seat4 = "";
      }),
    );
    expect(result.success).toBe(false);
  });

  it("担当者表の欄が丸ごと欠けている", () => {
    const result = Ruleset.safeParse(
      broken((r) => {
        delete stagesOf(r)[6]!.seat3;
      }),
    );
    expect(result.success).toBe(false);
  });

  it("stage_no が重複している", () => {
    const result = Ruleset.safeParse(
      broken((r) => {
        stagesOf(r)[1]!.no = 1;
      }),
    );
    expect(result.success).toBe(false);
  });

  it("side と type が矛盾している（AFF_ATTACK なのに side: 'NEG'）", () => {
    const result = Ruleset.safeParse(
      broken((r) => {
        const stage = stagesOf(r)[6]!;
        expect(stage.type).toBe("AFF_ATTACK");
        stage.side = "NEG";
      }),
    );
    expect(result.success).toBe(false);
  });

  it("座席が発言側と食い違っている（否定質疑の担当が A2）", () => {
    const result = Ruleset.safeParse(
      broken((r) => {
        stagesOf(r)[1]!.seat4 = "A2";
      }),
    );
    expect(result.success).toBe(false);
  });

  it("chairCues が空", () => {
    const result = Ruleset.safeParse(
      broken((r) => {
        r.chairCues = [];
      }),
    );
    expect(result.success).toBe(false);
  });

  it("chairCues があるステージを取りこぼしている", () => {
    const result = Ruleset.safeParse(
      broken((r) => {
        r.chairCues = (r.chairCues as Record<string, unknown>[]).filter(
          (c) => c.pattern !== "Negative Summary Speech",
        );
      }),
    );
    expect(result.success).toBe(false);
  });

  it("maxIssuesPerSide が 2 以外", () => {
    for (const bad of [1, 3, 4]) {
      const result = Ruleset.safeParse(
        broken((r) => {
          r.maxIssuesPerSide = bad;
        }),
      );
      expect(result.success).toBe(false);
    }
  });

  it("そのほかのルール定数を動かしても失敗する", () => {
    const cases: Array<(r: Record<string, unknown>) => void> = [
      (r) => (r.constructiveMaxWords = 800),
      (r) => (r.maxWordsPerMinute = 200),
      (r) => (r.graceSecAfterBell = 30),
      (r) => (r.tieBreak = "AFF"),
      (r) => (r.communicationPoints = { min: 0, max: 5, integerOnly: true }),
      (r) => (r.communicationPoints = { min: 1, max: 5, integerOnly: false }),
      (r) => (r.id = "henda-21"),
    ];
    for (const mutate of cases) {
      expect(Ruleset.safeParse(broken(mutate)).success).toBe(false);
    }
  });

  it("立論以外で新しい Issue を出せることにすると失敗する", () => {
    const result = Ruleset.safeParse(
      broken((r) => {
        stagesOf(r)[10]!.allowsNewIssue = true; // 肯定総括で新 AD
      }),
    );
    expect(result.success).toBe(false);
  });
});

describe("補助関数", () => {
  it("getRuleset は未知の id を拒否する", () => {
    expect(getRuleset("henda-20").id).toBe("henda-20");
    expect(() => getRuleset("henda-19")).toThrow();
  });

  it("getStage は範囲外を拒否する", () => {
    expect(getStage(henda20, 1).type).toBe("AFF_CONSTRUCTIVE");
    expect(() => getStage(henda20, 0)).toThrow();
    expect(() => getStage(henda20, 13)).toThrow();
  });
});
