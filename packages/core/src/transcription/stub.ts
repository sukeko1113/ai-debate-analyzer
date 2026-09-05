/**
 * ネットワークを使わない provider（TASKS.md P4 / TRANSCRIPTION.md §5）。
 *
 * このクラスは**決定論的**である。同じ入力に必ず同じ出力を返す。
 * ランダムや時刻依存の分岐を持たない。持たせると、冪等性の検査
 * （ACCEPTANCE.md M37・M38）が provider の揺れで落ち、
 * 何が壊れたのか分からなくなる。
 *
 * **stub で通ったことを「実 provider で動いた」と報告しない**（ACCEPTANCE.md §0）。
 * 実物の疎通は P5（Pass A）・P8（Pass B）で、実キーを持つ環境から確かめる。
 */
import type {
  AlignProvider,
  AlignResult,
  StageTranscribeProvider,
  StageTranscriptResult,
  WordToken,
} from "./provider";

export const STUB_PROVIDER_ID = "stub";
export const STUB_MODEL = "stub-v1";

/** 1 語あたりの長さ。合成データなので実測に寄せる必要はない */
const WORD_MS = 400;

/**
 * 決定論的な語の並び。
 *
 * 逐語であることを形の上でも示すため、フィラー（`uh`）を含めてある。
 * **整文しない**（CLAUDE.md「短い相づち・フィラー・沈黙を自動削除しない」）。
 */
const WORDS = ["we", "uh", "believe", "that", "the", "motion", "should", "pass"] as const;

function wordsFor(durationMs: number): WordToken[] {
  const count = Math.max(1, Math.floor(durationMs / WORD_MS));
  const tokens: WordToken[] = [];
  for (let i = 0; i < count; i++) {
    const startMs = i * WORD_MS;
    tokens.push({
      word: WORDS[i % WORDS.length]!,
      startMs,
      // 最後の語が durationMs を超えないようにする。超えると
      // 「音声より後ろに単語がある」データになり、区間再生の検査で気づきにくい
      endMs: Math.min(startMs + WORD_MS, durationMs),
      confidence: 0.9,
    });
  }
  return tokens;
}

export class StubAlignProvider implements AlignProvider {
  readonly id = STUB_PROVIDER_ID;
  readonly model = STUB_MODEL;

  /** 呼ばれた記録。ネットワークを使っていないことの確認に使う */
  readonly calls: { signedUrl: string; durationMs: number }[] = [];

  async align(input: { signedUrl: string; durationMs: number }): Promise<AlignResult> {
    this.calls.push(input);
    return {
      words: wordsFor(input.durationMs),
      providerId: this.id,
      model: this.model,
      durationMs: input.durationMs,
    };
  }
}

export class StubStageTranscribeProvider implements StageTranscribeProvider {
  readonly id = STUB_PROVIDER_ID;
  readonly model = STUB_MODEL;

  async prepare(input: { signedUrl: string }): Promise<{ handle: string }> {
    // 実 provider はここでアップロードや前処理を行う。stub は URL をそのまま返す
    return { handle: input.signedUrl };
  }

  async transcribeRange(input: {
    handle: string;
    startMs: number;
    endMs: number;
    verbatim: true;
  }): Promise<StageTranscriptResult> {
    const tokens = wordsFor(input.endMs - input.startMs);
    const text = tokens.map((t) => t.word).join(" ");

    return {
      // stub は区間からステージ番号を決められない。呼び出し側が上書きする前提で 1 を返す。
      // ここで推測すると、ステージ推定を provider がしているように見える（P6 の仕事である）
      stageNo: 1,
      text,
      lines: [{ startMs: input.startMs, endMs: input.endMs, text }],
      providerId: this.id,
      model: this.model,
    };
  }
}
