/**
 * Zod スキーマから JSON Schema を生成する（BASIC_DESIGN_v04 §4.1）。
 *
 * schemas/ は生成物である。手書きしない。
 * CI は生成し直して差分ゼロであることを検査する（ACCEPTANCE.md M2）。
 *
 * P0 で登録するのは環境変数スキーマだけ。
 * Ruleset / Issue / ArgumentNode / FlowLink / JudgeRun / JudgeDecision は P1 で足す。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { envSchema } from "../packages/core/src/env";

interface Entry {
  /** 出力ファイル名（schemas/ 配下） */
  file: string;
  schema: z.ZodType;
  id: string;
}

const REGISTRY: Entry[] = [
  {
    file: "env.schema.json",
    schema: envSchema,
    id: "https://github.com/sukeko1113/ai-debate-analyzer/schemas/env.schema.json",
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
