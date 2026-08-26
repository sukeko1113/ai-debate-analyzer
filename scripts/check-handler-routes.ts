/**
 * 素の route.ts が無いことの検査（API_SPEC.md §11 / TASKS.md P2「やってはいけないこと」）。
 *
 * defineHandler を通らない経路ができると、次のどれかが黙って抜ける。
 *   JWT検証 / SET LOCAL app.actor_id / Zod検証 / expectedVersion /
 *   Idempotency-Key / エラー変換 / edit_logs
 * 抜けても動いてしまうため、レビューでは見つからない。ここで機械的に落とす。
 *
 * 使い方: npm run check-handler-routes
 */
import { globSync, readFileSync } from "node:fs";
import path from "node:path";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/** Next.js が Route Handler として認識する export のうち、ハンドラでないもの */
const NON_HANDLER_EXPORTS = new Set([
  "runtime",
  "dynamic",
  "revalidate",
  "fetchCache",
  "preferredRegion",
  "maxDuration",
  "generateStaticParams",
]);

const files = globSync("app/api/**/route.ts", { cwd: process.cwd() }).sort();

if (files.length === 0) {
  console.error("app/api 配下に route.ts が 1 つもありません。検査が空回りしています。");
  process.exit(1);
}

const offenders: string[] = [];

for (const file of files) {
  const source = readFileSync(path.resolve(file), "utf8");

  if (!/from\s+["'][^"']*http["']/.test(source) || !source.includes("defineHandler")) {
    offenders.push(`${file}: defineHandler を import していません`);
  }

  // export const GET = ... の右辺が defineHandler({ ... }) であること
  const exportRe = /export\s+(?:const|let|var|async\s+function|function)\s+([A-Za-z_$][\w$]*)/g;
  for (const match of source.matchAll(exportRe)) {
    const name = match[1]!;
    if (NON_HANDLER_EXPORTS.has(name)) continue;
    if (!HTTP_METHODS.includes(name)) {
      offenders.push(`${file}: route.ts が HTTP メソッド以外を export しています（${name}）`);
      continue;
    }
    const rest = source.slice(match.index! + match[0].length);
    if (!/^\s*=\s*defineHandler\s*\(/.test(rest)) {
      offenders.push(
        `${file}: export ${name} が defineHandler({...}) ではありません` +
          `（素の route を書かない。API_SPEC.md §11）`,
      );
    }
  }
}

if (offenders.length > 0) {
  console.error("defineHandler を通らない route があります:");
  for (const o of offenders) console.error(`  ${o}`);
  process.exit(1);
}

console.log(`check-handler-routes: ${files.length} 件の route.ts はすべて defineHandler 経由です`);
