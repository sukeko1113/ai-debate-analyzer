/**
 * supabase-js の用途を構成で縛る（ACCEPTANCE.md M35 / DATA_MODEL.md §0.1）。
 *
 * supabase-js は **Storage と Auth 専用**である。DB アクセスには使わない。
 * supabase-js からの DB アクセスは PostgREST（＝Data API）経由であり、
 * Data API はプロジェクト設定で無効にしてある。両立しない二つを、
 * 規約ではなく検査で分ける。
 *
 * eslint の no-restricted-imports も同じ境界を守っているが、こちらは
 * eslint の設定そのものが緩められたときに気づくためにある。
 * 二重にしているのは、片方が外れたときに黙って通らないようにするためである。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/** ここからだけ import してよい */
export const SUPABASE_JS_ALLOWED_DIRS = [
  "packages/core/src/storage",
  "packages/core/src/auth",
] as const;

/**
 * 走査対象の既定。生成物と依存は見ない。
 *
 * `tests/` を入れていないのは、この検査自身の負のテスト（違反ファイルを作って
 * 検出されることを確かめる）が、文字列として import 文を持つためである。
 * 出荷するコードは app / packages / scripts / e2e に閉じている。
 */
export const SCAN_ROOTS = ["app", "packages", "scripts", "e2e"] as const;

const SKIP_DIRECTORIES = new Set(["node_modules", ".next", "dist", "build", "coverage"]);
const SOURCE_EXTENSIONS = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/**
 * 実際の import / require だけを見る。
 * 文字列としての言及（この検査自身がそうである）まで拾うと、
 * 検査を書いた側が検査に引っかかる。
 */
const SUPABASE_JS_IMPORT = /(?:from|require\()\s*["']@supabase\/supabase-js["']/;

function sourceFiles(dir: string, acc: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      sourceFiles(full, acc);
    } else if (SOURCE_EXTENSIONS.test(entry.name)) {
      acc.push(full.split(path.sep).join("/"));
    }
  }
  return acc;
}

/**
 * 許可されていない場所からの `@supabase/supabase-js` 参照を返す。
 *
 * `roots` は cwd からの相対パス。存在しないものは黙って飛ばす
 * （リポジトリの構成が変わっても検査が落ちないように）。
 */
export function findSupabaseJsOffenders(
  roots: readonly string[] = SCAN_ROOTS,
  allowed: readonly string[] = SUPABASE_JS_ALLOWED_DIRS,
): string[] {
  const existing = roots.filter((dir) => {
    try {
      return statSync(dir).isDirectory();
    } catch {
      return false;
    }
  });

  return existing
    .flatMap((dir) => sourceFiles(dir))
    .filter((file) => SUPABASE_JS_IMPORT.test(readFileSync(file, "utf8")))
    .filter((file) => !allowed.some((dir) => file.startsWith(dir)))
    .sort();
}
