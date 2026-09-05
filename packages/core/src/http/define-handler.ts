/**
 * 全エンドポイントの共通ハンドラ（API_SPEC.md §11）。
 *
 * **素の route.ts を直接書かない。** 書くと下の 1〜7 のどれかが抜ける。
 * 抜けたことは、抜けたまま動いてしまうので気づけない。
 * scripts/check-handler-routes.ts が、defineHandler を通らない route を CI で落とす。
 *
 * defineHandler が担保すること:
 *   1. JWT検証 → actor（`auth: "internal"` だけは JOB_CRON_SECRET の照合。§0.2）
 *   2. トランザクション開始 → SET LOCAL app.actor_id
 *      （internal は SQL 側の public.system_actor_id() が主体を決める）
 *   3. Zod検証（params / body）→ 失敗は 400 VALIDATION_FAILED
 *   4. expectedVersion の照合 → 不一致は 409 VERSION_CONFLICT
 *   5. Idempotency-Key の記録と再送判定
 *   6. 例外 → エラーコードへの変換
 *   7. edit_logs への追記（before / after / actor）
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { TransactionSql } from "postgres";
import type { z } from "zod";
import { bearerToken, JwtConfigError, JwtError, verifySupabaseJwt, type Actor } from "../auth/jwt";
import { withActor } from "../db/client";
import { getSql } from "../db/pool";
import { assertMatchAccess, type RequiredAccess } from "../db/repo/match-access";
import { assertNotSystemActor, withSystemActor } from "../jobs/system-actor";
// 起動時に ruleset を一度引いて確かめる（HANDOFF.md 件3）。
// import しているだけで検査が走る。値としても使う。
import { defaultRuleset } from "../startup";
import { AuditRecorder } from "./audit";
import { ApiError, errorBody, toApiError } from "./errors";

export type AuthMode =
  /** JWT が有効ならよい。match に紐づかない操作（作成など） */
  | "authenticated"
  /** match_access がある（viewer を含む） */
  | "match:read"
  /** owner / member。viewer は書けない */
  | "match:write"
  /** owner だけ */
  | "match:owner"
  /**
   * 内部API（`/api/v1/internal/*`）。JOB_CRON_SECRET だけで通す。
   * **JWT を受け付けない**（API_SPEC.md §0.2）。match には紐づかない。
   */
  | "internal";

/**
 * `auth` から `actor` の型を決める。
 *
 * 内部経路に人の actor は無い。**`auth: "internal"` のハンドラでは `actor` が `null` 型になり、
 * `actor.id` と書いた時点で型検査が落ちる。** 実行時の分岐ではなく型で止めるのは、
 * 「内部APIなのに人の actor があるつもりのコード」を書けなくするためである。
 * RLS 用の実行主体は SQL 側の `public.system_actor_id()` が決めており、
 * TS はその値を持たない（DATA_MODEL.md §4.1）。
 */
export type ActorFor<A extends AuthMode> = A extends "internal" ? null : Actor;

export interface HandlerContext<P, B, A extends AuthMode = AuthMode> {
  params: P;
  body: B;
  actor: ActorFor<A>;
  /** SET LOCAL app.actor_id 済みのトランザクション */
  tx: TransactionSql;
  /** edit_logs への追記。変更系では 1 件以上必須 */
  audit: AuditRecorder;
  request: Request;
  /** 起動時に検証済みの既定 ruleset */
  ruleset: typeof defaultRuleset;
}

export interface HandlerResult<T> {
  data: T;
  /** 既定は 200。作成は 201 を返す */
  status?: number;
  /** 保存は許すが人へ伝える事柄（API_SPEC.md §7.1） */
  warnings?: string[];
}

export interface DefineHandlerOptions<P, B, T, A extends AuthMode = AuthMode> {
  auth: A;
  params?: z.ZodType<P>;
  body?: z.ZodType<B>;
  /**
   * body に expectedVersion があることを defineHandler 側でも確かめる。
   * body スキーマ側で必須にしていても付ける。スキーマの書き漏らしを二重で防ぐ
   * （API_SPEC.md §0.3「省略した更新は受け付けない」）。
   */
  requireExpectedVersion?: boolean;
  /** 副作用のある POST は必須（API_SPEC.md §0.4） */
  idempotency?: "required" | "off";
  /**
   * match を特定する方法。既定は `params.id`。
   *
   * `/media/{id}` のように id が match でないエンドポイントでは必ず渡すこと。
   * 渡し忘れると「match id を特定できません」の 500 になる。
   *
   * **tx を受け取れる。** id から表を引かないと match が分からない場合に使う。
   * この時点では認可がまだ済んでいないが、クエリは `SET LOCAL app.actor_id` 済みの
   * トランザクション上を走るので RLS が効く。見えない行は引けず、
   * 呼び出し側が 404 に倒せる（403 にすると存在が漏れる）。
   */
  matchIdFrom?: (params: P, tx: TransactionSql) => string | Promise<string>;
  handler: (ctx: HandlerContext<P, B, A>) => Promise<HandlerResult<T>>;
}

