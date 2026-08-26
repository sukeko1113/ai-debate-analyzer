/**
 * ruleset の入口。
 *
 * データ（12ステージ・担当者表・定型句辞書・証拠要件）は henda-20.json にあり、
 * ここでは読み込んで Zod で検証するだけ。定型句をコードに埋め込まない
 * （HENDA_RULESET.md §8 / TASKS.md P1「やってはいけないこと」）。
 *
 * 検証は import 時に一度だけ走る。壊れた ruleset を積んだままアプリが起動しない。
 */
import henda20Raw from "./henda-20.json" with { type: "json" };
import { Ruleset, type SeatLabel, type StageDef } from "./schema";

export * from "./schema";

export const henda20: Ruleset = Ruleset.parse(henda20Raw);

/** 既知の ruleset。増えたらここに足す */
const RULESETS: Record<string, Ruleset> = { [henda20.id]: henda20 };

export function getRuleset(id: string): Ruleset {
  const found = RULESETS[id];
  if (!found) {
    throw new Error(`未知の ruleset です: ${id}`);
  }
  return found;
}

export type TeamSize = 3 | 4;

export function getStage(ruleset: Ruleset, stageNo: number): StageDef {
  const stage = ruleset.stages[stageNo - 1];
  if (!stage || stage.no !== stageNo) {
    throw new Error(`ステージ番号が範囲外です: ${stageNo}`);
  }
  return stage;
}

/**
 * ステージ番号とチーム人数から発言者の座席を導出する（条項 2.2）。
 * ステージが確定すれば発言者は決まるので、話者分離は要らない。
 */
export function seatFor(ruleset: Ruleset, stageNo: number, teamSize: TeamSize): SeatLabel {
  const stage = getStage(ruleset, stageNo);
  return teamSize === 4 ? stage.seat4 : stage.seat3;
}
