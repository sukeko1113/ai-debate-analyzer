# TASKS.md — PR分割

## 進め方の規則

- **1 PR = 1縦切り。** 現在のPRの受け入れ基準を満たしたことを確認するまで、次へ進まない。
- 着手前に実装計画を提示し、承認を得てから手を動かす。
- ブランチ: `feature/pXX-短い名前` → PR → `main`。
- 各PRの「読むもの」に挙げた文書は、実装前に必ず読む。
- 「やってはいけないこと」は、動いていてもマージしない条件である。
- 人間検証が必要なPRは、CIが緑でも**「人の確認待ち」として報告する**（`ACCEPTANCE.md` §2.1）。
- 各PRに**実行場所**を書いてある。デスクトップ指定のPRをWebで「動いた」と報告しない。
  使い分けの根拠は `DEV_ENVIRONMENTS.md`。

---

## 全体の形（v04で再構成）

v03のP0〜P16は、実質「v1.0完成ロードマップ」だった。
v04では **Phase A で最終製品の全工程を細く1本通し**、そのあとPhase Bで太らせる。

```
Phase A（縦切り）: 合成試合 → 音声取込 → ステージ確定 → Transcript
                  → AD1/DA1だけのFlow → Judge候補 → 判定確定 → Word 1種
                  ─[G0 縦切り貫通]─>
Phase B（拡張）  : AD2/DA2・全relation → RuleFlag 9種 → Communication
                  → 6成果物すべて → whosaid import → 保持・削除 → 監査
                  ─[許諾・権利の確認]─>
Phase C（参照DB）: 熟練ジャッジ解説の構造化
```

**Phase Aの間は、AD1とDA1だけを扱う。** AD2/DA2、RuleFlag、6成果物、whosaid import は
すべてPhase Bに置く。全機能の20%を作るのではなく、全工程を細く1本通すのが目的である。

---

## 実行場所の要約

クラウドセッションには **PostgreSQL 16 と Docker** が入っているため、
マイグレーション・RLS・トリガー・CHECK制約まで **Web版で完結する**。
実 Supabase には接続しない（`DEV_ENVIRONMENTS.md` §2）。

デスクトップ版が必要なのは3点だけ。

1. **実プロバイダのキーを使う処理** — P5・P8
2. **音を聞く／画面を見る確認** — G1・G3・G4・★G0
3. **実 Supabase の Storage・Auth の動作確認**

| PR | 実行場所 |
| --- | --- |
| P-1 | 執筆はどこでも／音声化はデスクトップ |
| P0・P1・P2・P4・P6・P9・P11・P12・P13 | **Web** |
| P3・P7・P10 | Web で実装 → **デスクトップで人の確認** |
| **P5・P8** | **デスクトップ / CI**（実キー） |
| **★G0** | **デスクトップ**（全工程を人が通す） |
| P14〜P20 | 原則 Web（P17・P19に人の確認あり） |
| P21（Phase C） | Web で実装 → デスクトップで素材の取り込み |

---

## 着手順（推奨）

```
P0（Web）─┬─> P1（Web）─> P2 ─> P3 ─> P4 ─> P5 ─> P6 ─> ...
          │
          └─> P-1 Gold Dataset（並行）───────────┘
                                          P6の着手までに完了させる
```

**P0 を先に置く。** 理由は三つ。

1. `check-no-real-data` が先に入っていないと、Gold Dataset を置いたときに
   実データ混入を検出する仕組みがない状態になる。
2. P0 は軽く、Web版が実際に使えるか（Postgres起動・セットアップスクリプトの5分制限・
   Playwrightでの再生位置アサート）を最初に確かめられる。
3. P-1 は原稿執筆と正解データ作成が主で、リポジトリの足場を必要としない。並行できる。

**P1 の受け入れテストには、手書きの小さな fixture を使う。**
Gold Dataset が必要になるのは P6（ステージ推定）からなので、
そこまでに P-1 が終わっていればよい。

---

## P-1（先行作業・実装ではない）Gold Dataset v01

**実行場所**: 執筆はどこでも／**音声化と試聴はデスクトップ**

**これを先に作る。** Phase A以降すべての受け入れテストの土台になる。手順は `ACCEPTANCE.md` §4。

