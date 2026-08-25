"use client";

/**
 * 区間再生の位置を確かめるための開発専用ページ。
 *
 * production ビルドには含まれない。
 *   - next.config.ts が `dev.tsx` を pageExtensions に含めるのは開発サーバのときだけ
 *   - 念のため、実行時にも production なら 404 にする
 *
 * このページで検証できるのは「メディア要素の currentTime が意図した位置に来るか」
 * までである。**音が鳴るか、その位置の発言が正しいかは人にしか確かめられない**
 * （ACCEPTANCE.md H1）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { notFound } from "next/navigation";
import { PROBE_DURATION_SECONDS, createSilentWav } from "./silent-wav";

/** 区間再生の対象。実データではなく、位置検証のための固定値 */
const SEGMENTS = [
  { id: "seg-1", label: "冒頭", start: 0.5, end: 2.0 },
  { id: "seg-2", label: "中盤", start: 12.5, end: 14.0 },
  { id: "seg-3", label: "終盤", start: 18.25, end: 19.5 },
] as const;

export default function MediaProbePage() {
  if (process.env.NODE_ENV === "production") notFound();

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopAtRef = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  // 音源はコードから作る（リポジトリに音声ファイルを置かないため）。
  // 生成した Blob URL は要素へ直接渡す。state を経由させる必要がない。
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const blob = new Blob([createSilentWav().buffer as ArrayBuffer], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);
    audio.src = url;
    return () => {
      audio.removeAttribute("src");
      URL.revokeObjectURL(url);
    };
  }, []);

  const seekTo = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = seconds;
    setCurrentTime(audio.currentTime);
  }, []);

  const playSegment = useCallback((start: number, end: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    stopAtRef.current = end;
    audio.currentTime = start;
    setCurrentTime(audio.currentTime);
    void audio.play().catch(() => {
      // 自動再生が禁止されている環境でも、位置合わせは済んでいる
    });
  }, []);

  return (
    <main>
      <h1>メディア再生位置の確認（開発専用）</h1>
      <p>
        無音の WAV を実行時に生成しています。音は鳴りません。ここで確かめられるのは 位置だけです。
      </p>

      <audio
        ref={audioRef}
        data-testid="probe-audio"
        data-ready={ready ? "true" : "false"}
        data-current-time={currentTime.toFixed(3)}
        controls
        preload="auto"
        onLoadedMetadata={() => setReady(true)}
        onTimeUpdate={(e) => {
          const audio = e.currentTarget;
          const stopAt = stopAtRef.current;
          if (stopAt !== null && audio.currentTime >= stopAt) {
            audio.pause();
            stopAtRef.current = null;
          }
          setCurrentTime(audio.currentTime);
        }}
        onSeeked={(e) => setCurrentTime(e.currentTarget.currentTime)}
      />

      <p>
        長さ: <span data-testid="probe-duration">{PROBE_DURATION_SECONDS}</span> 秒 / 現在位置:{" "}
        <span data-testid="probe-current-time">{currentTime.toFixed(3)}</span> 秒
      </p>

      <ul>
        {SEGMENTS.map((segment) => (
          <li key={segment.id}>
            <button
              type="button"
              data-testid={`seek-${segment.id}`}
              data-start={segment.start}
              onClick={() => seekTo(segment.start)}
            >
              {segment.label} {segment.start}秒へ移動
            </button>{" "}
            <button
              type="button"
              data-testid={`play-${segment.id}`}
              data-start={segment.start}
              data-end={segment.end}
              onClick={() => playSegment(segment.start, segment.end)}
            >
              {segment.label} {segment.start}〜{segment.end}秒を再生
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