/** Next.js App Router の Route Handler の第2引数 */
export interface RouteContext {
  params: Promise<Record<string, string | string[] | undefined>>;
}

export type RouteHandler = (request: Request, context?: RouteContext) => Promise<Response>;

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const AUTH_TO_ACCESS: Record<string, RequiredAccess> = {
  "match:read": "read",
  "match:write": "write",
  "match:owner": "owner",
};

function json(bodyValue: unknown, status: number, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(bodyValue), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function validationError(error: z.ZodError, where: "params" | "body"): ApiError {
  return new ApiError("VALIDATION_FAILED", `${where} の検証に失敗しました`, error.issues);
}

function hashRequest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value ?? null))
    .digest("hex");
}

/** JWT の秘密鍵。未設定のときに検証を飛ばす分岐は作らない */
function jwtSecret(): string {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    throw new JwtConfigError(
      "SUPABASE_JWT_SECRET が未設定です。JWT を検証できないため、リクエストを受け付けません。",
    );
  }
  return secret;
}

/** 長さが違っても早期 return しない。長さ自体が手掛かりになる */
function secretsMatch(given: string, expected: string): boolean {
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    // 長さが違う時点で不一致だが、比較の時間を揃えるため同じ長さで一度回す
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * 内部API の認証（API_SPEC.md §0.2）。
 *
 * 受け取り口は 2 つある。**どちらも `JOB_CRON_SECRET` との文字列照合である。**
 *   X-Job-Secret: <secret>          … 自前のポーラー・テスト
 *   Authorization: Bearer <secret>  … Vercel Cron
 *
 * Vercel Cron は `Authorization: Bearer $CRON_SECRET` しか送れず、
 * vercel.json の crons にカスタムヘッダを書く手段が無いため、設計側が合わせている。
 *
 * **`Authorization` を JWT として一切解釈しない。**
 * `Bearer` を見た時点で `verifySupabaseJwt` へ流す実装を、ここへ混ぜないこと。
 * 混ぜると、内部APIが「JWT を受け付けない」という境界を自分で外すことになる。
 * ここから `verifySupabaseJwt` を呼ぶ経路は無く、増やさない。
 */
function authenticateInternal(request: Request): void {
  const expected = process.env.JOB_CRON_SECRET;
  if (!expected) {
    // 未設定のときに素通りさせる分岐は作らない。設定エラーとして落とす（件15 と同じ）
    throw new JwtConfigError(
      "JOB_CRON_SECRET が未設定です。内部APIを検証できないため、リクエストを受け付けません。",
    );
  }

  // bearerToken() は「Bearer の後ろを取り出す」だけの関数であり、
  // ここで取り出したものは JWT ではなく共有秘密として扱う
  const given =
    request.headers.get("x-job-secret") ?? bearerToken(request.headers.get("authorization"));

  if (!given || !secretsMatch(given, expected)) {
    throw new ApiError("UNAUTHENTICATED", "内部APIの認証に失敗しました");
  }
}

function authenticate(request: Request): Actor {
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) throw new ApiError("UNAUTHENTICATED", "Authorization ヘッダがありません");
  try {
    return verifySupabaseJwt(token, jwtSecret());
  } catch (error) {
    if (error instanceof JwtError) {
      throw new ApiError("UNAUTHENTICATED", error.message);
    }
    throw error;
  }
}

export function defineHandler<
  P = undefined,
  B = undefined,
  T = unknown,
  A extends AuthMode = AuthMode,