- 成果物: `fixtures/gold-01/`（motion / speeches / violations / 音声 / 正解JSON / sha256）
- 反転版 `gold-01-mirror` を機械生成するスクリプトも同時に作る
- **合格条件**: 正解Flow・正解Judge Sheet・正解判定理由まで揃っていること。
  音声だけ作って正解を後回しにしない

---

# Phase A — 縦切り

## P0 リポジトリ雛形とCI

**実行場所**: **Web**

**読むもの**: `CLAUDE.md`, `BASIC_DESIGN_v04.md` 第4章, `DATA_MODEL.md` §0, `DEV_ENVIRONMENTS.md`

- Next.js（App Router）＋ TypeScript ＋ Zod ＋ Drizzle ORM の雛形
- `packages/core/`（UIに依存しない）と `app/` の分離
- **DB接続**: `postgres.js`。本番は Supavisor transaction mode（6543）で `prepare: false`、
  開発は**セッション内 PostgreSQL 16**（`DATABASE_URL` は `install_pkgs.sh` が生成する）
- **マイグレーション**: `drizzle-kit`。開発はセッション内Postgres、本番適用はGitHub Actionsから
- **ロール構成**: `app_migrator`（テーブル所有者）と `app_server`（`NOBYPASSRLS`・`GRANT`のみ）
- 全テーブルで `ENABLE ROW LEVEL SECURITY` ＋ `FORCE ROW LEVEL SECURITY`
- `.claude/settings.json`（SessionStartフック）と `scripts/install_pkgs.sh`
- `scripts/setup-cloud-env.sh`（クラウド環境ダイアログに貼る内容をリポジトリでも版管理）
- GitHub Actions: typecheck / lint / test / `generate-schemas` 差分 / `check-no-real-data`
- Vercel接続。Supabaseプロジェクト作成（東京 ap-northeast-1・**Data API無効**）

**受け入れ基準**
- CIが緑。空のアプリがVercelにデプロイされ、URLが開く
- **クラウドセッション内で `service postgresql start` → マイグレーション → RLSテストが通る**
- **テーブル所有者を接続ロールにすると、RLSテストが失敗することを確認する**
  （所有者はRLSを素通りするため。ここを確かめないとテストが空回りする）
- `check-no-real-data` が、テスト用ダミーの `.mp3` を検出して失敗する
- `.env.example` に環境変数が列挙されている
- **`prepare: false` が設定され、それを検証するテストがある**
- セットアップスクリプトが5分以内に終わり、環境キャッシュが作られる
- Playwrightで、メディア要素の `currentTime` が意図した位置に来ることをアサートできる

**やってはいけないこと**
- Supabase の Data API を有効にする
- `supabase-js` をDBアクセスに使う
- service role key をDBアクセスに使う
- **クラウドセッションから実 Supabase へ接続する**
- **クラウド環境の設定にシークレットを置く**

---

## P1 ruleset と Zodスキーマ

**実行場所**: **Web**

**読むもの**: `HENDA_RULESET.md`, `ARGUMENT_MODEL.md` §1・§2・§5, `BASIC_DESIGN_v05.md` 第13章

- `packages/core/src/ruleset/` に `henda-20`（12ステージ・担当者表・時間・定型句辞書・証拠要件）
- Zodで `Ruleset` / `Issue` / `ArgumentNode` / `FlowLink` / `JudgeRun` / `JudgeDecision`
- `scripts/generate-schemas.ts` で `schemas/*.json` を生成

**受け入れ基準**
- 12ステージ・担当者表・時間の一貫性がテストされる
- **壊したruleset（ステージ11個 / 時間合計が42分にならない / 担当者表に穴）でテストが失敗する**
- `schemas/` の再生成で差分ゼロ
- `winner` に引き分けを入れると型エラー
- `commPoints` に 0 / 0.5 / 6 を入れるとバリデーションエラー
- **`ArgumentNode.role` が4構成要素（`present`/`effect`/`importance`/`evidence`/`other`）になっている**
- **`effect_kind` の語彙が `ARGUMENT_MODEL.md` §2 と一致している**
- **`ComparisonAxis` で、`source='debater'` かつ `segmentIds` が空だと失敗する**（M26）

