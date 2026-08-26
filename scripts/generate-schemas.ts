/**
 * Zod スキーマから JSON Schema を生成する（BASIC_DESIGN_v04 §4.1）。
 *
 * schemas/ は生成物である。手書きしない。
 * CI は生成し直して差分ゼロであることを検査する（ACCEPTANCE.md M2）。
 *
 * Zod が唯一の定義である。JSON Schema は生成物であり、手書きしない。
 * P11 で DB の enum を作るときも、この Zod 定義から導く。
 *
 * 注意: `.refine()` で書いた不変条件（42分・担当者表の整合・M26 の
 * 「debater 由来の比較は根拠segment必須」など）は JSON Schema に現れない。
 * JSON Schema は形の記述であって検証器ではない。検証は Zod 側で行うこと。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { envSchema } from "../packages/core/src/env";
import { Ruleset } from "../packages/core/src/ruleset/schema";
import {
  ArgumentNode,
  ComparisonAxis,
  FlowLink,
  Issue,
  RuleFlag,
} from "../packages/core/src/schema/flow";
import { JudgeDecision, JudgeRun } from "../packages/core/src/schema/judge";

interface Entry {
  /** 出力ファイル名（schemas/ 配下） */
  file: string;
  schema: z.ZodType;
  id: string;
}

const ID_BASE = "https://github.com/sukeko1113/ai-debate-analyzer/schemas";

const REGISTRY: Entry[] = [
  { file: "env.schema.json", schema: envSchema, id: `${ID_BASE}/env.schema.json` },
  { file: "ruleset.schema.json", schema: Ruleset, id: `${ID_BASE}/ruleset.schema.json` },
  { file: "issue.schema.json", schema: Issue, id: `${ID_BASE}/issue.schema.json` },
  {
    file: "argument-node.schema.json",
    schema: ArgumentNode,
    id: `${ID_BASE}/argument-node.schema.json`,
  },
  { file: "flow-link.schema.json", schema: FlowLink, id: `${ID_BASE}/flow-link.schema.json` },
  { file: "rule-flag.schema.json", schema: RuleFlag, id: `${ID_BASE}/rule-flag.schema.json` },
  {
    file: "comparison-axis.schema.json",
    schema: ComparisonAxis,
    id: `${ID_BASE}/comparison-axis.schema.json`,
  },
  { file: "judge-run.schema.json", schema: JudgeRun, id: `${ID_BASE}/judge-run.schema.json` },
  {
    file: "judge-decision.schema.json",
    schema: JudgeDecision,
    id: `${ID_BASE}/judge-decision.schema.json`,
  },
];

const outDir = path.resolve("schemas");
mkdirSync(outDir, { recursive: true });

for (const entry of REGISTRY) {
  const jsonSchema = {
    $id: entry.id,
    ...z.toJSONSchema(entry.schema, { io: "input" }),
  };
  const target = path.join(outDir, entry.file);
  writeFileSync(target, `${JSON.stringify(jsonSchema, null, 2)}\n`, "utf8");
  console.log(`generated schemas/${entry.file}`);
}
