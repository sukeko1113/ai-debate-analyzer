/**
 * 冪等キーの一部（API_SPEC.md §3 / TRANSCRIPTION.md §6.2）。
 *
 * ここが揺れると、同じ内容のジョブが二つできる。
 * 「同じ入力に同じ値」と「違う入力に違う値」の両方を確かめる。
 * 前者だけだと、常に同じ定数を返す実装でも通ってしまう。
 */
import { describe, expect, it } from "vitest";
import { paramsHash, type JobParams } from "../../packages/core/src/jobs/params-hash";

const BASE: JobParams = {
  kind: "align",
  targetStageNo: null,
  rulesetVersion: "2020.4",
  providerId: "stub",
  model: "stub-v1",
};

describe("paramsHash", () => {
  it("小文字16進64文字を返す（DB の CHECK が要求する形）", () => {
    expect(paramsHash(BASE)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("同じ入力には同じ値（キーを書く順に依存しない）", () => {
    const reordered: JobParams = {
      model: BASE.model,
      providerId: BASE.providerId,
      rulesetVersion: BASE.rulesetVersion,
      targetStageNo: BASE.targetStageNo,
      kind: BASE.kind,
    };
    expect(paramsHash(reordered)).toBe(paramsHash(BASE));
  });

  it("要素が 1 つ違えば違う値になる", () => {
    const variants: JobParams[] = [
      { ...BASE, kind: "anchor" },
      { ...BASE, targetStageNo: 1 },
      { ...BASE, rulesetVersion: "2021.1" },
      { ...BASE, providerId: "other" },
      { ...BASE, model: "other-v1" },
    ];

    const hashes = new Set([paramsHash(BASE), ...variants.map(paramsHash)]);
    expect(hashes.size).toBe(variants.length + 1);
  });

  it("targetStageNo の null と 0 を区別する", () => {
    // null は「ステージに紐づかない kind」、0 は不正な番号である。
    // 文字列化の仕方によっては両方 "" や "0" に潰れる
    expect(paramsHash({ ...BASE, targetStageNo: null })).not.toBe(
      paramsHash({ ...BASE, targetStageNo: 0 }),
    );
  });

  /**
   * 区切り文字で連結する実装だと、値の境界がずれても同じ文字列になる。
   * providerId と model は設定から来るので、どんな文字でも入りうる。
   */
  it("値の境界がずれても衝突しない", () => {
    const a = paramsHash({ ...BASE, providerId: "a b", model: "c" });
    const b = paramsHash({ ...BASE, providerId: "a", model: "b c" });
    expect(a).not.toBe(b);

    const withQuote = paramsHash({ ...BASE, providerId: 'a","b', model: "c" });
    const split = paramsHash({ ...BASE, providerId: "a", model: "b" });
    expect(withQuote).not.toBe(split);
  });
});
