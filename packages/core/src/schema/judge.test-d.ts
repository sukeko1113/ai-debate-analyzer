/**
 * 型レベルの検査（実行時ではなく tsc で落ちること）。
 *
 * `npm run typecheck` の対象に入っている。@ts-expect-error は
 * 「次の行が型エラーであること」を要求するので、型が緩んだ瞬間に
 * このファイル自体がコンパイルエラーになる。
 *
 * vitest の include（*.test.ts）には一致しないので、実行はされない。
 */
import type { z } from "zod";
import type { JudgeDecision } from "./judge";

type DecisionInput = z.input<typeof JudgeDecision>;

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

/** winner は AFF か NEG の二択。引き分けを足したらここで落ちる（条項 4.2） */
export type WinnerIsBinary = Expect<Equals<DecisionInput["winner"], "AFF" | "NEG">>;

export const winnerAff: DecisionInput["winner"] = "AFF";
export const winnerNeg: DecisionInput["winner"] = "NEG";

// @ts-expect-error 引き分けは表現できない（JUDGE_LOGIC.md §1.2）
export const winnerDraw: DecisionInput["winner"] = "DRAW";
// @ts-expect-error 「引き分け」の別表記も同様に表現できない
export const winnerTie: DecisionInput["winner"] = "TIE";
// @ts-expect-error 票が割れた状態も JudgeDecision には入らない
export const winnerSplit: DecisionInput["winner"] = "SPLIT";
