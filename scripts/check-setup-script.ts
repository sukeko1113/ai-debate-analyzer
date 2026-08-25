/**
 * scripts/setup-cloud-env.sh の版ずれ検出。
 *
 * このスクリプトの実体は claude.ai/code の環境ダイアログ側にあり、
 * リポジトリのファイルはその写しである（DEV_ENVIRONMENTS.md §6.1）。
 * 両者がずれても機械には見えないので、せめて
 * 「リポジトリ側が変わったこと」がレビューで必ず目に入るようにする。
 *
 * 中身を変えたら:
 *   1. sha256 を更新する（npm run check-setup-script -- --update）
 *   2. 環境ダイアログの内容も貼り直す
 * この 2 番を忘れないための仕掛けである。
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const SCRIPT = "scripts/setup-cloud-env.sh";
const RECORD = "scripts/setup-cloud-env.sh.sha256";

const actual = createHash("sha256").update(readFileSync(SCRIPT)).digest("hex");

if (process.argv.includes("--update")) {
  writeFileSync(RECORD, `${actual}\n`, "utf8");
  console.log(`${RECORD} を更新しました: ${actual}`);
  console.log("環境ダイアログのセットアップスクリプトも貼り直してください。");
  process.exit(0);
}

const recorded = readFileSync(RECORD, "utf8").trim();

if (actual !== recorded) {
  console.error(`${SCRIPT} が変更されています。`);
  console.error(`  記録: ${recorded}`);
  console.error(`  実際: ${actual}`);
  console.error("");
  console.error("クラウド環境の設定ダイアログにも同じ内容を貼り直してから、");
  console.error("npm run check-setup-script -- --update で記録を更新してください。");
  process.exit(1);
}

console.log(`check-setup-script: ${SCRIPT} は記録と一致しています`);
