/**
 * Supabase Auth の JWT 検証（API_SPEC.md §0.2）。
 *
 * 【この実装の範囲】
 * HS256（Supabase の legacy JWT secret 方式）だけを扱う。node:crypto で検証するので
 * 依存は増えない。実 Supabase が非対称鍵（JWKS / ES256・RS256）方式である場合は、
 * verifySignature の差し替えが必要になる。
 *
 * 【確認できていないこと】
 * クラウドセッションには実 Supabase の鍵を置けない（DEV_ENVIRONMENTS.md §3）ため、
 * 実 Supabase が発行したトークンでの疎通は当方では検証していない。
 * テストは自前で署名したトークンで行っている。
 *
 * 【緩めないこと】
 * 秘密鍵が未設定のときに「検証を飛ばす」分岐を作らない。
 * 作った瞬間、設定漏れの本番が無認証になる。設定エラーとして落とす。
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface Actor {
  /** Supabase Auth の user id。RLS の app.actor_id にそのまま入る */
  id: string;
  /** トークンの role クレーム（authenticated / anon など）。認可には使わない */
  role: string | null;
}

export class JwtError extends Error {}
export class JwtConfigError extends Error {}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function base64UrlDecode(part: string): Buffer {
  return Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** テストと開発用のトークン生成。実 Supabase の署名はこれではなく Supabase が行う */
export function signJwtHs256(
  payload: Record<string, unknown>,
  secret: string,
  header: Record<string, unknown> = { alg: "HS256", typ: "JWT" },
): string {
  const encode = (o: unknown) => base64UrlEncode(Buffer.from(JSON.stringify(o), "utf8"));
  const signingInput = `${encode(header)}.${encode(payload)}`;
  const signature = createHmac("sha256", secret).update(signingInput).digest();
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

/**
 * 検証して actor を返す。
 * @param nowSec 現在時刻（テストから固定できるようにする）
 */
export function verifySupabaseJwt(token: string, secret: string, nowSec?: number): Actor {
  if (!secret) {
    throw new JwtConfigError(
      "SUPABASE_JWT_SECRET が未設定です。JWT を検証できないため、リクエストを受け付けません。" +
        "デスクトップの .env.local か GitHub Actions Secrets に置いてください。",
    );
  }

  const parts = token.split(".");
  if (parts.length !== 3) throw new JwtError("JWT の形式が不正です");
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

  let header: { alg?: unknown };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(base64UrlDecode(headerPart).toString("utf8"));
    payload = JSON.parse(base64UrlDecode(payloadPart).toString("utf8"));
  } catch {
    throw new JwtError("JWT を JSON として解釈できません");
  }

  // alg: 'none' や、鍵種別のすり替え（RS256 の公開鍵を HMAC 鍵として使わせる攻撃）を防ぐ。
  // 受け付けるのは HS256 だけであると先に決め、トークンの申告に従わない。
  if (header.alg !== "HS256") {
    throw new JwtError(`対応していない署名方式です: ${String(header.alg)}`);
  }

  const expected = createHmac("sha256", secret).update(`${headerPart}.${payloadPart}`).digest();
  const actual = base64UrlDecode(signaturePart);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new JwtError("JWT の署名が一致しません");
  }

  const now = nowSec ?? Math.floor(Date.now() / 1000);
  const exp = payload.exp;
  if (typeof exp !== "number") throw new JwtError("JWT に exp がありません");
  if (now >= exp) throw new JwtError("JWT の有効期限が切れています");

  const nbf = payload.nbf;
  if (typeof nbf === "number" && now < nbf) throw new JwtError("JWT はまだ有効ではありません");

  const sub = payload.sub;
  if (typeof sub !== "string" || !UUID_RE.test(sub)) {
    // sub は app.actor_id として uuid 列と比較される。ここで弾かないと
    // RLS のポリシーが型変換エラーで落ち、原因の分かりにくい 500 になる。
    throw new JwtError("JWT の sub が uuid ではありません");
  }

  return { id: sub, role: typeof payload.role === "string" ? payload.role : null };
}

/** `Authorization: Bearer <token>` からトークンを取り出す */
export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1]!.trim() : null;
}
