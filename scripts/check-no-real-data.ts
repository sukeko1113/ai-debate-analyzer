/**
 * CI の check-no-real-data（ACCEPTANCE.md M13）。
 * 使い方: tsx scripts/check-no-real-data.ts [走査するディレクトリ]
 * 検出したら終了コード 1。
 */
import path from "node:path";
import { formatViolations, scanForRealData } from "./lib/no-real-data";

const root = path.resolve(process.argv[2] ?? process.cwd());
const violations = scanForRealData(root);

if (violations.length === 0) {
  console.log(`check-no-real-data: 問題なし（${root}）`);
  process.exit(0);
}

console.error(`check-no-real-data: ${violations.length} 件検出しました（${root}）`);
console.error(formatViolations(violations));
console.error(
  "\n実音声・実映像・実名・実試合 transcript をリポジトリに置かないこと（CLAUDE.md / PRIVACY_RETENTION.md §8）。",
);
process.exit(1);