**やってはいけないこと**
- 大会ルールの本文をコードに埋め込む（条項番号と要約で参照する）
- 定型句辞書をハードコードする（rulesetの一部として外部定義する）

---

## P2 API基盤と試合登録

**実行場所**: **Web**（RLSはセッション内Postgresで検証）

**読むもの**: `API_SPEC.md` 全体, `DATA_MODEL.md` §0〜§2

- **`defineHandler` の実装**（JWT検証 → トランザクション → `SET LOCAL app.actor_id`
  → Zod検証 → `expectedVersion` 照合 → `Idempotency-Key` → エラー変換 → `edit_logs` 追記）
- `matches` / `match_members` / `match_access` のマイグレーションとRLSポリシー
- `POST/GET/PATCH /api/v1/matches`、`POST /consent`、`PUT /members`
- 画面A（試合登録）

**受け入れ基準**
- `expectedVersion` を省略した更新が `400` で拒否される
- 不一致で `409 VERSION_CONFLICT`、`details.currentVersion` が返る
- **他人のmatchにアクセスすると、RLSレベルで見えない**（アプリの分岐だけで守らない）
- `consent_recorded_at` が null のまま解析を開始しようとすると `409 CONSENT_REQUIRED`
- `team_size`（3 or 4）に応じて担当者表が切り替わる
- 全ての変更が `edit_logs` に記録される

**やってはいけないこと**
- 素の `route.ts` を直接書く（`defineHandler` を通さない経路を作る）
- `SET LOCAL app.actor_id` を発行しないクエリ経路を作る

---

## P3 メディア取り込み

**実行場所**: Web で実装 → **デスクトップ／実 Supabase で G1**

**読むもの**: `TRANSCRIPTION.md` §7, `API_SPEC.md` §2, `DATA_MODEL.md` §3

- **TUS resumable upload（大きさによらず常に）**。直接ストレージホスト（`TRANSCRIPTION.md` §7.3）
- Web CryptoでSHA-256を計算し、**intent の前に**サーバへ渡す（保存パスに sha256 が要るため）
- `POST /media/upload-intent` → ブラウザから直接アップロード → `POST /media` で登録
- `GET /media/{id}/playback-url`（既定15分）
- 画面B（メディア取り込み）

**受け入れ基準（機械検証・CIで自動）**
- `M27` 保存パスが sha256 と mime から決まる（`filename` を使わない）
- `M28` 登録の3分岐（`created` / `already_exists` / `restored`）と、並行INSERTの23505捕捉
- `M29` `upsert` はサーバが `purged_at` で決める（リクエストから受け取らない）
- `M30` 非メンバーは404、`viewer` の書き込みは403
- `M31` `playback-url` の `matchIdFrom` が効いている
- `M32` `media_sources` のRLS（アプリの分岐を外しても他人のものが見えない）
- `M33` mime enum外／`byteSize` 50MB超を400で拒否
- `M34` SHA-256 の計算
- `M35` `@supabase/supabase-js` の import 元が storage / auth に限られている（静的検査）

**人の確認待ち（実 Supabase が要る）** → **G1**
- `H1` 任意の時刻へシークして、その位置の音が鳴るか（10箇所）
- `H9` 署名トークンでアップロードできるか（署名がバケットのポリシーを迂回するか）
- `H10` 署名URLが期限切れ後にアクセスできない
- `H11` ファイル本体がAPIサーバを通過していない（ネットワークログで確認）

**先に人へ依頼すること**: バケット `media` の作成（非公開・50MB上限・許可mime 4値）。
手順は `TRANSCRIPTION.md` §7.3。**Storage 層を書き終えた時点で依頼する。**
画面Bまで進んでから「バケットがないと動かない」となると、そこで止まる。

**やってはいけないこと**
- サーバにffmpegを入れる
- 署名URLをDBに保存する
- **区間再生UIを作る**（`TRANSCRIPTION.md` §7.2 は P10 のもの。P3 には区間の元データが無い）
- **50MBの音声を `fixtures/` に置く**（`check-no-real-data` の上限は5MBのまま。
  CIで使う音声は実行時に生成する。50MBを実際に流す確認は H1 の側で行う）

---

## P4 ジョブ基盤（stub provider）

**実行場所**: **Web**

