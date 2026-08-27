# TRANSCRIPTION.md — 4パス構成（Pass A / S / B / C）と provider 契約

## 0. 解くべき問題

長尺（42分）を処理しきれるか、そして**時刻が信用できるか**。

前身プロジェクト whosaid-editor の実測では、Geminiのタイムスタンプはドリフトする既知の問題があり、
按分補正と細切れ行の連結で凌いでいた。最終的に同プロジェクトは
**本文はGeminiの逐語モード、時刻はfaster-whisperの単語時刻**という役割分離に到達した。

その分離が効く理由は明確である。whisperは時刻を測る物差しとしてしか使っていないため、
whisperがフィラーを聞き取れなくても、**本文からフィラーが消えることは構造的にない**。
（67分の実会議で約200区間の相づちが照合不能になったが、本文は一文字も変わらなかった。）

v03はこの結論をクラウドへ移す。ただしクラウドでfaster-whisperを常時動かすのは
「特定PCに依存しない」の制約と相性が悪いため、
**単語時刻を返すAPIをPass Aのproviderとして扱い、照合ロジックだけを自前で持つ**。

---

## 1. 4パス構成

| パス | 目的 | 入力 | 出力 | 実行単位 |
| --- | --- | --- | --- | --- |
| **Pass A** アライン | 時刻の物差しを作る | 音声全体 | 単語と時刻の列 | 1ジョブ（provider側が長尺を処理） |
| **Pass S** ステージ推定 | 12ステージ境界の候補 | Pass A出力＋定型句辞書＋公式時間 | 境界候補と信頼度 | 1ジョブ（純粋計算） |
| **Pass B** 逐語転写 | 判定に使う本文 | 音声＋ステージの時間範囲 | ステージ単位の逐語テキスト | **12ジョブ**（ステージ単位） |
| **Pass C** 照合 | 本文と実測時刻の突合 | Pass A出力＋Pass B出力 | 区間ごとの確定時刻と被覆率 | 1ジョブ（純粋計算） |

### 1.1 Pass Bをステージ単位に割る理由

1. 1回の呼び出しが**3分前後の音声**に収まり、Vercel Functionsの実行時間内で確実に終わる。
2. モデルに与える時間範囲が短くなるため、**タイムスタンプのドリフトの絶対量が小さくなる**。
3. 失敗したステージだけを再実行できる。42分をやり直さなくてよい。

### 1.2 実行順序と依存

```
media upload
   └─> Pass A (align)  ──> Pass S (stage detect) ──> [人がステージ境界を確定]
                                                            └─> Pass B ×12 ──> Pass C (anchor)
```

**Pass Bは、人がステージ境界を確定してから走らせる。**
推定のまま12回呼ぶと、境界がずれていた場合に全ステージを取り直すことになる。

---

## 2. Pass A — provider要件

| 要件 | 内容 | 必須 |
| --- | --- | --- |
| 単語単位の時刻 | `word` / `startMs` / `endMs` の列を返す | 必須 |
| 長尺対応 | 42分以上を1リクエストで受ける、または非同期ジョブとポーリングを提供する | 必須 |
| URL入力 | 署名付きURLを渡せる（ファイル本体をサーバ経由で中継しない） | 推奨 |
| 話者分離 | 話者ラベルを返す | **不要** |

### 2.1 話者分離が不要な理由

会議は発言順が決まっていないため、声質クラスタと人手の突き合わせが要る。
**HEnDAは違う。** 発言順は12ステージで固定され、
どのスピーチを誰が担当するかは大会ルール2.2の担当者表で決まっている（`HENDA_RULESET.md` §2）。
したがって**ステージ境界さえ確定すれば話者は導出できる**。

本アプリは、話者割当に使っていた人手を
「どの論点に対する発言か」の確定に振り向ける。これがUIの重心の違いになる。

---

## 3. Pass B — Gemini を使う場合の前提

- 音声は **1秒あたり32トークン**として扱われる。42分 ≒ **80,600トークン**。
- 1プロンプトあたりの音声長は最大**約9.5時間**。42分は余裕で収まる。
- **MM:SS形式で範囲を指定した転写**を要求できる。

### 3.1 実装方針

- 音声はFiles APIへ**1回だけ**アップロードし、以降は file URI を使い回す。
  → **ステージごとに音声を切り出さない。結果としてサーバにffmpegが要らない。**
