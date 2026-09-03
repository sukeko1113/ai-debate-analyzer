/**
 * Node のバージョン指定が三か所でずれないこと。
 *
 * ローカルへ移行したとき、.nvmrc が無く、ホストの既定 v24 が
 * package.json の engines（>=20 <23）の外のまま動きかけた（HANDOFF.md 件34）。
 * CI は NODE_VERSION "22" で固定している。手元と CI で違う Node を使うと、
 * 「手元では通った」が成り立たなくなる。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const nvmrc = readFileSync(".nvmrc", "utf8").trim();
const engines: string = JSON.parse(readFileSync("package.json", "utf8")).engines.node;
const ci = readFileSync(".github/workflows/ci.yml", "utf8");

/** engines は ">=A <B" の形だけを許す。それ以外の形にするならこのテストも直す */
function parseRange(range: string): { lo: number; hi: number } {
  const m = /^>=(\d+) <(\d+)$/.exec(range);
  if (!m) throw new Error(`engines.node の形が想定外です: ${range}`);
  return { lo: Number(m[1]), hi: Number(m[2]) };
}

const major = (v: string): number => Number(v.replace(/^v/, "").split(".")[0]);

describe("Node のバージョン指定", () => {
  it(".nvmrc はメジャーだけを書く", () => {
    expect(nvmrc).toMatch(/^\d+$/);
  });

  it(".nvmrc が package.json の engines に収まる", () => {
    const { lo, hi } = parseRange(engines);
    expect(Number(nvmrc)).toBeGreaterThanOrEqual(lo);
    expect(Number(nvmrc)).toBeLessThan(hi);
  });

  it(".nvmrc が CI の NODE_VERSION と一致する", () => {
    const m = /NODE_VERSION:\s*"(\d+)"/.exec(ci);
    expect(m?.[1]).toBe(nvmrc);
  });

  it("いま走っている Node が engines に収まる（範囲外で走らせていることに気づける）", () => {
    const { lo, hi } = parseRange(engines);
    expect(major(process.version)).toBeGreaterThanOrEqual(lo);
    expect(major(process.version)).toBeLessThan(hi);
  });
});