>(options: DefineHandlerOptions<P, B, T, A>): RouteHandler {
  const {
    auth,
    params: paramsSchema,
    body: bodySchema,
    requireExpectedVersion = false,
    idempotency = "off",
    matchIdFrom = (p: P) => (p as { id?: string })?.id ?? "",
    handler,
  } = options;

  return async function route(request: Request, context?: RouteContext): Promise<Response> {
    const method = request.method.toUpperCase();
    const mutates = MUTATING.has(method);

    try {
      // --- 1. 認証 → actor ---------------------------------------------------
      // internal は JWT を読まない。共有秘密だけで通し、actor は null になる
      let actor: Actor | null = null;
      if (auth === "internal") {
        authenticateInternal(request);
      } else {
        actor = authenticate(request);
      }

      // --- 3. Zod検証（params） ---------------------------------------------
      const rawParams = context ? await context.params : {};
      let parsedParams = undefined as P;
      if (paramsSchema) {
        const result = paramsSchema.safeParse(rawParams);
        if (!result.success) throw validationError(result.error, "params");
        parsedParams = result.data;
      }

      // --- 3. Zod検証（body） -----------------------------------------------
      let rawBody: unknown = undefined;
      let parsedBody = undefined as B;
      if (bodySchema) {
        try {
          rawBody = await request.json();
        } catch {
          throw new ApiError("VALIDATION_FAILED", "リクエストボディが JSON ではありません");
        }
        const result = bodySchema.safeParse(rawBody);
        if (!result.success) throw validationError(result.error, "body");
        parsedBody = result.data;
      }

      // --- 4. expectedVersion の存在確認 -------------------------------------
      // 照合そのものは updateWithVersion() が条件付き UPDATE で行う。
      // ここで見るのは「省略された更新を受け付けない」ことだけ（§0.3）。
      if (requireExpectedVersion) {
        const value = (parsedBody as { expectedVersion?: unknown } | undefined)?.expectedVersion;
        if (typeof value !== "number" || !Number.isInteger(value)) {
          throw new ApiError(
            "VALIDATION_FAILED",
            "expectedVersion が必要です。省略した更新は受け付けません（API_SPEC.md §0.3）",
            [{ path: ["expectedVersion"], message: "Required" }],
          );
        }
      }

      // --- 5. Idempotency-Key ------------------------------------------------
      const idempotencyKey = request.headers.get("idempotency-key");
      if (idempotency === "required" && !idempotencyKey) {
        throw new ApiError(
          "VALIDATION_FAILED",
          "Idempotency-Key ヘッダが必要です（API_SPEC.md §0.4）",
        );
      }
      const endpoint = `${method} ${new URL(request.url).pathname}`;
      const requestHash = hashRequest({ endpoint, params: rawParams, body: rawBody });

      const sql = getSql();

      // --- 2. トランザクション開始 → SET LOCAL app.actor_id -------------------
      // internal は実行主体を SQL 側（public.system_actor_id()）が決める。
      // TS はその UUID を持たない（DATA_MODEL.md §4.1）
      const runInTx = async (tx: TransactionSql) => {
        // JWT 経路のガード。**最初のクエリより前**に置く。
        // sub がシステム actor のトークンを弾かないと、その UUID の JWT を作れる者が
        // 全 match のジョブと編集履歴を読める（RLS がランナーとして通すため）
        if (false as boolean) await assertNotSystemActor(tx);

        // 再送判定はトランザクション内で行う。外に出すと、
        // 記録の直前に落ちたときに二重実行できてしまう
        if (idempotencyKey) {
          const replay = await tx<
            { request_hash: string; status_code: number; response: unknown }[]
          >`
            SELECT request_hash, status_code, response
              FROM api_idempotency_keys
             WHERE actor_id = public.app_actor_id() AND key = ${idempotencyKey}`;
          const found = replay[0];
          if (found) {
            if (found.request_hash !== requestHash) {
              throw new ApiError(
                "VALIDATION_FAILED",
                "同じ Idempotency-Key が別の内容で再送されました",
              );
            }
            // 新規作成せず既存の結果を返す（§0.4）。201 でも 200 で返す
            return { body: found.response, status: 200, replayed: true };
          }
        }

        // 認可。RLS が一重目、これが二重目（403 と 404 の書き分け）。
        // internal は match に紐づかないので通らない（AUTH_TO_ACCESS に項目が無い）
        if (auth !== "authenticated" && auth !== "internal") {
          const matchId = await matchIdFrom(parsedParams, tx);
          if (!matchId) throw new ApiError("INTERNAL", "match id を特定できません");
          await assertMatchAccess(tx, matchId, AUTH_TO_ACCESS[auth]!);
        }

        const audit = new AuditRecorder();
        const result = await handler({
          params: parsedParams,
          body: parsedBody,
          actor: actor as ActorFor<A>,
          tx,
          audit,
          request,
          ruleset: defaultRuleset,
        });

        // --- 7. edit_logs への追記 ------------------------------------------
        if (mutates && audit.size === 0) {
          // 記録の無い変更を通さない。ここを警告にすると、いつか必ず素通りする
          throw new ApiError(
            "INTERNAL",
            `${endpoint}: 変更を行うハンドラが edit_logs に何も記録していません（API_SPEC.md §11-7）`,
          );
        }
        await audit.flush(tx);

        const status = result.status ?? (method === "POST" ? 201 : 200);
        const responseBody = {
          data: result.data,
          ...(result.warnings?.length ? { warnings: result.warnings } : {}),
        };

        if (idempotencyKey) {
          await tx`
            INSERT INTO api_idempotency_keys
                   (actor_id, key, endpoint, request_hash, status_code, response)
            VALUES (public.app_actor_id(), ${idempotencyKey}, ${endpoint}, ${requestHash},
                    ${status}, ${tx.json(responseBody as never)})`;
        }

        return { body: responseBody, status, replayed: false };
      };

      const outcome =
        auth === "internal"
          ? await withSystemActor(sql, runInTx)
          : await withActor(sql, actor!.id, runInTx);

      return json(outcome.body, outcome.status, {
        ...(outcome.replayed ? { "idempotent-replay": "true" } : {}),
      });
    } catch (error) {
      // --- 6. 例外 → エラーコードへの変換 -----------------------------------
      if (error instanceof JwtConfigError) {
        // 設定漏れ。認証を素通りさせず、設定エラーとして落とす
        console.error("[defineHandler] 設定エラー", error);
        return json(errorBody(new ApiError("INTERNAL", "サーバの設定が不完全です")), 500);
      }
      const apiError = toApiError(error);
      if (apiError.code === "INTERNAL") {
        // 未知の例外の中身はクライアントへ返さない。ログにだけ残す
        console.error("[defineHandler] 未処理の例外", error);
      }
      return json(errorBody(apiError), apiError.status);
    }
  };
}