- 各ステージの呼び出しでは、Pass Sが決めた範囲をMM:SSで指定し、その範囲の逐語転写のみを求める。
- 逐語モードの指示（フィラー・言い直しを残す、整文しない）を必ず含める。
- **コンテキストキャッシュの利用を前提にする。** 効かない場合の入力量は12回×80,600 ≒ 967,000トークン。
  P8の受け入れ基準にキャッシュ利用の確認を含めること。

### 3.2 プロンプトに入れないもの

- 大会ルールの本文（条項番号と要約で足りる）
- 「どちらが勝ちそうか」に類する誘導
- チーム名・学校名（不要な文脈を与えない）

---

## 4. Pass C — アンカー照合

whosaid-editor の `anchor.py` をTypeScriptへ移植する。**元実装はMIT License。表記を残すこと。**

### 4.1 アルゴリズム

1. 正規化（NFKC・記号落とし・大文字小文字の統一）と、**元の位置へ戻る写像表**を作る
2. 区間ごとに、**その時刻の周りの単語だけ**を見て文字を突き合わせる
3. 一致した文字の時刻から、区間の始まりと終わりを引き直す
4. どれだけ乗ったか（**被覆率**）を返す。低ければ提案を諦める

### 4.2 全文照合をしない理由（実測に基づく）

全文どうしを差分アルゴリズムに掛けると、52分の会議で **66秒** かかる。O(n²) なので2時間なら5分を超える。
区間の時刻の周りだけを見れば n が千文字弱に落ちて **0.16秒** で済む。

速さ以上に効くのは、**誤マッチが構造的に起きなくなる**こと。
全文照合では同じ語句が3分先の同じ語句に当たり得るが、窓を切ればそもそも届かない。
窓から外れた区間は、黙って間違えず「照合できなかった」として返る。

### 4.3 パラメータ（既定値）

| パラメータ | 既定 | 意味 |
| --- | --- | --- |
| 窓幅 | 区間の推定時刻 ± 30秒 | これを超えて探さない |
| 被覆率の閾値 | 0.6 | 未満なら**時刻を書き換えない**（`time_status` は `unverified` のまま） |

### 4.4 やらないこと

- **線形補間による時刻推定はしない。**
  whosaid-editor が試作したうえで不採用としている（埋まる区間が少なく、推定の妥当性も実測で揺れた）。
- 照合できなかった区間を、それらしい時刻で埋めない。「照合できなかった」を素直に返す。

### 4.5 テスト

**anchor は純粋関数だけで書く。** 音声もモデルも要らず、
テキストと単語時刻のfixtureだけでテストできる。
音声系ロジックのうち、CIで完全に検証できる数少ない部分なので、ここは手を抜かない。

---

## 5. provider インタフェース

```ts
// packages/core/src/transcription/provider.ts

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
  stageNo: number;         // 1..12
  text: string;            // 逐語。整文しない
  lines: { startMs: number; endMs: number; text: string }[];
  providerId: string;
  model: string;
};

export interface AlignProvider {            // Pass A
  readonly id: string;
  align(input: { signedUrl: string; durationMs: number }): Promise<AlignResult>;
}

export interface StageTranscribeProvider {  // Pass B
  readonly id: string;
  prepare(input: { signedUrl: string }): Promise<{ handle: string }>;
  transcribeRange(input: {
    handle: string;
    startMs: number;
    endMs: number;
    verbatim: true;
  }): Promise<StageTranscriptResult>;
}
```

**契約テストを1本用意し、どのproviderを差しても同じ形の結果が返ることをCIで確認する。**
テストにはネットワークを使わない stub provider を用いる。

---

## 6. ジョブモデル

### 6.1 状態遷移

```
queued ──> running ──> succeeded
              │
              ├──> failed     (attempt < max なら queued へ戻す)
              └──> canceled
```

### 6.2 規則

- **冪等キー** = `match_id` + `kind` + `target_stage_no` + `params_hash`
  同じキーのジョブが `running` または `succeeded` なら、新規作成せず既存を返す。
- **楽観ロック** = `lock_version`。`running` への遷移は条件付きUPDATEで行う。
- **1ジョブ = 2〜4分の音声、または純粋計算。** Vercelの実行時間内に確実に終わる粒度。
- 実行契機はクライアントのポーリングと Vercel Cron の**両方**。
  ブラウザを閉じても進み、開いていれば速く進む。
