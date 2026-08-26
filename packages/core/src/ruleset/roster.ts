/**
 * 担当者表（条項 2.2）を「12ステージ × 座席」の一覧として返す。
 *
 * seatFor() は 1 ステージ分を返す関数である（HANDOFF.md 件4）。
 * 画面Aと API の両方が「表として」必要とするので、ここで一度だけ組み立てる。
 * 画面と API が別々に組み立てると、片方だけ 3人チームの扱いを間違える。
 *
 * TASKS.md P2 の受け入れ基準「team_size（3 or 4）に応じて担当者表が切り替わる」は
 * この関数が本体である。
 */
import type { Ruleset, SeatLabel, StageType } from "./schema";
import { seatFor, type TeamSize } from "./index";

export interface RosterEntry {
  stageNo: number;
  type: StageType;
  side: "AFF" | "NEG";
  seat: SeatLabel;
  durationSec: number;
  prepAfterSec: number;
}

export function rosterFor(ruleset: Ruleset, teamSize: TeamSize): RosterEntry[] {
  return ruleset.stages.map((stage) => ({
    stageNo: stage.no,
    type: stage.type,
    side: stage.side,
    seat: seatFor(ruleset, stage.no, teamSize),
    durationSec: stage.durationSec,
    prepAfterSec: stage.prepAfterSec,
  }));
}

/** そのチーム人数で存在する座席（3人チームに A4 / N4 は無い） */
export function seatsFor(teamSize: TeamSize): SeatLabel[] {
  const seats: SeatLabel[] = [];
  for (const prefix of ["A", "N"] as const) {
    for (let i = 1; i <= teamSize; i++) {
      seats.push(`${prefix}${i}` as SeatLabel);
    }
  }
  return seats;
}

/** DB の team_size（number）から絞り込む。HANDOFF.md 件4 の注意点 */
export function toTeamSize(value: number): TeamSize {
  if (value !== 3 && value !== 4) {
    throw new Error(`team_size は 3 または 4 です: ${value}`);
  }
  return value;
}
