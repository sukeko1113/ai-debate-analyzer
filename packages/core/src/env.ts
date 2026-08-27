/**
 * 環境変数の定義（BASIC_DESIGN_v04 §4.4）。
 *
 * ここが「実際に読む環境変数」の唯一の定義であり、`.env.example` とキー集合が
 * 一致することをテストで担保する（tests/unit/env.test.ts）。
 *
 * 必須にしてよいのは、クラウドセッション（セッション内 PostgreSQL 16）でも
 * 値が存在するものだけである。Supabase のキーや転写プロバイダのキーは
 * クラウド環境に置かない方針（DEV_ENVIRONMENTS.md §3）なので optional にする。
 * 必須にすると、このセッションでアプリが起動しない。
 *
 * 「optional である」ことは「無くても動く」という意味ではない。
 * それを必要とする機能（Storage・Auth・Pass A/B）は、使う時点で存在を確かめる。
 */
import { z } from "zod";

/** process.env と同じ形。NodeJS.ProcessEnv は NODE_ENV を必須にする実装があるため使わない */
export type EnvSource = Record<string, string | undefined>;

/** 値を要求する機能側が使う。未設定なら理由付きで落とす。 */
export function requireEnv<K extends keyof Env>(env: Env, key: K): NonNullable<Env[K]> {
  const value = env[key];
  if (value === undefined || value === "") {
    throw new Error(
      `環境変数 ${String(key)} が未設定です。デスクトップの .env.local か GitHub Actions Secrets に置いてください（クラウド環境の設定には置かない）。`,
    );
  }
  return value as NonNullable<Env[K]>;
}

const postgresUrl = z
  .string()
  .refine((v) => v.startsWith("postgres://") || v.startsWith("postgresql://"), {
    message: "postgres:// または postgresql:// で始まる接続文字列が必要です",
  });

export const envSchema = z.object({
  // --- DB（Data API は無効。supabase-js を DB アクセスに使わない） ---
  /** 読み書き。本番は Supavisor transaction mode / 6543・ロール app_server */
  DATABASE_URL: postgresUrl,
  /** マイグレーション専用。session mode / 5432・ロール app_migrator。CI にだけ置く */
  DIRECT_URL: postgresUrl.optional(),

  // --- Supabase（Storage と Auth 専用。DB には使わない） ---
  NEXT_PUBLIC_SUPABASE_URL: z.url().optional(),
  /**
   * JWT の検証鍵（API_SPEC.md §0.2）。HS256 の legacy JWT secret。
   * 未設定のときに検証を飛ばす分岐は作らない。設定エラーとして落とす
   * （packages/core/src/auth/jwt.ts）。
   */
  SUPABASE_JWT_SECRET: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  /**
   * TUS の直結ホスト（TRANSCRIPTION.md §7.3）。`https://<project-ref>.storage.supabase.co`。
   *
   * **NEXT_PUBLIC_SUPABASE_URL から文字列操作で組み立てない。**
   * `.supabase.co` を `.storage.supabase.co` に置換する形にすると、
   * Supabase がホスト構成を変えたときに静かに壊れる。別の値として持つ。
   */
  NEXT_PUBLIC_SUPABASE_STORAGE_URL: z.url().optional(),
  /** メディアの保管先バケット。非公開・単一（TRANSCRIPTION.md §7.3） */
  SUPABASE_STORAGE_BUCKET: z.string().default("media"),

  // --- 転写（P5・P8。デスクトップまたは CI でのみ設定する） ---
  TRANSCRIBE_A_PROVIDER: z.string().default("stub"),
  TRANSCRIBE_A_KEY: z.string().optional(),
  TRANSCRIBE_B_PROVIDER: z.string().default("stub"),
  TRANSCRIBE_B_KEY: z.string().optional(),

  // --- 解析・判定支援 ---
  ANALYSIS_MODEL: z.string().optional(),
  ANALYSIS_KEY: z.string().optional(),

  // --- その他 ---
  RULESET_DEFAULT: z.string().default("henda-20"),
  JOB_CRON_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/** `.env.example` との突き合わせに使う。必須/任意の別は問わず、キー集合だけを見る。 */
export const ENV_KEYS: readonly string[] = Object.keys(envSchema.shape).sort();

/** 空文字は「未設定」として扱う（.env に `KEY=` と書かれた場合） */
function compact(source: EnvSource): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ENV_KEYS) {
    const value = source[key];
    if (value !== undefined && value !== "") out[key] = value;
  }
  return out;
}

export function parseEnv(source: EnvSource = process.env): Env {
  const parsed = envSchema.safeParse(compact(source));
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`環境変数の検証に失敗しました:\n${detail}`);
  }
  return parsed.data;
}
