/**
 * レビュー状態（REVIEW_SEMANTICS.md / BASIC_DESIGN_v05 §13.2）。
 *
 * AI の出力は必ず `suggested` に入る。`confirmed` / `excluded` を書けるのは
 * サーバの API だけであり、AI にもクライアントにも直接書かせない。
 * この区別が製品価値そのものなので、実装の都合で緩めない。
 */
import { z } from "zod";

export const ReviewStatus = z.enum(["suggested", "reviewed", "confirmed", "excluded"]);
export type ReviewStatus = z.infer<typeof ReviewStatus>;

/** AI が新規に作れる唯一の状態 */
export const AI_INITIAL_REVIEW_STATUS = "suggested" satisfies ReviewStatus;

/** 人の操作を受けた API だけが書ける状態 */
export const HUMAN_ONLY_REVIEW_STATUSES = [
  "confirmed",
  "excluded",
] as const satisfies readonly ReviewStatus[];
