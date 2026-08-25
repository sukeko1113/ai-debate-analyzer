/**
 * .env.example と、実際にコードが読む環境変数が一致すること。
 *
 * 必須／任意の別は問わない。クラウドセッションに置けない変数（Supabase のキー、
 * 転写プロバイダのキー）は optional にしてあるが、.env.example には列挙する
 * （DEV_ENVIRONMENTS.md §3 / BASIC_DESIGN_v04 §4.4）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ENV_KEYS, envSchema, parseEnv, requireEnv } from "../../packages/core/src/env";

function keysInEnvExample(): string[] {
  return readFileSync(".env.example", "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => line.split("=")[0]!.trim())
    .sort();
}

describe(".env.example", () => {
  it("キー集合が envSchema と一致する", () => {
    expect(keysInEnvExample()).toEqual([...ENV_KEYS]);
  });

  it("重複した定義が無い", () => {
    const keys = keysInEnvExample();
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("envSchema", () => {
  it("クラウドセッションにある変数だけで検証が通る（DATABASE_URL のみ）", () => {
    // Supabase のキーや転写キーを必須にすると、このセッションでアプリが起動しない
    const env = parseEnv({ DATABASE_URL: "postgres://app_server:x@127.0.0.1:5432/debate_dev" });
    expect(env.RULESET_DEFAULT).toBe("henda-20");
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
  });

  it("DATABASE_URL が無ければ落ちる", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it("postgres:// 以外の DATABASE_URL を拒否する", () => {
    expect(() => parseEnv({ DATABASE_URL: "https://example.supabase.co" })).toThrow(
      /postgres:\/\//,
    );
  });

  it("空文字は未設定として扱う", () => {
    const env = parseEnv({
      DATABASE_URL: "postgres://app_server:x@127.0.0.1:5432/debate_dev",
      ANALYSIS_KEY: "",
    });
    expect(env.ANALYSIS_KEY).toBeUndefined();
  });

  it("optional な変数を使う側は requireEnv で理由付きに落ちる", () => {
    const env = parseEnv({ DATABASE_URL: "postgres://app_server:x@127.0.0.1:5432/debate_dev" });
    expect(() => requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY")).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("schemas/env.schema.json が再生成された内容と一致する", () => {
    const generated = JSON.parse(readFileSync("schemas/env.schema.json", "utf8"));
    const expected = {
      $id: generated.$id,
      ...z.toJSONSchema(envSchema, { io: "input" }),
    };
    expect(generated).toEqual(expected);
  });
});
