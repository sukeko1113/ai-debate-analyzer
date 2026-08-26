/**
 * 素の route.ts を検出できること（API_SPEC.md §11）。
 *
 * 検査そのものが空回りしていないかを確かめる。
 * 「今のリポジトリで通る」だけでは、壊れた route を検出できるかは分からない。
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve("scripts/check-handler-routes.ts");
const TSX = path.resolve("node_modules/.bin/tsx");
let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "handler-routes-"));
  mkdirSync(path.join(cwd, "app/api/v1/probe"), { recursive: true });
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function run(): { code: number; output: string } {
  try {
    // tsx はスクリプトの位置から依存を解決する。cwd だけ差し替えれば、
    // 検査対象（globSync が見る process.cwd()）は一時ディレクトリになる
    const output = execFileSync(TSX, [SCRIPT], { cwd, encoding: "utf8", stdio: "pipe" });
    return { code: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout: string; stderr: string };
    return { code: e.status, output: `${e.stdout}${e.stderr}` };
  }
}

function writeRoute(source: string) {
  writeFileSync(path.join(cwd, "app/api/v1/probe/route.ts"), source, "utf8");
}

describe("check-handler-routes", () => {
  it("defineHandler 経由の route は通る", () => {
    writeRoute(`
import { defineHandler } from "@core/http";
export const runtime = "nodejs";
export const GET = defineHandler({ auth: "authenticated", handler: async () => ({ data: {} }) });
`);
    expect(run().code).toBe(0);
  });

  it("素の関数を export した route は落ちる", () => {
    writeRoute(`
export async function GET() {
  return new Response("{}");
}
`);
    const result = run();
    expect(result.code).toBe(1);
    expect(result.output).toContain("defineHandler");
  });

  it("defineHandler を import しているのに素の関数を返す route も落ちる", () => {
    writeRoute(`
import { defineHandler } from "@core/http";
export const POST = defineHandler({ auth: "authenticated", handler: async () => ({ data: {} }) });
export const GET = async () => new Response("{}");
`);
    const result = run();
    expect(result.code).toBe(1);
    expect(result.output).toContain("GET");
  });

  it("route.ts が 1 つも無ければ落ちる（空回りの検出）", () => {
    rmSync(path.join(cwd, "app/api"), { recursive: true, force: true });
    const result = run();
    expect(result.code).toBe(1);
    expect(result.output).toContain("空回り");
  });
});