**読むもの**: `TRANSCRIPTION.md` §6, `API_SPEC.md` §3, `DATA_MODEL.md` §4

- `transcription_jobs` のマイグレーション
- 状態遷移、冪等キー、楽観ロック、部分再実行
- 実行契機: クライアントのポーリング ＋ Vercel Cron（両方）
- ネットワークを使わない stub provider

**受け入れ基準**
- `queued → running → succeeded` が遷移する
- **同じ `Idempotency-Key` / 同じ冪等キーで二度実行しても結果が変わらない**
- 失敗ジョブだけを再実行でき、他のジョブに影響しない
- `metrics` に所要時間が記録される
- `consent` 未記録のmatchではジョブを作成できない

**やってはいけないこと**
- 進捗をメモリ上だけで持つ
- 失敗時に人手の確認結果ごとリセットする

---

## P5 Pass A（実provider接続）

**実行場所**: **デスクトップ / CI**（実キーが要る）

**読むもの**: `TRANSCRIPTION.md` §2, §5

- `AlignProvider` の実装（1つ）と `align_words` への保存
- 契約テスト（stubと実providerで同じ形が返る）

**受け入れ基準**
- 42分の音声から単語時刻が取れる
- 所要時間と実トークン量／コストが `metrics` に記録される
- 契約テストが緑

**人の確認待ち**: 実音声1本での動作

---

## P6 Pass S（ステージ推定）

**実行場所**: **Web**

**読むもの**: `HENDA_RULESET.md` §8, `TRANSCRIPTION.md` §1

- 定型句 ＋ 公式時間 ＋ 名乗り検出の3信号（純粋計算）

**受け入れ基準**
- Gold Datasetで**境界誤差2秒以内、ステージ誤分類ゼロ**
- **質疑の文言重複（②/⑧、④/⑥）を、直前ステージと経過時間で正しく判別する**
  ← 取り違えるとフロー全体が1ステージずれる。専用テストを必ず書く
- 定型句が一部欠けている入力でも、時間制約から候補を出す

**やってはいけないこと**
- 時間だけで境界を決める / 定型句だけで質疑ステージを判別する

---

## P7 ステージ確認UI

**実行場所**: Web で実装 → **デスクトップで G3**

**読むもの**: `HENDA_RULESET.md` §2, `API_SPEC.md` §4, `REVIEW_SEMANTICS.md` §1

- 画面C: 波形＋定型句ヒット位置＋12境界のドラッグ調整
- `PUT /stages`（`confirm: true` を書ける唯一の経路）

**受け入れ基準**
- 確定で `stage_segments` が12行できる
- 区間の重なり・順序逆転が拒否される
- **`seat` がサーバで担当者表から導出される（リクエストで受け取らない）**
- 人が確認すると `human_confirmed`。**自動では絶対にならない**

**人の確認待ち（H2）**: 実試合1本で12境界すべてを実音確認 → **G3**

---

## P8 Pass B（ステージ単位逐語）

**実行場所**: **デスクトップ / CI**（実キー＋実音声）

**読むもの**: `TRANSCRIPTION.md` §3, `REVIEW_SEMANTICS.md` §5

- `StageTranscribeProvider`。音声はFiles APIへ1回だけ上げ、file URIを使い回す
- ステージごとにMM:SS範囲を指定して転写（12ジョブ）

**受け入れ基準**
- 12ステージそれぞれの逐語が取れる
- **1ステージだけ再実行できる**
- **ステージ未確定で起動すると `409 STAGES_NOT_CONFIRMED`**
- **コンテキストキャッシュが効いていることを `metrics` で確認できる**
- 沈黙区間が `is_silence` として保持される

**人の確認待ち（H4）**: フィラー・言い直し・沈黙が残っているか → **G4**

**やってはいけないこと**
- 音声をステージごとに切り出す（ffmpegが要るようになる）
- 相づち・フィラーを整形して消す

---

## P9 Pass C（アンカー照合・TS移植）

**実行場所**: **Web**（音声不要のfixtureで完結）

**読むもの**: `TRANSCRIPTION.md` §4

- whosaid-editor `anchor.py` をTypeScriptへ移植（**MIT表記を残す**）

