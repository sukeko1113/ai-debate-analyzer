/**
 * 無音の WAV を実行時に組み立てる。
 *
 * 音声ファイルをリポジトリに置かないため（CLAUDE.md / check-no-real-data）、
 * 再生位置の検証に使う媒体はコードから作る。
 * 音は鳴らないが、`currentTime` が意図した位置に来るかは検証できる。
 */
export const PROBE_DURATION_SECONDS = 20;

const SAMPLE_RATE = 8000;
const BITS_PER_SAMPLE = 8;

export function createSilentWav(seconds = PROBE_DURATION_SECONDS): Uint8Array {
  const dataBytes = SAMPLE_RATE * seconds;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt チャンク長
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // モノラル
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, (SAMPLE_RATE * BITS_PER_SAMPLE) / 8, true); // byte rate
  view.setUint16(32, BITS_PER_SAMPLE / 8, true); // block align
  view.setUint16(34, BITS_PER_SAMPLE, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);

  // 8bit PCM の無音は 0x80
  new Uint8Array(buffer, 44).fill(0x80);
  return new Uint8Array(buffer);
}
