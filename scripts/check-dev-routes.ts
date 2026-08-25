/**
 * 開発専用ページが production ビルドに含まれていないことの検査。
 *
 * /dev/media-probe は無音 WAV を生成して再生位置を確かめるためだけの画面であり、
 * 本番に出す理由がない。next.config.ts が pageExtensions で除外しているが、
 * 「設定したつもり」で漏れるのを防ぐため、ビルド成果物を実際に見る。
 *
 * 使い方: npm run build のあとに tsx scripts/check-dev-routes.ts
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const MANIFESTS = [
  ".next/app-path-routes-manifest.json",
  ".next/routes-manifest.json",
  ".next/prerender-manifest.json",
];

const found = MANIFESTS.filter((m) => existsSync(m));
if (found.length === 0) {
  console.error("ビルド成果物が見つかりません。先に npm run build を実行してください。");
  process.exit(1);
}

const offenders: string[] = [];
for (const manifest of found) {
  const text = readFileSync(manifest, "utf8");
  if (/\/dev\/[\w-]*/.test(text)) {
    const matches = [...text.matchAll(/"(\/dev\/[^"]*)"/g)].map((m) => m[1]!);
    offenders.push(`${manifest}: ${[...new Set(matches)].join(", ")}`);
  }
}

// ページファイル自体がビルド出力へ入っていないことも見る
const serverAppDir = path.join(".next", "server", "app", "dev");
if (existsSync(serverAppDir)) {
  offenders.push(`${serverAppDir} が存在します`);
}

if (offenders.length > 0) {
  console.error("開発専用ルートが production ビルドに含まれています:");
  for (const o of offenders) console.error(`  ${o}`);
  process.exit(1);
}

console.log(
  `check-dev-routes: 開発専用ルートは production ビルドに含まれていません（検査: ${found.join(", ")}）`,
);
