# TRANSCRIPTION.md — 4パス構成（Pass A / S / B / C）と provider 契約

本書は v09 §3.5・§6・§8.5・§12.1・§17.3 に追随している（2026-09-06）。

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
| 話者分離 | 話者ラベルを返す | **使わない（返ってきても取り込まない）** |
| 単語時刻の精度 | 合成 fixture に対する単語境界の誤差が、**中央値 0.3 秒以内・95 パーセンタイル 1.0 秒以内** | 必須（`ACCEPTANCE.md` M46） |

精度を必須要件に入れた理由（v06）：P6 は「境界誤差2秒以内」、G2 は「誤差中央値0.5秒以内」を要求している。
時刻の物差しである Pass A に精度要件が無いまま、その物差しを使う工程に精度を求めると、達成不能な受け入れ基準になる。
タイムスタンプのドリフトは既知の問題なので、provider 選定の段階で測る。

### 2.1 話者分離を使わない理由（「不要」から「使わない」へ。v07）

会議は発言順が決まっていないため、声質クラスタと人手の突き合わせが要る。
**HEnDAは違う。** 発言順は12ステージで固定され、
どのスピーチを誰が担当するかは大会ルール2.2の担当者表で決まっている（`HENDA_RULESET.md` §2）。
したがって**ステージ境界さえ確定すれば話者は導出できる**。

v05 までは「不要」としていた。v07 で「使わない」に変えたのは、実試合で**害がある**ことが分かったためである。

- 実試合の書き起こしでは、自動話者分離の出力が Speaker 0〜15 の **16 ラベル**に割れていた。**8名の試合である。**
  同一人物が複数の ID へ分割され、別人が同一の ID へ統合されており、そのままでは座席の割当に使えなかった。
- 実際に座席が決まったのは、開会の自己紹介で述べられた氏名と担当者表を突き合わせた経路である。
  ①の立論者が②で応答し、④の質問者が⑪で総括し、⑥の質問者が⑨のディフェンスを担当する、という対応が
  すべて矛盾なく一致した（`HENDA_RULESET.md` §2.1）。
- 分離出力が「不要」なだけなら害が無いが、**誤ったラベルが画面に出れば、人はそれを起点に確認を始めてしまう**。
  担当者表から導出した割当のほうが正確なのに、AI が付けたラベルと食い違ったときに、どちらを信じるかという判断が発生する。

したがって、provider が話者ラベルを返しても取り込まない。**`align_words` に `speaker` 列を作らない**（`DATA_MODEL.md` §4）。
whosaid-editor のインポート経路（`REVIEW_SEMANTICS.md` §4）でも `speakers[]` は座席への対応づけの**入力としてのみ**使い、
ラベルそのものを保存しない。取り込みコードに話者ラベルへの参照があれば CI で失敗させる（`ACCEPTANCE.md` M53）。

本アプリは、話者割当に使っていた人手を
「どの論点に対する発言か」の確定に振り向ける。これがUIの重心の違いになる。

---

## 3. Pass B — Gemini を使う場合の前提

- 音声は **1秒あたり32トークン**として扱われる。計時対象の42分 ≒ 80,600トークン、
  アナウンスを含む**実ファイル50分 ≒ 96,000トークン**。見積りは実ファイル長で行う（v09 §3.1・§19.1）。
- 1プロンプトあたりの音声長は最大**約9.5時間**。50分は余裕で収まる。
- **MM:SS形式で範囲を指定した転写**を要求できる。

### 3.1 実装方針

- 音声はFiles APIへ**1回だけ**アップロードし、以降は file URI を使い回す。
  → **ステージごとに音声を切り出さない。結果としてサーバにffmpegが要らない。**