**受け入れ基準**
- **テキストと単語時刻のfixtureだけでテストが完結する**（音声不要）
- 時刻誤差 中央値0.5秒以内 → **G2**
- **被覆率0.6未満なら時刻を書き換えない**（`time_status` は `unverified` のまま）
- 窓の外の同じ語句に誤マッチしないことをテストで確認する

**やってはいけないこと**
- 全文どうしの差分照合 / 線形補間で時刻を埋める / それらしい時刻で埋める

---

## P10 Transcript Review UI

**実行場所**: Web で実装 → **デスクトップで確認**

**読むもの**: `REVIEW_SEMANTICS.md` 全体, `API_SPEC.md` §5, `TRANSCRIPTION.md` §7.2

- 画面D: 左=区間一覧 / 中央=本文 / 右=再生・audibility・時刻確認
- 4軸の状態表示。Judge View と 解析View の切替
- **`TRANSCRIPTION.md` §7.2 の区間再生仕様（前1.0秒/後0.5秒、キーボード操作、
  再生速度、「5秒前から」「この先30秒」）は、ここで実装する。**
  P3 の画面Bには区間の元データが無いため、先に作らない

**受け入れ基準**
- 本文を直すと `text_human` に入り `text_status = human_edited`
- **`audibility` を人が設定できる。AIは設定できない**（DBのCHECKで担保）
- **`unknown` へ戻すAPIが存在しない**
- Judge Viewで `unheard` の本文が表示されない
- Judge Viewで `unknown` に「未確認」が表示される（本文は隠さない）
- **再解析後も `human_*` の件数が減らない**

**人の確認待ち（H1, H3）**: 再生位置とaudibility判断

---

## P11 Flow最小（AD1 / DA1のみ）

**実行場所**: **Web**

**読むもの**: `JUDGE_LOGIC.md` §2, §4, `API_SPEC.md` §6, `DATA_MODEL.md` §6

- `issues` / `argument_nodes` / `node_segments` / `flow_links`
- **扱うのは AD1 と DA1 のみ。relation は `ATTACKS` / `DEFENDS` / `EXTENDS` のみ**
- 画面E（最小）: 公式Flow Sheet型ボード、カード、矢印
- AI抽出（`flow_runs`）→ **必ず `suggested` で保存**

**受け入れ基準**
- **`argument_nodes` を `node_segments` 0件で作れない**（API `422` ＋ DB遅延制約）
- `label` と `id` を**サーバが割り当てる**
- **LLMの応答スキーマに `id` / `label` / `reviewStatus` が含まれていない**
- relationの方向違反（`ATTACK → ATTACK` など）が `422` で拒否される
- `reviewStatus` を書けるのが `/review` エンドポイントだけである
- **`effectiveness_human` をジョブ・解析経路から書けない**（DBのCHECKで担保・M23）
- **`effectiveness` の人の入力が任意である**（未入力でも先へ進める）
- **解析画面のコンポーネントが `display_name` を参照していない**（M24）
- `debate_evolution` が、fixtureに対して期待どおりの時系列を返す

---

## P12 Judge最小と判定ロック

**実行場所**: **Web**

**読むもの**: `JUDGE_LOGIC.md` 全体（特に §5）, `API_SPEC.md` §7

- `judge_runs` / `judge_issue_assessments` / `judge_decisions` / `judge_decision_assessments`
- 画面F（最小）: Decision Chart（AD1/DA1）、Voting Issue、Communication、確定とロック
- 集計（AD合計 vs DA合計）は**サーバで計算**

**受け入れ基準**
- `Hi/Lo`・`Large/Small`・`Strong/Weak/None` が数値へ置換されていない
- `winner` に引き分けを入れられない
- **`audibility = unknown` が根拠segmentに残っていると `409 AUDIBILITY_UNRESOLVED`**
  → `details.pendingSegmentIds` が返り、UIがそこへジャンプできる
- `locked_at` が入ると以後変更できない（`409 DECISION_LOCKED`）
- `judge_decisions` が `judge_runs` を上書きしない
- **AFF/NEGを入れ替えた入力で判定が対称に反転する**（`gold-01-mirror`）
- Best Debater の候補をAIが出していない
- **判定の集計コードが `effectiveness` / `comparison` を参照していない**（静的検査・M22）

**人の確認待ち（H5）**: HEnDA経験者2名の承認 → **G6**

