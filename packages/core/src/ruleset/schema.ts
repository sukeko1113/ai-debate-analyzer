/**
 * ruleset の Zod 定義（BASIC_DESIGN_v05 §13.1）。
 *
 * ここは「大会ルールを型で強制する」箇所である。実装の都合で緩めない。
 * ルール本文は書かない。条項番号と要約で参照する（HENDA_RULESET.md 冒頭）。
 *
 * データ本体は henda-20.json にある。このファイルは形と不変条件だけを持つ。
 */
import { z } from "zod";

/** 条項 2.1 の12ステージ。質疑は AFF / NEG それぞれ2回あるため type は10種 */
export const StageType = z.enum([
  "AFF_CONSTRUCTIVE",
  "NEG_QUESTIONS",
  "NEG_CONSTRUCTIVE",
  "AFF_QUESTIONS",
  "NEG_ATTACK",
  "AFF_ATTACK",
  "AFF_DEFENSE",
  "NEG_DEFENSE",
  "AFF_SUMMARY",
  "NEG_SUMMARY",
]);
export type StageType = z.infer<typeof StageType>;

export const Side = z.enum(["AFF", "NEG"]);
export type Side = z.infer<typeof Side>;

/**
 * 座席ラベル（条項 2.2 の担当者表）。
 *
 * §13.1 の草案は z.string() だが、それだと空文字が通ってしまい
 * 「担当者表に穴がある」を検出できない（ACCEPTANCE.md M1）。列挙で固定する。
 */
export const SeatLabel = z.enum(["A1", "A2", "A3", "A4", "N1", "N2", "N3", "N4"]);
export type SeatLabel = z.infer<typeof SeatLabel>;

/** type の接頭辞と side は必ず一致する。AFF_ATTACK なのに side: 'NEG' は不整合 */
function sideOfStageType(type: StageType): Side {
  return type.startsWith("AFF_") ? "AFF" : "NEG";
}

/** 座席の接頭辞と side も一致する。A* は AFF、N* は NEG */
function sideOfSeat(seat: SeatLabel): Side {
  return seat.startsWith("A") ? "AFF" : "NEG";
}

export const StageDef = z
  .object({
    no: z.number().int().min(1).max(12),
    type: StageType,
    side: Side,
    durationSec: z.number().int().positive(),
    prepAfterSec: z.number().int().min(0),
    /** 4人チームの担当（条項 2.2） */
    seat4: SeatLabel,
    /** 3人チームの担当。3人登録は病欠等の例外のみで、既定は4人 */
    seat3: SeatLabel,
    /** 立論のみ true（条項 2.1.1 / 2.1.2） */
    allowsNewIssue: z.boolean(),
    allowsAttack: z.boolean(),
    allowsDefense: z.boolean(),
    allowsComparison: z.boolean(),
  })
  .refine((s) => s.side === sideOfStageType(s.type), {
    message: "stage.side が stage.type の接頭辞と矛盾している（条項 2.1）",
    path: ["side"],
  })
  .refine((s) => sideOfSeat(s.seat4) === s.side, {
    message: "seat4 が発言側と一致しない（条項 2.2）",
    path: ["seat4"],
  })
  .refine((s) => sideOfSeat(s.seat3) === s.side, {
    message: "seat3 が発言側と一致しない（条項 2.2）",
    path: ["seat3"],
  });
export type StageDef = z.infer<typeof StageDef>;

/**
 * チェアパーソンの定型句（HENDA_RULESET.md §8）。
 *
 * 1エントリが複数のステージ番号を持てる形にしてある。
 * 「Questions from the Negative」は②と⑧、「Questions from the Affirmative」は④と⑥で
 * 文言が同じであり、1対1にすると P6（ステージ推定）で作り直しになる。
 * 文言だけで判別してはならず、直前に確定したステージと経過時間の両方を使う。
 */
export const ChairCueKind = z.enum(["stage_start", "prep", "speech_start", "debate_end"]);
export type ChairCueKind = z.infer<typeof ChairCueKind>;

