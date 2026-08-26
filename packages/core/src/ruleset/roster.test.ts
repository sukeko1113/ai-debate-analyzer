/**
 * 担当者表の切り替え（条項 2.2 / TASKS.md P2 受け入れ基準5）。
 *
 * HANDOFF.md 件4 の実測（⑪肯定総括は4人チームで A4、3人チームで A1。
 * 4人と3人で担当が変わるのは②④⑪⑫の4ステージだけ）を、
 * 表として組み立てたあとでも保っていることを確かめる。
 */
import { describe, expect, it } from "vitest";
import { henda20 } from "./index";
import { rosterFor, seatsFor, toTeamSize } from "./roster";

describe("rosterFor", () => {
  it("12ステージ分を返す", () => {
    expect(rosterFor(henda20, 4)).toHaveLength(12);
    expect(rosterFor(henda20, 3)).toHaveLength(12);
  });

  it("⑪肯定総括は 4人チームで A4、3人チームで A1", () => {
    const seatAt = (teamSize: 3 | 4, stageNo: number) =>
      rosterFor(henda20, teamSize).find((r) => r.stageNo === stageNo)?.seat;
    expect(seatAt(4, 11)).toBe("A4");
    expect(seatAt(3, 11)).toBe("A1");
  });

  it("4人と3人で担当が変わるのは ②④⑪⑫ の4ステージだけ", () => {
    const four = rosterFor(henda20, 4);
    const three = rosterFor(henda20, 3);
    const changed = four.filter((r, i) => r.seat !== three[i]!.seat).map((r) => r.stageNo);
    expect(changed).toEqual([2, 4, 11, 12]);
  });

  it("座席の接頭辞は発言側と一致する（A* は AFF、N* は NEG）", () => {
    for (const teamSize of [3, 4] as const) {
      for (const entry of rosterFor(henda20, teamSize)) {
        expect(entry.seat.startsWith("A") ? "AFF" : "NEG").toBe(entry.side);
      }
    }
  });

  it("3人チームの表に A4 / N4 は現れない", () => {
    const seats = new Set(rosterFor(henda20, 3).map((r) => r.seat));
    expect(seats.has("A4")).toBe(false);
    expect(seats.has("N4")).toBe(false);
  });
});

describe("seatsFor", () => {
  it("4人チームは A1〜A4 / N1〜N4", () => {
    expect(seatsFor(4)).toEqual(["A1", "A2", "A3", "A4", "N1", "N2", "N3", "N4"]);
  });

  it("3人チームは A1〜A3 / N1〜N3", () => {
    expect(seatsFor(3)).toEqual(["A1", "A2", "A3", "N1", "N2", "N3"]);
  });
});

describe("toTeamSize", () => {
  it("3 と 4 だけを通す（DB の number からの絞り込み。HANDOFF 件4）", () => {
    expect(toTeamSize(3)).toBe(3);
    expect(toTeamSize(4)).toBe(4);
    expect(() => toTeamSize(2)).toThrow();
    expect(() => toTeamSize(5)).toThrow();
  });
});