- 各ステージの呼び出しでは、Pass Sが決めた範囲をMM:SSで指定し、その範囲の逐語転写のみを求める。
- 逐語モードの指示（フィラー・言い直しを残す、整文しない）を必ず含める。
- コンテキストキャッシュを使える provider では利用する。ただしキャッシュは **Gemini 固有の機能であり、§5 の provider 契約には含まれない**。
  provider が `capabilities.contextCache` を `true` と宣言した場合に**のみ**、キャッシュ利用の確認を受け入れ基準に含める
  （`TASKS.md` P8）。効かない場合の入力量は 12回 × 96,000 ≒ 1,150,000 トークン（v09 §19.1 で見積もる）。

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
  readonly capabilities: { contextCache: boolean };   // v09 §6.6。P1.5 で追加（P5 の provider 実装より先に要る）
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

`capabilities` は、provider 固有の機能をインタフェース側で宣言するための枠である。`contextCache` はその最初の項目で、
コンテキストキャッシュが Gemini 固有の機能であるために設けた。**契約テストは「宣言した機能が実際に使えること」までは検査しない。**
使えることの確認は、宣言が `true` の provider に限って受け入れ基準に入る（`TASKS.md` P8）。
`AlignProvider` には `capabilities` を足さない。`packages/core/src/transcription/provider.ts` と stub への追加は P1.5。

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

- **`kind` は4値**：`align`（Pass A）/ `stage_detect`（Pass S）/ `stage_transcribe`（Pass B。`target_stage_no` 1〜12）/ `anchor`（Pass C）。
  `status` は5値：`queued` / `running` / `succeeded` / `failed` / `canceled`（`DATA_MODEL.md` §4）。
- **冪等キー** = `match_id` + `kind` + `target_stage_no` + `params_hash`
  同じキーのジョブが `running` または `succeeded` なら、新規作成せず既存を返す。
  **DB側の制約は `UNIQUE NULLS NOT DISTINCT` にする。** `target_stage_no` は
  `stage_transcribe` 以外では NULL であり、素の `UNIQUE` では重複を防げない
  （`DATA_MODEL.md` §4）。
- **`params_hash` はサーバが決める。** `kind` / `target_stage_no` / `ruleset_version` /
  `provider_id` / `model` を正規化して SHA-256。リクエストから受け取らない。
- **楽観ロック** = `lock_version`。`running` への遷移は条件付きUPDATEで行う。
- **1ジョブ = 2〜4分の音声、または純粋計算。** Vercelの実行時間内に確実に終わる粒度。
- 実行契機はクライアントのポーリングと Vercel Cron の**両方**。
  ブラウザを閉じても進み、開いていれば速く進む。
  秘密を要る `/internal/jobs/run` はブラウザから叩けないため、ポーリング側には
  `POST /matches/{id}/jobs/run` を使う。**どちらも1回の呼び出しで最大1件**
  （`API_SPEC.md` §3.1）。実行契機を含む job API 6本は **P4.5**（v09 §17.3）。
  P4 で入ったのは表・状態遷移トリガ・RLS・システム actor・`schema/job.ts` まで。
- **`max_attempt` は総試行回数の上限である。** 自動再投入の上限ではない。
  人が `retry` を撃った回数も同じ `attempt` に積む。別勘定にすると、
  `attempt` が実際に走らせた回数を表さなくなる（行を作り直さない設計と食い違う）。
  上限に達したジョブへの `retry` は **`409 VERSION_CONFLICT`**
  （`cancel` を終了状態に撃ったときと同じ「もう動かせない」）。新しい語彙は増やさない。
- 失敗ジョブは**部分再実行**できる。全体をやり直さない。
- 実行のたびに `provider_id` / `model` / 所要時間 / 実トークン量を記録する（コスト実績の突合に使う）。

### 6.3 やってはいけないこと

- 42分の音声を1回の同期呼び出しで処理する
- 進捗をメモリ上だけで持つ（関数インスタンスが再利用されると消える）
- 失敗時に人手の確認結果ごとリセットする
- **`GET /jobs` に実行の副作用を持たせる**（リトライやプリフェッチで意図せず走る）
- **秘密（`JOB_CRON_SECRET`）をクライアントへ出して `/internal/*` を直接叩かせる**

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

---

## 8. 12ステージの外側と欠損（v07。P7.5 / P7.6）

