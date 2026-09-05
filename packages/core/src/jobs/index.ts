/**
 * ジョブ基盤の入口（TRANSCRIPTION.md §6 / API_SPEC.md §3）。
 *
 * DB を触る関数は db/repo/jobs.ts にある（media と同じ置き方）。
 * ここに置くのは、DB を持たない判断（状態機械・冪等キー）と、
 * 実行主体・ランナーである。
 */
export * from "./params-hash";
export * from "./runner";
export * from "./state";
export * from "./system-actor";