---

## P13 判定理由メモのWord出力

**実行場所**: **Web**

**読むもの**: `JUDGE_LOGIC.md` §6, §9

- `docx`（npm）で **判定理由メモ 1種だけ** を出力する
- `POST /exports`（`Idempotency-Key`）、`locked` 済みの判定からのみ

**受け入れ基準**
- **根拠なし段落ゼロ**（各段落が最低1つの `transcript_segment_id` を参照）
- 判定理由とアドバイスが別欄に分かれている
- Judge View外を根拠にした段落に、その旨が明示される
- 未ロックの判定から出力しようとすると拒否される
- **同じ判定＋同じテンプレート版から2回生成して差分ゼロ** → **G7（Phase A分）**

**やってはいけないこと**
- サーバでPDF化する
- 公式様式の画像・PDFを同梱する

---

## ★ G0 縦切り貫通ゲート

**実行場所**: **デスクトップ**（全工程を人が通す）

**合成試合1本が、取り込みからWord出力まで最後まで通ること。**

確認項目:
1. `gold-01.mp3` を取り込み、12ステージを確定できる
2. Transcriptを人がレビューし、`audibility` を全区間に設定できる
3. AD1 と DA1 を作り、Attack / Defense を矢印でつなげる
4. Decision Chartを埋め、Voting Issueを選び、**ロックできる**
5. 判定理由メモのWordが出る
6. 同じ判定からもう一度出して差分ゼロ

**ここを通るまでPhase Bへ進まない。**
通ったら、実試合1本で同じ流れを人が試す（G3 / G4 / G6 の実試合分）。

---

# Phase B — 拡張

## P14 AD2 / DA2 と 全relation

**実行場所**: **Web**

- Issueを片側2件まで扱う。`COMPARES` / `QUESTIONS` / `ANSWERS` / `CITES` / `DROPS` を追加
- 質疑ノード（`QUESTION` / `ANSWER`）とフローシートの細いQ&A列

**受け入れ基準**: 片側3件目のIssueが `422 ISSUE_LIMIT_EXCEEDED`。`DROPS` が導出され `suggested` で出る

---

## P15 RuleFlag 9種

**実行場所**: **Web**

**読むもの**: `HENDA_RULESET.md` §3, `JUDGE_LOGIC.md` §3

**受け入れ基準**
- Gold Datasetに仕込んだ違反を検出。**Recall 0.9以上**
- **`candidate` のフラグが集計に影響しない**
- 人が `confirmed` にして初めて対象ノードが `excluded` になれる
- `rationale` に根拠発言の時刻が含まれる
- New Argument の説明文が断定形になっていない
- **`candidate` が残っていると判定をロックできない**

---

## P16 Communication と 語数・速度

**実行場所**: **Web**

- `over_word_limit` / `over_speech_rate` の算出と表示
- Communication Points の減点事由入力欄（**人が入力。AIは提案しない**）

**受け入れ基準**: 勝敗の計算に一切入らないことをテストで確認する

---

## P17 6成果物すべて

**実行場所**: Web で実装 → **デスクトップで印刷確認**

- Flow Sheet / Judge Sheet（公式版・拡張版）/ 試合解説レポート / 検証履歴 を追加

**受け入れ基準**: 6成果物すべてで根拠なし段落ゼロ

**人の確認待ち（H6, H7）**: 教材としての妥当性、公式版の印刷崩れ

---

## P17.5 HP View（学習/観戦用）

**実行場所**: **Web**

**読むもの**: `ARGUMENT_MODEL.md` §7

- `debate_evolution` の `effectiveness` から AD1/AD2/DA1/DA2 のバーを描く
- 4構成要素ごとの状態（残っている／弱化→一部回復／Strong など）を併記

**受け入れ基準**
- **画面に常に「AI推定」と表示される**
- **判定の集計コードがHPモジュールを import していない**（静的検査・M25）
- **HPから判定を計算する経路が存在しない**（逆方向も検査）
- 音声・判定を削除した試合でも、残っているデータの範囲で描画が壊れない

**やってはいけないこと**
- 確定した判定からHPを計算する
- HPを公式の得点のように見せる

---

## P18 whosaid-editor インポート

**実行場所**: **Web**

