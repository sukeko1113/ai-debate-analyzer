/**
 * ジョブの状態機械（TRANSCRIPTION.md §6.1）。
 *
 * 辺の表そのものが仕様なので、仕様の値をそのまま並べて突き合わせる。
 * 実装から生成した表と比べても、写し間違いは見つからない
 * （http-errors.test.ts と同じ考え方）。
 *
 * **DB のトリガとの一致は tests/db/job-transitions.test.ts が見る。**
 * ここは TS 側だけの検査である。片方だけでは、二重定義のずれに気づけない。
 */
import { describe, expect, it } from "vitest";
import {
  ALLOWED_TRANSITIONS,
  canTransition,
  isTerminal,
  JOB_STATUSES,
  type JobStatus,
} from "../../packages/core/src/jobs/state";

/** TRANSCRIPTION.md §6.1 の図をそのまま書き写したもの */
const SPEC: Record<string, string[]> = {
  queued: ["running", "canceled"],
  running: ["succeeded", "failed", "canceled"],
  succeeded: [],
  failed: ["queued"],
  canceled: [],
};

describe("ALLOWED_TRANSITIONS", () => {
  it("TRANSCRIPTION.md §6.1 の図と一致する（過不足なく）", () => {
    expect(ALLOWED_TRANSITIONS).toEqual(SPEC);
  });

  it("状態は 5 つ", () => {
    expect([...JOB_STATUSES]).toEqual(["queued", "running", "succeeded", "failed", "canceled"]);
  });
});

describe("canTransition", () => {
  it("同じ状態への更新は許す（metrics の追記など）", () => {
    for (const status of JOB_STATUSES) {
      expect(canTransition(status, status), status).toBe(true);
    }
  });

  it("succeeded と canceled からは動かせない", () => {
    for (const from of ["succeeded", "canceled"] as JobStatus[]) {
      for (const to of JOB_STATUSES) {
        if (to === from) continue;
        expect(canTransition(from, to), `${from} → ${to}`).toBe(false);
      }
    }
  });

  it("failed から戻れるのは queued だけ（部分再実行）", () => {
    expect(canTransition("failed", "queued")).toBe(true);
    expect(canTransition("failed", "running")).toBe(false);
    expect(canTransition("failed", "succeeded")).toBe(false);
    expect(canTransition("failed", "canceled")).toBe(false);
  });

  it("queued から succeeded へ飛べない（走らずに成功しない）", () => {
    expect(canTransition("queued", "succeeded")).toBe(false);
    expect(canTransition("queued", "failed")).toBe(false);
  });

  it("全 25 組が SPEC と一致する", () => {
    for (const from of JOB_STATUSES) {
      for (const to of JOB_STATUSES) {
        const expected = from === to || SPEC[from]!.includes(to);
        expect(canTransition(from, to), `${from} → ${to}`).toBe(expected);
      }
    }
  });
});

describe("isTerminal", () => {
  it("終端は succeeded と canceled だけ", () => {
    expect(isTerminal("succeeded")).toBe(true);
    expect(isTerminal("canceled")).toBe(true);
    expect(isTerminal("failed")).toBe(false);
    expect(isTerminal("queued")).toBe(false);
    expect(isTerminal("running")).toBe(false);
  });
});
