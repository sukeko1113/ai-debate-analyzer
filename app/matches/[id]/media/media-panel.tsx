"use client";

/**
 * 画面B: メディア取り込み（BASIC_DESIGN_v05 §15 / TASKS.md P3）。
 *
 * ここでやることは3つだけである。
 *   1. ファイルを選ぶ（SHA-256 を計算して intent へ渡す）
 *   2. 進捗が見える（TUS のチャンクごと）
 *   3. 上がったものを再生できる（単純な再生。シークバーはブラウザ標準）
 *
 * **区間再生は作らない。** 前後余白・キーボード操作・再生速度は
 * P10（Transcript Review UI）の仕様である（TRANSCRIPTION.md §7.2）。
 * P3 の時点では stage_segments も transcript_segments も無く、「区間」の元データが無い。
 *
 * **ファイル本体はここから Storage へ直接送る。** API サーバを通さない（API_SPEC.md §2.4）。
 */
import { useCallback, useRef, useState } from "react";
import * as tus from "tus-js-client";
import { MAX_MEDIA_BYTES, MediaMime, type MediaSource, type UploadIntentRes } from "@core/schema";
import { sha256HexOfBlob } from "@core/media/sha256";
import { TUS_CHUNK_SIZE } from "@core/storage/constants";

interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

async function api<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  const payload = await response.json();
  if (!response.ok) {
    const body = payload as ApiErrorBody;
    throw new Error(`${body.error?.code ?? response.status}: ${body.error?.message ?? "不明"}`);
  }
  return (payload as { data: T }).data;
}

/** 音声の長さはブラウザに読ませる。サーバに ffmpeg を置かないため（CLAUDE.md） */
function durationMsOf(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    const url = URL.createObjectURL(file);
    audio.preload = "metadata";
    audio.addEventListener("loadedmetadata", () => {
      URL.revokeObjectURL(url);
      resolve(Math.round(audio.duration * 1000));
    });
    audio.addEventListener("error", () => {
      URL.revokeObjectURL(url);
      reject(new Error("音声として読めませんでした。mp3 / m4a / wav を選んでください"));
    });
    audio.src = url;
  });
}

type Phase = "idle" | "hashing" | "uploading" | "registering" | "done";

