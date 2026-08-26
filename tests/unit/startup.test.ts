/**
 * 起動時に ruleset を一度引いて確かめる（HANDOFF.md「P1 から P2 への申し送り」件3）。
 *
 * 実測（P1）: getRuleset("henda-19") → Error: 未知の ruleset です: henda-19
 * これは呼び出し時に投げるので、RULESET_DEFAULT が不正でも起動は成功し、
 * リクエストを受けた時点で 500 になっていた。
 * 設定ミスはリクエストを受けた後ではなく、起動時に落ちるべきである。
 */
import { describe, expect, it } from "vitest";
import { defaultRuleset, resolveDefaultRuleset } from "../../packages/core/src/startup";

describe("resolveDefaultRuleset", () => {
  it("未設定なら henda-20 を返す", () => {
    expect(resolveDefaultRuleset({}).id).toBe("henda-20");
  });

  it("既知の ruleset を返す", () => {
    expect(resolveDefaultRuleset({ RULESET_DEFAULT: "henda-20" }).id).toBe("henda-20");
  });

  it("未知の id は起動時に落ちる", () => {
    expect(() => resolveDefaultRuleset({ RULESET_DEFAULT: "henda-19" })).toThrow(
      /RULESET_DEFAULT の値が不正/,
    );
  });

  it("元の例外を cause に残す", () => {
    try {
      resolveDefaultRuleset({ RULESET_DEFAULT: "henda-19" });
      expect.unreachable("落ちるはず");
    } catch (error) {
      expect((error as Error).cause).toBeInstanceOf(Error);
      expect(String((error as Error).cause)).toContain("未知の ruleset です: henda-19");
    }
  });

  it("import しただけで検証済みの ruleset が手に入る", () => {
    // defineHandler がこのモジュールを import している。
    // ルートを 1 つでも読み込めば、この検査が走っている
    expect(defaultRuleset.id).toBe("henda-20");
    expect(defaultRuleset.stages).toHaveLength(12);
  });

  it("DATABASE_URL が無くても落ちない（CI の next build を止めない）", () => {
    // env 全体を parseEnv() で検査する形にすると、DATABASE_URL の無い
    // ビルド環境で落ちる。ここで見るのは RULESET_DEFAULT だけである
    expect(() => resolveDefaultRuleset({ RULESET_DEFAULT: "henda-20" })).not.toThrow();
  });
});
