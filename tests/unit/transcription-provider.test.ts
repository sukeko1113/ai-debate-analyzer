/**
 * provider の契約テスト（TRANSCRIPTION.md §5）。
 *
 * 「どの provider を差しても同じ形の結果が返る」ことを確かめる。
 * P4 の時点で実装があるのは stub だけなので、**いま確かめているのは形だけである。**
 * 実 provider を足す P5・P8 で、同じ検査に実物を通すこと。
 *
 * **stub で通ったことを「実 provider で動いた」と書かない**（ACCEPTANCE.md §0）。
 */
import { describe, expect, it } from "vitest";
import {
  getProviders,
  resetProvidersForTests,
  setProvidersForTests,
  StubAlignProvider,
  StubStageTranscribeProvider,
  type AlignProvider,
  type StageTranscribeProvider,
} from "../../packages/core/src/transcription";

/** P5・P8 で実 provider を足したら、この配列に足す */
const ALIGN_PROVIDERS: (() => AlignProvider)[] = [() => new StubAlignProvider()];
const STAGE_PROVIDERS: (() => StageTranscribeProvider)[] = [
  () => new StubStageTranscribeProvider(),
];

describe("AlignProvider の契約", () => {
  for (const make of ALIGN_PROVIDERS) {
    const provider = make();

    it(`${provider.id}: AlignResult の形を返す`, async () => {
      const result = await provider.align({
        signedUrl: "https://example.test/a",
        durationMs: 4000,
      });

      expect(result.providerId).toBe(provider.id);
      expect(result.model).toBe(provider.model);
      expect(result.durationMs).toBe(4000);
      expect(result.words.length).toBeGreaterThan(0);

      for (const word of result.words) {
        expect(typeof word.word).toBe("string");
        expect(word.startMs).toBeGreaterThanOrEqual(0);
        expect(word.endMs).toBeGreaterThan(word.startMs);
        // 音声より後ろに単語がある状態を作らない
        expect(word.endMs).toBeLessThanOrEqual(result.durationMs);
      }
    });

    it(`${provider.id}: 単語は時刻順に並ぶ`, async () => {
      const { words } = await provider.align({ signedUrl: "", durationMs: 4000 });
      for (let i = 1; i < words.length; i++) {
        expect(words[i]!.startMs).toBeGreaterThanOrEqual(words[i - 1]!.startMs);
      }
    });
  }
});

describe("StageTranscribeProvider の契約", () => {
  for (const make of STAGE_PROVIDERS) {
    const provider = make();

    it(`${provider.id}: StageTranscriptResult の形を返す`, async () => {
      const { handle } = await provider.prepare({ signedUrl: "https://example.test/a" });
      const result = await provider.transcribeRange({
        handle,
        startMs: 1000,
        endMs: 5000,
        verbatim: true,
      });

      expect(result.providerId).toBe(provider.id);
      expect(result.model).toBe(provider.model);
      expect(result.stageNo).toBeGreaterThanOrEqual(1);
      expect(result.stageNo).toBeLessThanOrEqual(12);
      expect(result.text.length).toBeGreaterThan(0);
      expect(result.lines.length).toBeGreaterThan(0);
    });
  }
});

describe("stub の決定性", () => {
  /**
   * ランダムや時刻依存があると、冪等性の検査（M37・M38）が
   * provider の揺れで落ちる。何が壊れたのか分からなくなる。
   */
  it("同じ入力に同じ出力を返す", async () => {
    const a = await new StubAlignProvider().align({ signedUrl: "x", durationMs: 4000 });
    const b = await new StubAlignProvider().align({ signedUrl: "x", durationMs: 4000 });
    expect(a).toEqual(b);
  });

  it("フィラーを落とさない（逐語であることの形）", async () => {
    const { words } = await new StubAlignProvider().align({ signedUrl: "", durationMs: 4000 });
    expect(words.map((w) => w.word)).toContain("uh");
  });
});

describe("getProviders", () => {
  it("設定が stub なら stub を返す", () => {
    resetProvidersForTests();
    const providers = getProviders({
      TRANSCRIBE_A_PROVIDER: "stub",
      TRANSCRIBE_B_PROVIDER: "stub",
    });
    expect(providers.align).toBeInstanceOf(StubAlignProvider);
    expect(providers.stageTranscribe).toBeInstanceOf(StubStageTranscribeProvider);
  });

  /**
   * **知らない名前を stub で握りつぶさない。**
   * 握りつぶすと、設定を直したつもりの本番が「解析できたように見えて中身は合成データ」になる。
   */
  it("知らない provider 名は落とす（stub へ落ちない）", () => {
    resetProvidersForTests();
    expect(() =>
      getProviders({ TRANSCRIBE_A_PROVIDER: "whisper-x", TRANSCRIBE_B_PROVIDER: "stub" }),
    ).toThrow(/TRANSCRIBE_A_PROVIDER=whisper-x/);
  });

  it("テストからの差し替えが効く", () => {
    const align = new StubAlignProvider();
    const stageTranscribe = new StubStageTranscribeProvider();
    setProvidersForTests({ align, stageTranscribe });

    // 知らない名前でも、差し替えが効いていれば落ちない
    const providers = getProviders({
      TRANSCRIBE_A_PROVIDER: "whisper-x",
      TRANSCRIBE_B_PROVIDER: "whisper-x",
    });
    expect(providers.align).toBe(align);

    resetProvidersForTests();
  });
});