- 失敗ジョブは**部分再実行**できる。全体をやり直さない。
- 実行のたびに `provider_id` / `model` / 所要時間 / 実トークン量を記録する（コスト実績の突合に使う）。

### 6.3 やってはいけないこと

- 42分の音声を1回の同期呼び出しで処理する
- 進捗をメモリ上だけで持つ（関数インスタンスが再利用されると消える）
- 失敗時に人手の確認結果ごとリセットする

---

## 7. メディア入力の規約

| 項目 | 規約 |
| --- | --- |
| 必須入力 | **音声**（mp3 / m4a / wav）。動画は任意の付随情報 |
| 受け付ける mime | `audio/mpeg` / `audio/mp4` / `audio/wav` / `audio/x-m4a` の4値のみ |
| ビットレート | **mono・64〜96 kbps** を推奨 |
| サイズ上限 | **50 MB**（Supabase Freeのグローバル上限が50MBを超えられないため） |
| アップロード | **大きさによらず常に TUS resumable upload**（理由は §7.3） |
| 動画からの抽出 | **ブラウザ内 ffmpeg.wasm**。サーバにffmpegを置かない |
| 保管 | 非公開バケット `media`、パスは `{match_id}/{sha256}.{ext}`（§7.3） |
| 再生 | 短命の署名URL（既定15分）をサーバが都度発行。DBにURLを保存しない |

42分の目安: mono 64kbps ≒ 20MB / mono 96kbps ≒ 30MB / stereo 128kbps ≒ 40MB。
動画（720p）は300MB〜1GBになるためFreeプランでは通らない。

**mime は申告値であり、内容の検証は行わない。**
実際の形式が違っても、この段階では検出しない。
Pass A で音声として読めなければ、そこで失敗する。
入口で中身を確かめるにはサーバでデコードする必要があり、それは「サーバにffmpegを置かない」に反する。

### 7.1 ffmpeg.wasm の注意

- SharedArrayBufferが必要なため、**該当ルートにのみ COOP / COEP ヘッダを設定する**（全体に掛けない）。
- 対応する入力サイズは2GB未満。超える場合はユーザー側で音声を書き出してもらう。
- 抽出に失敗したら音声ファイルの直接指定へ誘導する。**サーバ側でのフォールバック変換はしない。**

**動画からブラウザ内で抽出した音声も、4つの音声 mime のいずれかで登録する。**
動画の mime を `media_sources` に登録する経路は持たない。
`origin: 'extracted_in_browser'` が、抽出由来であることを示す。

**元動画そのものを保管するかは Phase B の話である。**
`PRIVACY_RETENTION.md` の保持レベルAは「音声・動画」と書いてあるが、
Phase A（P3）で扱うのは音声だけである。抽出UIも P3 では作らない。

### 7.2 区間再生

**これは P10（Transcript Review UI）の仕様である。P3 の画面Bでは実装しない。**
P3 の時点では `stage_segments` も `transcript_segments` も存在せず、
「区間」の元データが無い。UI だけ先に作ると、動かせないものが残る。
P3 の画面Bに要るのは、ファイルを選ぶ・進捗が見える・上がったものを再生できる（単純な再生）の3つだけである。

whosaid-editor の操作感を踏襲するが、実装はブラウザ標準のメディア要素で行う。

| 機能 | 既定 |
| --- | --- |
| 前後の余白 | 前1.0秒 / 後0.5秒 |
| 前後の確認 | 「5秒前から」「この先30秒」 |
| キーボード | Space=再生停止 / ↑↓=区間移動 / Tab=未確認の次へ / Ctrl+S=保存 |
| 再生速度 | 0.75 / 1.0 / 1.25 / 1.5（既定1.0） |

---

### 7.3 Storage の構成（P3で確定）

**ここが第二のセキュリティ境界である。** ブラウザが Storage へ直接送る以上、
DBのRLSとは別に、Storage 側でも「誰が書けるか」を決めておく必要がある。

