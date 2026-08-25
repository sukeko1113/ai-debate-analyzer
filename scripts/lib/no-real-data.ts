/**
 * 実データ混入の検出（PRIVACY_RETENTION.md §8 / ACCEPTANCE.md M13）。
 *
 * このアプリは未成年である高校生の音声と氏名を扱う。
 * 一度コミットすると、削除しても履歴からは消えない。
 * .gitignore が一枚目の網で、これは二枚目である。
 *
 * 検出するもの:
 *   1. 音声・映像の拡張子（fixtures/ の外）
 *   2. 大容量ファイル（実試合の音声は数十MBになる）
 *   3. fixtures/ の外に置かれた *.speakers.json（whosaid-editor の作業ファイル。
 *      実会議・実試合の逐語と氏名が入っている）
 *   4. fixtures/ の中のメールアドレス・電話番号らしき文字列
 *      （fixtures は合成データのみ。実在の連絡先が入る余地はない）
 *
 * fixtures/ 配下のメディアは 1 を免除するが 2 は免除しない。
 * 実試合の音声（42分・数十MB）は 2 で止まる。
 * 合成音声を意図して置くときは、上限を上げる変更をレビューで通すこと。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export const MEDIA_EXTENSIONS = [
  ".mp3",
  ".m4a",
  ".wav",
  ".aac",
  ".flac",
  ".ogg",
  ".opus",
  ".mp4",
  ".mov",
  ".webm",
  ".mkv",
] as const;

/** 走査しないディレクトリ。生成物と依存は対象外 */
export const SKIP_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  ".next",
  "out",
  "build",
  "dist",
  "coverage",
  ".turbo",
  "playwright-report",
  "test-results",
  "blob-report",
  ".vercel",
  ".supabase",
]);

export const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;

export type ViolationKind = "media" | "large-file" | "speakers-json" | "contact-in-fixture";

export interface Violation {
  kind: ViolationKind;
  file: string;
  detail: string;
}

export interface ScanOptions {
  maxFileBytes?: number;
}

const TEXT_EXTENSIONS = new Set([".json", ".txt", ".md", ".csv", ".tsv", ".srt", ".vtt"]);
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE_JP = /(?:\+81[-\s]?\d|0\d{1,4})[-\s]?\d{1,4}[-\s]?\d{3,4}/;

function isUnder(relPath: string, dir: string): boolean {
  return relPath === dir || relPath.startsWith(`${dir}/`);
}

function walk(root: string, current: string, out: string[]): void {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      walk(root, path.join(current, entry.name), out);
    } else if (entry.isFile()) {
      out.push(path.relative(root, path.join(current, entry.name)).split(path.sep).join("/"));
    }
  }
}

export function scanForRealData(root: string, options: ScanOptions = {}): Violation[] {
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const files: string[] = [];
  walk(root, root, files);

  const violations: Violation[] = [];

  for (const rel of files) {
    const abs = path.join(root, rel);
    const ext = path.extname(rel).toLowerCase();
    const inFixtures = isUnder(rel, "fixtures");

    // 1. メディア拡張子
    if ((MEDIA_EXTENSIONS as readonly string[]).includes(ext) && !inFixtures) {
      violations.push({
        kind: "media",
        file: rel,
        detail: `音声・映像ファイル（${ext}）はリポジトリに置かない。合成データなら fixtures/ 配下に置く`,
      });
    }

    // 2. 大容量ファイル
    const size = statSync(abs).size;
    if (size > maxFileBytes) {
      violations.push({
        kind: "large-file",
        file: rel,
        detail: `${(size / 1024 / 1024).toFixed(1)} MB。上限 ${(maxFileBytes / 1024 / 1024).toFixed(1)} MB を超えている`,
      });
    }

    // 3. fixtures/ の外の *.speakers.json
    if (rel.endsWith(".speakers.json") && !inFixtures) {
      violations.push({
        kind: "speakers-json",
        file: rel,
        detail: "whosaid-editor の作業ファイル。実会議・実試合の逐語と氏名が入り得る",
      });
    }

    // 4. fixtures/ の中の連絡先らしき文字列
    if (inFixtures && TEXT_EXTENSIONS.has(ext) && size <= maxFileBytes) {
      const text = readFileSync(abs, "utf8");
      const email = EMAIL.exec(text);
      if (email) {
        violations.push({
          kind: "contact-in-fixture",
          file: rel,
          detail: `メールアドレスらしき文字列: ${email[0]}`,
        });
      }
      const phone = PHONE_JP.exec(text);
      if (phone) {
        violations.push({
          kind: "contact-in-fixture",
          file: rel,
          detail: `電話番号らしき文字列: ${phone[0]}`,
        });
      }
    }
  }

  return violations.sort((a, b) => a.file.localeCompare(b.file) || a.kind.localeCompare(b.kind));
}

export function formatViolations(violations: Violation[]): string {
  return violations.map((v) => `  [${v.kind}] ${v.file}\n      ${v.detail}`).join("\n");
}