実試合の録音は、①肯定立論の前に開会と自己紹介が置かれ、⑩と⑪の本文が丸ごと失われていた。
4パスの出力をそのまま12ステージへ押し込むと、前者は判定材料に、後者は「応答しなかった」に化ける。
どちらも起こしてはならない（v09 §3.5・§8.5・§9.3）。

### 8.1 12ステージの外側の区間

| 区間 | 実試合での例 | 保持先 | 判定での扱い |
| --- | --- | --- | --- |
| 開会・自己紹介 | 00:12〜05:30 前後。8名が順に名乗り担当を宣言する | `match_events(kind='self_introduction')` ＋ `transcript_segments`（`stage_no` NULL、`event_id` あり） | 判定材料にしない。根拠として引用できない（`422 NON_STAGE_SEGMENT_CITED`） |
| チェアパーソンのアナウンス | "We will now have a brief introductions from the negative side members." | `match_events(kind='announcement')` | 同上。ステージ境界の手掛かりとしてのみ使う |
| 準備時間 | ①後1分、③後1分、④後2分、⑧後2分、⑩後2分 | `match_events(kind='prep')` | 同上 |
| スピーチ冒頭の名乗り | "My name is ○○. I'm a constructive speaker from the affirmative side." | `transcript_segments`（`stage_no` あり、`is_self_introduction = true`）＋ `match_members.intro_segment_id` | 保持レベル C で伏せる対象 |

Pass B はこれらの区間も**逐語で転写する**（自己紹介の名乗りは座席の結び付けに要る）。捨てない。
`transcript_segments` に入れるのは、名乗り区間の削除・伏せ字・時刻照合を別系統で二重実装しないためである。
`stage_no` を NULL 可にし、NULL のときは `event_id` を必須にする（CHECK。`DATA_MODEL.md` §5）。

**名乗りは二か所にある。** 自己紹介ラウンドの名乗りと、各スピーチ冒頭の名乗りである。座席の結び付け（`HENDA_RULESET.md` §2.1）には
前者を使い、保持レベル C で伏せる対象には両方を含める（`PRIVACY_RETENTION.md` §3）。印は `is_self_introduction` に統一する。

### 8.2 ステージ長の妥当性検査と欠損の記録

Pass S の境界候補を人が確定した後、ruleset の規定時間と実測長を突き合わせる（v09 §8.5）。

| 検査 | 条件 | 立てるフラグ |
| --- | --- | --- |
| 長すぎる | 実測長 > (`durationSec` + `graceSec`) の2倍 | `stage_duration_anomaly` |
| 短すぎる | 実測長 < `durationSec` の 1/3 | `stage_duration_anomaly` |
| 単一区間が長すぎる | ひとつの `transcript_segment` が、そのステージの `durationSec` を超える | `segment_duration_anomaly` |
| 合計が合わない | 12ステージの実測長合計と公式の34分の差が3分を超える | `stage_duration_anomaly`（match 単位） |

閾値を緩くしているのは、実測長が名乗りとチェアパーソンの発話をどこで切るかで数十秒動くためである。
捕まえたいのは「3分のスピーチが10分になっている」ような桁の違いであって、微差ではない。
**このフラグは判定に入らない。** ステージ確認 UI（画面 C）で強調表示し、人が境界を引き直すか、欠損として記録するかを選ぶ。

欠損は `stage_segments.coverage_status`（`complete` / `partial` / `missing`）と `coverage_note` に記録する。
**`missing` にできるのは人だけ**である。`coverage_status ≠ complete` のステージは
(a) そのステージを to とする DROPS を導出せず `stage_coverage_gap` を立て（`JUDGE_LOGIC.md` §4.1）、
(b) その区間を判定根拠に引いたままロックできない（`409 GAPPED_STAGE_CITED`）。

> **三つを混ぜない。** 「記録が無い」（`coverage_status`）、「聞き取れなかった」（`audibility = unheard`）、
> 「応答しなかった」（DROPS）は別の事象であり、判定材料になるのは DROPS だけ。
> 復旧の手段も違う（記録が無い→音声の入れ直し、聞き取れなかった→聞き直し）。