| 項目 | 規約 |
| --- | --- |
| バケット | `media`（単一・**非公開**）。パスの接頭辞ではなくバケット名である |
| バケット内のパス | `{match_id}/{sha256}.{ext}` |
| 拡張子 | mime から決める。`audio/mpeg → mp3` / `audio/wav → wav` / `audio/mp4 → m4a` / `audio/x-m4a → m4a` |
| ホスト | `NEXT_PUBLIC_SUPABASE_STORAGE_URL`（`https://<project-ref>.storage.supabase.co`） |
| アップロード | 署名付きアップロードトークン方式。**ブラウザに anon key での書き込み権限を与えない** |
| Storage 側のポリシー | **誰も直接書けない**が既定。認可はサーバの署名発行時点で行う（matchのメンバーか） |
| チャンクサイズ | **6MB固定**（変更禁止。下記） |

#### 常に TUS を使う（大きさで経路を分けない）

Supabase の公式ドキュメントは「6MB超は TUS resumable upload を推奨」としている。
本件はそれに従うのではなく、**大きさによらず常に TUS を使う**。

理由は、**署名トークン方式と直結ホストが TUS 側にしかない**ためである。
標準アップロードと二経路を持つと、認可の形が二つになり、テストも二重になる。
50MB以下という上限があるので、常に TUS でも困らない。

> **後から標準アップロードを足したくなった人へ。**
> 上の判断を読んでから決めること。「小さいファイルは標準の方が速い」は理由になるが、
> そのとき認可の形が二つになることを引き受けるかどうかが論点である。

#### 認可の流れ

1. ブラウザがファイル全体を読み、SHA-256 を計算する（Web Crypto）
2. `POST /media/upload-intent`（`match:write`）。**サーバがここで認可する**
3. サーバが service role で署名トークンを発行し、パスとともに返す
4. ブラウザが TUS でアップロードする。トークンは **`x-signature` ヘッダ**に載せる
5. `POST /media`（`match:write`）で登録する

- **SHA-256 は「ストリーミング計算」ではない。**
  Web Crypto に逐次更新の API は無く（`crypto.subtle.digest` は入力全体を受け取る）、
  自前実装は「暗号処理を手書きしない」より優先する理由が無い。
  入力が **50MB 以下と決まっているから**全体を読んでいる
  （`packages/core/src/media/sha256.ts`）。**サイズ上限を上げるときは、ここも見直すこと。**
  上限が無ければこの判断は成り立たない。
- **エンドポイントは `{NEXT_PUBLIC_SUPABASE_STORAGE_URL}/storage/v1/upload/resumable`。**
  `{project-ref}.supabase.co` ではなく `{project-ref}.storage.supabase.co` を使う
  （公式: 大きなファイルでは直結ホストを使うこと）。
- **チャンクサイズは 6MB 固定。** 公式に `it must be set to 6MB (for now) do not change it` とある。
  定数は `packages/core/src/storage/` に1箇所だけ置く。
- 署名トークンの**有効期間は2時間に固定**されており、指定する引数がない。
  `expiresAt` は「発行時刻＋2時間」を返しているだけである（`API_SPEC.md` §2.3）。
- TUS が払い出すアップロード固有URLの有効期間は最大24時間。トークンの2時間とは別の時計である。
- `upsert` は**トークン発行時に焼き込まれる**。したがってサーバが決める。
  新規は `false`、`purged_at` 入りの行の再アップロードだけ `true`（`API_SPEC.md` §2.2）。

出典:
[Resumable Uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads) /
[Standard Uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads) /
[storage-js `createSignedUploadUrl`](https://github.com/supabase/storage-js/blob/master/src/packages/StorageFileApi.ts)

#### 未確認（実 Supabase でしか確かめられない）

- 署名トークンでのアップロードが、バケットのポリシー（「誰も直接書けない」）を**迂回するか**。
  ドキュメントの "Signed upload URLs can be used to upload files to the bucket
  **without further authentication**" と、認可をトークン発行時に行う設計からは迂回する読みである。
  **迂回する前提で実装し、`ACCEPTANCE.md` H5 として人が確かめる。**
  もし 403 になったら、**ポリシーを緩めず報告する**。
- `x-signature` 方式のとき、オブジェクトの `owner` に何が記録されるか。

#### バケットの作成（人手・実 Supabase 側）

リポジトリからは作れない。Supabase の画面で次のとおり作る。

| 設定 | 値 |
| --- | --- |
| Name | `media` |
| Public bucket | **オフ**（非公開） |
| Restrict file upload size | 有効・**50 MB** |
| Allowed MIME types | `audio/mpeg`, `audio/mp4`, `audio/wav`, `audio/x-m4a` |
| RLS ポリシー | **作らない**（誰も直接読み書きできない状態が既定） |
