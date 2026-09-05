/**
 * 転写 provider のインタフェース（TRANSCRIPTION.md §5）。
 *
 * **型は §5 のまま置く。** ここを実装の都合で変えると、
 * 「どの provider を差しても同じ形が返る」という契約テストの前提が崩れる。
 *
 * 実装は 2 系統。
 *   - stub（packages/core/src/transcription/stub.ts）… ネットワークを使わない。CI・P4
 *   - 実 provider                                   … P5（Pass A）・P8（Pass B）
 *
 * **stub で通ったことを実物で通ったと書かない**（ACCEPTANCE.md §0）。
 */

export type WordToken = {
  word: string;
  startMs: number;
  endMs: number;
  confidence?: number;
};

export type AlignResult = {
  words: WordToken[];
  providerId: string;
  model: string;
  durationMs: number;
};

export type StageTranscriptResult = {
  /** 1..12 */
  stageNo: number;
  /** 逐語。整文しない（CLAUDE.md「短い相づち・フィラー・沈黙を自動削除しない」） */
  text: string;
  lines: { startMs: number; endMs: number; text: string }[];
  providerId: string;
  model: string;
};

/** Pass A */
export interface AlignProvider {
  readonly id: string;
  readonly model: string;
  align(input: { signedUrl: string; durationMs: number }): Promise<AlignResult>;
}

/** Pass B */
export interface StageTranscribeProvider {
  readonly id: string;
  readonly model: string;
  prepare(input: { signedUrl: string }): Promise<{ handle: string }>;
  transcribeRange(input: {
    handle: string;
    startMs: number;
    endMs: number;
    verbatim: true;
  }): Promise<StageTranscriptResult>;
}

/** provider が返した失敗。502 PROVIDER_ERROR に写す */
export class ProviderError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "ProviderError";
  }
}
