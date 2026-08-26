/**
 * Storage の入口（TRANSCRIPTION.md §7.3 / DATA_MODEL.md §0.1）。
 *
 * **設定が無いときに stub へ落とす分岐は作らない。**
 * 作った瞬間、設定漏れの本番が「アップロードできたように見えて、どこにも保存されていない」
 * 状態になる。件15 で JWT について同じ判断をしている（秘密鍵が無ければ落とす）。
 * ここでも同じにする。未設定は設定エラーであり、リクエスト時に落とす。
 *
 * テストは `setStorageSignerForTests()` で明示的に差し替える。
 * 環境変数で切り替える形（`STORAGE_DRIVER=stub` のような）にしないのは、
 * 本番の設定ミス一つで無害な stub に落ちてしまうためである。
 */
import { requireEnv, type Env } from "../env";
import { DEFAULT_MEDIA_BUCKET } from "./constants";
import { SupabaseStorageSigner } from "./supabase";
import type { StorageSigner } from "./signer";

export * from "./constants";
export * from "./signer";
export { StubStorageSigner } from "./stub";
export { SupabaseStorageSigner } from "./supabase";

let testOverride: StorageSigner | null = null;

/**
 * テストからの差し替え。**本番では効かない。**
 * `NODE_ENV === "production"` では例外にしてある。
 */
export function setStorageSignerForTests(signer: StorageSigner): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("setStorageSignerForTests は本番では使えません");
  }
  testOverride = signer;
}

export function resetStorageSignerForTests(): void {
  testOverride = null;
}

export function bucketName(env: Pick<Env, "SUPABASE_STORAGE_BUCKET">): string {
  return env.SUPABASE_STORAGE_BUCKET ?? DEFAULT_MEDIA_BUCKET;
}

/**
 * 署名の実装を得る。
 *
 * 実 Supabase の設定が無ければ落とす。`ACCEPTANCE.md` H9〜H11 が
 * 「実物でしか確かめられない」と定めているのは、ここから先の話である。
 */
export function getStorageSigner(env: Env): StorageSigner {
  if (testOverride) return testOverride;

  return new SupabaseStorageSigner({
    supabaseUrl: requireEnv(env, "NEXT_PUBLIC_SUPABASE_URL"),
    storageUrl: requireEnv(env, "NEXT_PUBLIC_SUPABASE_STORAGE_URL"),
    serviceRoleKey: requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY"),
    bucket: bucketName(env),
  });
}
