/**
 * JWT 検証（API_SPEC.md §0.2 / packages/core/src/auth/jwt.ts）。
 *
 * 実 Supabase が発行したトークンでの疎通は、クラウドセッションに鍵を置けないため
 * 検証していない（DEV_ENVIRONMENTS.md §5）。ここで確かめているのは
 * 自前で署名したトークンに対する検証器の挙動である。
 */
import { describe, expect, it } from "vitest";
import {
  bearerToken,
  JwtConfigError,
  JwtError,
  signJwtHs256,
  verifySupabaseJwt,
} from "../../packages/core/src/auth/jwt";

const SECRET = "test-secret";
const SUB = "11111111-1111-4111-8111-111111111111";
const NOW = 1_800_000_000;

function token(payload: Record<string, unknown> = {}, secret = SECRET, header?: object) {
  return signJwtHs256(
    { sub: SUB, role: "authenticated", exp: NOW + 3600, ...payload },
    secret,
    header as Record<string, unknown> | undefined,
  );
}

describe("verifySupabaseJwt", () => {
  it("正しいトークンから actor を取り出す", () => {
    expect(verifySupabaseJwt(token(), SECRET, NOW)).toEqual({ id: SUB, role: "authenticated" });
  });

  it("鍵が違えば落ちる", () => {
    expect(() => verifySupabaseJwt(token(), "別の鍵", NOW)).toThrow(JwtError);
  });

  it("署名を差し替えたトークンは落ちる", () => {
    const forged = `${token().slice(0, -4)}AAAA`;
    expect(() => verifySupabaseJwt(forged, SECRET, NOW)).toThrow(JwtError);
  });

  it("alg: none を受け付けない", () => {
    // 署名を空にして alg を none と申告する古典的な攻撃。
    // トークンの申告に従わず、HS256 だけを受け付けると先に決めてある
    const [h, p] = token().split(".");
    void h;
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" }), "utf8").toString(
      "base64url",
    );
    expect(() => verifySupabaseJwt(`${header}.${p}.`, SECRET, NOW)).toThrow(
      /対応していない署名方式/,
    );
  });

  it("HS256 以外の alg を申告したトークンを受け付けない（鍵種別のすり替え）", () => {
    expect(() =>
      verifySupabaseJwt(token({}, SECRET, { alg: "RS256", typ: "JWT" }), SECRET, NOW),
    ).toThrow(/対応していない署名方式/);
  });

  it("exp が無いトークンは落ちる", () => {
    const noExp = signJwtHs256({ sub: SUB }, SECRET);
    expect(() => verifySupabaseJwt(noExp, SECRET, NOW)).toThrow(/exp/);
  });

  it("期限切れは落ちる", () => {
    expect(() => verifySupabaseJwt(token({ exp: NOW - 1 }), SECRET, NOW)).toThrow(/有効期限/);
  });

  it("nbf より前は落ちる", () => {
    expect(() => verifySupabaseJwt(token({ nbf: NOW + 100 }), SECRET, NOW)).toThrow(/まだ有効/);
  });

  it("sub が uuid でなければ落ちる", () => {
    // app.actor_id は uuid 列と比較される。ここで弾かないと RLS が型変換で落ち、
    // 原因の分かりにくい 500 になる
    expect(() => verifySupabaseJwt(token({ sub: "not-a-uuid" }), SECRET, NOW)).toThrow(/uuid/);
  });

  it("秘密鍵が空なら設定エラーとして落ちる（検証を飛ばさない）", () => {
    expect(() => verifySupabaseJwt(token(), "", NOW)).toThrow(JwtConfigError);
  });

  it("形が JWT でないものは落ちる", () => {
    expect(() => verifySupabaseJwt("abc", SECRET, NOW)).toThrow(JwtError);
    expect(() => verifySupabaseJwt("a.b.c", SECRET, NOW)).toThrow(JwtError);
  });
});

describe("bearerToken", () => {
  it("Bearer を取り出す（大文字小文字を問わない）", () => {
    expect(bearerToken("Bearer abc")).toBe("abc");
    expect(bearerToken("bearer abc")).toBe("abc");
  });

  it("Bearer 以外は null", () => {
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken("Basic abc")).toBeNull();
  });
});