**読むもの**: `REVIEW_SEMANTICS.md` §4

**受け入れ基準**
- `reviewed: true` → `human_confirmed`、`time_reviewed: true` → `human_verified` に写る
- `text_edited: true` の本文が `text_human` に入る
- **schema 5 以外を `422 UNSUPPORTED_IMPORT_SCHEMA` で拒否**
- `speakers[]` の座席対応づけを人が行う画面がある（自動でやらない）
- 取り込んだ `human_*` が再解析で上書きされない

---

## P19 保持レベルと削除

**実行場所**: Web で実装 → **デスクトップで削除後の見え方を確認**

**読むもの**: `PRIVACY_RETENTION.md`

- `match_retention_policies` / `retention_events`
- `PUT /retention`、`POST /purge`、Vercel Cronでの期限実行
- `redact_edit_logs`（`SECURITY DEFINER`）

**受け入れ基準**
- A→B→C→D の順にしか消せない（順序違反をトリガが拒否）
- **B削除後も、フローと判定の閲覧・Word出力（構造のみ）ができる**
- **`edit_logs` の `before`/`after` から本文と氏名が消える**
- 削除が途中で失敗したらロールバックされ、半分消えた状態にならない
- 削除済みの層をUIが「削除済み」と明示する（空欄にしない）

---

## P20 履歴・再現・監査

**実行場所**: **Web**

**受け入れ基準**
- `export_runs` から同じ資料が再生成でき、差分ゼロ → **G7（全体）**
- `edit_logs` に UPDATE / DELETE を打つとDBが拒否する（`redact_edit_logs` を除く）
- 「いつ、どの音声、どのモデル、どのルール、どの人間確認を基に、この判定資料ができたか」が
  1本の履歴として追える

---

# Phase C — 熟練ジャッジ参照DB

## P21 参照DBの基盤

**実行場所**: Web で実装 → **デスクトップで素材の取り込み**

**読むもの**: `ARGUMENT_MODEL.md` §8, `PRIVACY_RETENTION.md`

**着手前に満たすべき前提**（これが揃うまで実装しない）

1. 大会映像・音声の権利者の確認（主催者・学校・出場者）
2. 解説している熟練ジャッジ本人の許諾（コメントは個人情報であり著作物）
3. **参照データとして使うことへの明示的な同意。**
   通常の録画許諾に「AIの参照データにする」は含まれない
4. `consent_scope` に `expert_reference` を追加し、保持期限を決めておく

**内容**
- 熟練者コメントの文字起こしと、タイムコード・Flowへの結び付け
- Turning Point / Issue Evaluation / Attack-Defense評価 / Comparison / New Argument判断 / Advice

**受け入れ基準**
- `consent_scope = 'expert_reference'` の試合以外を取り込もうとすると拒否される
- 熟練者コメントが `judge_decisions` を上書きしない（**参照例であって正解ではない**）
- **複数ジャッジで見解が分かれた場合、その差が保存される**
- Advice が判定理由とは別枠に入る

**やってはいけないこと**
- 熟練者の判定を「正解」として Winner一致率の最適化に使う
  （`ACCEPTANCE.md` §3.1。**Phase C でこそ効く規則**）
- 通常の録画許諾しかない試合を取り込む

---

## 順序とゲート

```
P-1 ─> P0 ─> P1 ─> P2 ─> P3 ─[G1]─> P4 ─> P5 ─> P6 ─> P7 ─[G3]─> P8 ─[G4]─> P9 ─[G2]─┐
                                                                                        │
    ┌───────────────────────────────────────────────────────────────────────────────────┘
    └─> P10 ─> P11 ─> P12 ─[G6]─> P13 ─[G7a]─> ★G0 縦切り貫通 ──> Phase B
                                                                    │
    ┌───────────────────────────────────────────────────────────────┘
    └─> P14 ─[G5]─> P15 ─> P16 ─> P17 ─> P17.5 ─> P18 ─> P19 ─> P20 ─[G7]─> v1.0
                                                                        │
                                              ┌─────────────────────────┘
                                              └─> [許諾・権利の確認] ─> P21（Phase C）
```

ゲートの内容は `ACCEPTANCE.md` §3。
**ゲートは人の承認を伴う。CIが緑になっただけでは通過しない。**