export const ChairCue = z
  .object({
    kind: ChairCueKind,
    /** 部分一致で照合する文言 */
    pattern: z.string().min(1),
    /** stage_start のみ1件以上。重複文言があるので配列で持つ */
    stageNo: z.array(z.number().int().min(1).max(12)),
    note: z.string(),
  })
  .refine((c) => (c.kind === "stage_start" ? c.stageNo.length >= 1 : c.stageNo.length === 0), {
    message: "stage_start は stageNo を1件以上持ち、それ以外の kind は持たない",
    path: ["stageNo"],
  });
export type ChairCue = z.infer<typeof ChairCue>;

/** 条項 2.1（スピーチ34分）＋ 準備時間8分 = 42分 */
export const TOTAL_SPEECH_SEC = 34 * 60;
export const TOTAL_PREP_SEC = 8 * 60;
export const TOTAL_MATCH_SEC = TOTAL_SPEECH_SEC + TOTAL_PREP_SEC;

export const Ruleset = z
  .object({
    id: z.literal("henda-20"),
    /** 大会ルールの改定日（例 '2025-11-28'） */
    version: z.string().min(1),
    /** 条項 2.1.1.3 / 2.1.2.1。AD・DA とも各側最大2 */
    maxIssuesPerSide: z.literal(2),
    /** 条項 2.1.10 */
    constructiveMaxWords: z.literal(600),
    /** 条項 2.1.10 */
    maxWordsPerMinute: z.literal(150),
    /** 条項 2.2.3。終了ベルの後この秒数を超えた発話が over_time の候補 */
    graceSecAfterBell: z.literal(10),
    /** 条項 4.3。1〜5の整数のみ。0 や 0.5 は不可 */
    communicationPoints: z.object({
      min: z.literal(1),
      max: z.literal(5),
      integerOnly: z.literal(true),
    }),
    /** 条項 4.2。優劣がつけられない例外時は推定により否定側。引き分けは存在しない */
    tieBreak: z.literal("NEG"),
    stages: z.array(StageDef).length(12),
    chairCues: z.array(ChairCue).min(1),
    /** 条項 3.2.1 の必須読み上げ要素 */
    evidenceRequirements: z.object({
      factData: z.array(z.string().min(1)).min(1),
      expert: z.array(z.string().min(1)).min(1),
      news: z.array(z.string().min(1)).min(1),
    }),
  })
  .refine((r) => r.stages.every((s, i) => s.no === i + 1), {
    message: "stages は no が 1..12 の昇順で、重複や欠番があってはならない（条項 2.1）",
    path: ["stages"],
  })
  .refine((r) => r.stages.reduce((a, s) => a + s.durationSec, 0) === TOTAL_SPEECH_SEC, {
    message: `スピーチ時間の合計が ${TOTAL_SPEECH_SEC} 秒（34分）でない（条項 2.1）`,
    path: ["stages"],
  })
  .refine((r) => r.stages.reduce((a, s) => a + s.prepAfterSec, 0) === TOTAL_PREP_SEC, {
    message: `準備時間の合計が ${TOTAL_PREP_SEC} 秒（8分）でない（条項 2.1）`,
    path: ["stages"],
  })
  .refine(
    (r) => r.stages.reduce((a, s) => a + s.durationSec + s.prepAfterSec, 0) === TOTAL_MATCH_SEC,
    {
      message: `試合時間の合計が ${TOTAL_MATCH_SEC} 秒（42分）でない（条項 2.1）`,
      path: ["stages"],
    },
  )
  .refine((r) => r.stages.filter((s) => s.allowsNewIssue).length === 2, {
    message: "新しい Issue を出せるのは立論の2ステージだけ（条項 2.1.1 / 2.1.2）",
    path: ["stages"],
  })
  .refine(
    (r) => {
      const covered = new Set(
        r.chairCues.filter((c) => c.kind === "stage_start").flatMap((c) => c.stageNo),
      );
      return r.stages.every((s) => covered.has(s.no));
    },
    {
      message: "12ステージすべてに対応する定型句が chairCues に無い（HENDA_RULESET.md §8）",
      path: ["chairCues"],
    },
  );
export type Ruleset = z.infer<typeof Ruleset>;
