/**
 * 転写 provider の入口（TRANSCRIPTION.md §5）。
 *
 * 形は storage/index.ts に揃えてある。**環境変数で stub へ落とす分岐を作らない。**
 * `TRANSCRIBE_A_PROVIDER` は「どの provider を使うか」を選ぶものであって、
 * 「設定が無いときの逃げ道」ではない。逃げ道を作ると、設定漏れの本番が
 * 「解析できたように見えて、中身が合成データ」になる。
 *
 * テストは `setProvidersForTests()` で明示的に差し替える。
 */
import type { Env } from "../env";
import type { AlignProvider, StageTranscribeProvider } from "./provider";
import { StubAlignProvider, StubStageTranscribeProvider } from "./stub";

export * from "./provider";
export * from "./stub";

export interface Providers {
  align: AlignProvider;
  stageTranscribe: StageTranscribeProvider;
}

let testOverride: Providers | null = null;

/** テストからの差し替え。**本番では効かない**（storage/index.ts と同じ） */
export function setProvidersForTests(providers: Providers): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("setProvidersForTests は本番では使えません");
  }
  testOverride = providers;
}

export function resetProvidersForTests(): void {
  testOverride = null;
}

/**
 * 設定から provider を組み立てる。
 *
 * **P4 の時点で実装があるのは `stub` だけである。** 実 provider は P5・P8 で足す。
 * 知らない名前が来たら落とす。「知らないので stub にしておく」をしない
 * （設定を直したつもりの本番が、直っていないまま動く）。
 */
export function getProviders(env: Pick<Env, "TRANSCRIBE_A_PROVIDER" | "TRANSCRIBE_B_PROVIDER">) {
  if (testOverride) return testOverride;

  return {
    align: alignProviderFor(env.TRANSCRIBE_A_PROVIDER),
    stageTranscribe: stageTranscribeProviderFor(env.TRANSCRIBE_B_PROVIDER),
  } satisfies Providers;
}

function alignProviderFor(name: string): AlignProvider {
  if (name === "stub") return new StubAlignProvider();
  throw new Error(
    `TRANSCRIBE_A_PROVIDER=${name} に対応する実装がありません（P4 の時点では stub だけ）`,
  );
}

function stageTranscribeProviderFor(name: string): StageTranscribeProvider {
  if (name === "stub") return new StubStageTranscribeProvider();
  throw new Error(
    `TRANSCRIBE_B_PROVIDER=${name} に対応する実装がありません（P4 の時点では stub だけ）`,
  );
}