export function MediaPanel({ matchId }: { matchId: string }) {
  const [token, setToken] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<MediaSource[]>([]);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const refresh = useCallback(async () => {
    setItems(await api<MediaSource[]>(`/api/v1/matches/${matchId}/media`, token));
  }, [matchId, token]);

  async function upload() {
    if (!file) return;
    setError(null);
    setMessage(null);
    setProgress(0);

    try {
      // 入力規約（TRANSCRIPTION.md §7）。サーバも同じ上限で弾くが、
      // 50MB を送り切ってから断られるのは無駄なので手前でも見る
      if (file.size > MAX_MEDIA_BYTES) {
        throw new Error(`50MB を超えています（${(file.size / 1024 / 1024).toFixed(1)}MB）`);
      }
      const mime = MediaMime.safeParse(file.type);
      if (!mime.success) {
        throw new Error(
          `扱えない形式です（${file.type || "不明"}）。mp3 / m4a / wav を選んでください`,
        );
      }

      setPhase("hashing");
      const sourceSha256 = await sha256HexOfBlob(file);
      const durationMs = await durationMsOf(file);

      const intent = await api<UploadIntentRes>(
        `/api/v1/matches/${matchId}/media/upload-intent`,
        token,
        {
          method: "POST",
          body: JSON.stringify({
            filename: file.name,
            byteSize: file.size,
            mime: mime.data,
            sourceSha256,
          }),
        },
      );

      if (intent.status === "already_exists") {
        setPhase("done");
        setMessage("同じ音声が既に登録されています。アップロードは行いませんでした。");
        await refresh();
        return;
      }

      setPhase("uploading");
      await new Promise<void>((resolve, reject) => {
        const upload = new tus.Upload(file, {
          endpoint: intent.tusEndpoint,
          // 署名トークンは x-signature ヘッダに載せる（TRANSCRIPTION.md §7.3）。
          // Authorization: Bearer <ユーザーJWT> は使わない。
          // ブラウザに Storage への直接の書き込み権限を持たせない構成である
          headers: { "x-signature": intent.uploadToken },
          // 6MB 固定。変更禁止（packages/core/src/storage/constants.ts）
          chunkSize: TUS_CHUNK_SIZE,
          uploadDataDuringCreation: true,
          removeFingerprintOnSuccess: true,
          metadata: {
            bucketName: intent.bucket,
            objectName: intent.storagePath,
            contentType: mime.data,
          },
          onProgress: (sent, total) => setProgress(Math.round((sent / total) * 100)),
          onSuccess: () => resolve(),
          onError: (e) => reject(e),
        });
        upload.start();
      });

      setPhase("registering");
      const registered = await api<{ status: string; mediaSourceId: string }>(
        `/api/v1/matches/${matchId}/media`,
        token,
        {
          method: "POST",
          body: JSON.stringify({
            storagePath: intent.storagePath,
            sourceSha256,
            durationMs,
            mime: mime.data,
            bitrate: null,
            channels: null,
            origin: "upload",
          }),
        },
      );

      setPhase("done");
      setMessage(
        registered.status === "restored"
          ? "削除済みだった音声を入れ直しました（restored）"
          : registered.status === "already_exists"
            ? "同じ音声が既に登録されています（already_exists）"
            : "登録しました（created）",
      );
      await refresh();
    } catch (e) {
      setPhase("idle");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function play(id: string) {
    setError(null);
    try {
      const res = await api<{ url: string; expiresAt: string }>(
        `/api/v1/media/${id}/playback-url`,
        token,
      );
      // **署名URLを保存しない。** 毎回発行する（API_SPEC.md §2.4）
      setPlaybackUrl(res.url);
      audioRef.current?.load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section>
      <p>
        <label htmlFor="token">アクセストークン（Supabase Auth の JWT）</label>
        <input
          id="token"
          data-testid="token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </p>

      <h2>音声を取り込む</h2>
      <p>
        mp3 / m4a / wav・50MB以下・mono 64〜96kbps 推奨。
        動画は扱いません（音声を書き出してから選んでください）。
      </p>

      <p>
        <input
          type="file"
          data-testid="file"
          accept="audio/mpeg,audio/mp4,audio/wav,audio/x-m4a"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </p>

      <p>
        <button
          type="button"
          data-testid="upload"
          disabled={!file || !token || phase !== "idle"}
          onClick={upload}
        >
          アップロード
        </button>
      </p>

      <p data-testid="phase">
        {phase === "idle" && "待機中"}
        {phase === "hashing" && "指紋（SHA-256）を計算しています…"}
        {phase === "uploading" && `アップロード中… ${progress}%`}
        {phase === "registering" && "登録しています…"}
        {phase === "done" && "完了"}
      </p>

      {message && <p data-testid="message">{message}</p>}
      {error && <p data-testid="error">エラー: {error}</p>}

      <h2>取り込み済み</h2>
      <p>
        <button type="button" data-testid="refresh" disabled={!token} onClick={refresh}>
          一覧を更新
        </button>
      </p>
      <ul data-testid="media-list">
        {items.map((m) => (
          <li key={m.id}>
            <span>{m.sourceSha256.slice(0, 12)}…</span>{" "}
            <span>{(m.durationMs / 1000 / 60).toFixed(1)}分</span> <span>{m.mime}</span>{" "}
            {m.purgedAt ? (
              <span>削除済み（A削除）</span>
            ) : (
              <button type="button" onClick={() => play(m.id)}>
                再生
              </button>
            )}
          </li>
        ))}
      </ul>

      {/*
        単純な再生。区間再生は P10（TRANSCRIPTION.md §7.2）。
        音が鳴るか、意図した位置かは人にしか確かめられない（ACCEPTANCE.md H1）
      */}
      <audio ref={audioRef} data-testid="player" controls src={playbackUrl ?? undefined} />
    </section>
  );
}
