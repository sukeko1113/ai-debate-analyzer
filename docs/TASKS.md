# TASKS.md — PR分割

## 進め方の規則

- **1 PR = 1縦切り。** 現在のPRの受け入れ基準を満たしたことを確認するまで、次へ進まない。
- 着手前に実装計画を提示し、承認を得てから手を動かす。
- ブランチ: `feature/pXX-短い名前` → PR → `main`。
- 各PRの「読むもの」に挙げた文書は、実装前に必ず読む。
- 「やってはいけないこと」は、動いていてもマージしない条件である。
- 人間検証が必要なPRは、CIが緑でも**「人の確認待ち」として報告する**（`ACCEPTANCE.md` §2.1）。
- 各PRに**実行場所**を書いてある。実キーが要るPRをクラウドセッションで走らせない。
  人の確認が要るPRを、テストが緑なだけで「動いた」と報告しない。
  使い分けの根拠は `DEV_ENVIRONMENTS.md`。

---

## 全体の形（v04で再構成・v09で範囲確定）

v03のP0〜P16は、実質「v1.0完成ロードマップ」だった。
v04では **Phase A で最終製品の全工程を細く1本通し**、そのあとPhase Bで太らせる。
v09 では Phase A の範囲を「**列とスキーマは4 Issue ぶん先行して入れ、機能は AD1/DA1 で★G0 を通してから広げる**」に確定した
（`BASIC_DESIGN_v09.md` §17.2）。本書は v09 §17 に追随している（2026-09-06）。

```
Phase A（縦切り）: 合成試合 → 音声取込 → ステージ確定 → 座席結び付け → Transcript
                  → AD1/DA1 の A/B/C ＋ Support Quality → clash_events（⑤⑦の Attack と ⑨⑩の Defense）
                  → Rule State → constructive_end snapshot → AI P/V/Strength と Net sum（AD1 vs DA1）
                  → Human Ballot（1人）→ 判定ロック → 判定理由メモの Word → 再生成で差分ゼロ
                  ─[G0 縦切り貫通]─> G8（実試合突き合わせ）
Phase B（拡張）  : AD2/DA2・全relation → counterfactual → Value turn Gate → Rule State Engine 全分岐（RuleFlag 15種）
                  → Communication → 7成果物すべて → HP → whosaid import → 保持・削除 → 監査 → パネル
                  ─[許諾・権利の確認]─>
Phase C（参照DB）: Calibration harness → 熟練ジャッジ解説の構造化 → ジャッジ間比較
```

**Phase A の間、機能は AD1 と DA1 だけを扱う。** ただしスキーマは Phase A 開始時（P1.5 / P11 / P12 のスキーマ先行 PR）に
4 Issue ぶん入れる：`scoring_config` / `criteria_catalog` / `argument_node_scores` / `clash_events` / `rule_state_table` /
`issue_snapshots` / `official_decision_support`、`argument_nodes.node_type` / `link_order`、`flow_links.effect_kind`（20値）、
`summary_links`、`stage_segments.coverage_status`、`match_events`、`transcript_segments.stage_no` NULL 可＋`event_id`、
`match_members` の座席結び付け3列、`judge_decisions` の `UNIQUE(match_id, decided_by)`＋`panel_size`、`consent_scope` 5値、
エラーコード4件。後から足すと DB・API・UI・prompt すべてが破壊的変更になるためである。

AD2/DA2 の機能（P14）、Voting Issue counterfactual（P12.2）、Value turn Review Gate（P12.3）、Rule State Engine の全分岐（P15）、
パネル UI（P22）、7成果物、whosaid import は**すべて★G0 の後**に置く。全機能の20%を作るのではなく、全工程を細く1本通すのが目的である。
AD1/DA1 だけでは counterfactual も Value turn Gate も Rule State の16状態も検証にならないが、縦切りの貫通そのものには要らない。

**Phase A での原則**（v09 §17.2）

- AI はカテゴリ候補を出すが、数値写像はサーバが行う
- Human Ballot は AI から独立して人が確定する
- Review Gate が発火する fixture を少なくとも1件含める（P12.3 で追加。G0 の条件ではない）
- `weakest_link` と `product` は両方計算可能にするが、初期表示は `weakest_link`
- 1試合の縦切りが完了するまで HP の見た目調整へ時間を使わない
- ★G0 の貫通条件は `ACCEPTANCE.md` §3.2 の6手順（AD1/DA1）のまま。4 Issue へ広げるのは G0 の後の P14

---

## 実行場所の要約

既定は**ローカル**（WSL2 上の Ubuntu ＋ `postgres:16` コンテナ）である。
マイグレーション・RLS・トリガー・CHECK制約まで手元の Postgres で検証できる。
クラウドセッション（Claude Code on the web）は補助で、セッション内の Postgres 16 で同じ検証ができるが、
**実キーを置けず、音も聞けない**。CI が唯一の判定者であることは変わらない
（`DEV_ENVIRONMENTS.md` §6・§9）。実 Supabase には接続しない（同 §4）。

PR ごとに違うのは「何を必要とするか」だけである。

1. **実キー**（`.env.local` か CI Secrets）— P5・P8。クラウドセッションでは走らせない
2. **人の耳・目** — G1・G3・G4・★G0。テストが緑でも「人の確認待ち」
3. **実 Supabase の Storage・Auth** — 人の手

| PR | 実行場所 |
| --- | --- |
| P-1 | 執筆はどこでも／音声化と試聴はローカル（人の耳） |
| P0・P3・P4・P4.5・P5・P8 | **開発機のローカル**（Docker 上の Postgres、実キー、TUS の実挙動が要る） |
| P1・P1.5・P2・P4.1・P4.2・P6・P9・P11・P11.5・P11.6・P12・P12.1・P12.4・P12.5・P13・P13.5 | **ローカル**（純粋計算とスキーマで完結。クラウドセッションでも可） |
| P7・P7.5・P7.6・P10 | ローカルで実装 → **人の確認** |
| **★G0** | **ローカル**（全工程を人が通す） |
| G8 | 実試合1本。CI の外で人が行う |
| P14〜P21・P12.2・P12.3・P17.6・P22・P23 | 原則ローカル（P17・P19 に人の確認あり） |
| P24.5・P21・P24（Phase C） | ローカルで実装 → 人の確認（素材の取り込み） |

---

## 着手順（推奨）

```
P0 ──┬─> P1 ─> P2 ─> P3 ─> P4 ─> P4.1 ─> P4.2 ─> P4.5 ─> P1.5 ─> P5 ─> P6 ─> P7 ─> P7.5 ─> P7.6 ─> P8 ─> ...
     │
     └─> P-1 Gold Dataset（並行）──────────────────────────────────────────────────┘
                                                                  P6の着手までに完了させる
```

P4.1（分割文書の v09 追随）と P4.2（スキーマ・Zod・テストの v09 追随）は P4 完了後に挿入した（`HANDOFF.md` 件40・件41）。
P1.5 は番号のとおり P1 の直後ではなく **P5 の直前**に置く。`TranscriptionProvider.capabilities` が P5 の provider 実装より先に要り、
scoring の Zod は P11 まで使われないためである（v09 改訂履歴 9）。

**P0 を先に置く。** 理由は三つ。

1. `check-no-real-data` が先に入っていないと、Gold Dataset を置いたときに
   実データ混入を検出する仕組みがない状態になる。
2. P0 は軽く、開発環境が実際に回るか（Docker 上の `postgres:16` 起動・マイグレーション・
   Playwrightでの再生位置アサート・CI から Supavisor へのスモークテスト）を最初に確かめられる。
3. P-1 は原稿執筆と正解データ作成が主で、リポジトリの足場を必要としない。並行できる。

**P1 の受け入れテストには、手書きの小さな fixture を使う。**
Gold Dataset が必要になるのは P6（ステージ推定）からなので、
そこまでに P-1 が終わっていればよい。

---

## P-1（先行作業・実装ではない）Gold Dataset v01

**実行場所**: 執筆はどこでも／**音声化と試聴はローカル（人の耳）**

**これを先に作る。** Phase A以降すべての受け入れテストの土台になる。手順は `ACCEPTANCE.md` §4。

- 成果物: `fixtures/gold-01/`（motion / speeches / violations / 音声 / 正解JSON / sha256）
- 反転版 `gold-01-mirror` を機械生成するスクリプトも同時に作る
- **合格条件**: 正解Flow・正解Judge Sheet・正解判定理由まで揃っていること。
  音声だけ作って正解を後回しにしない

---

# Phase A — 縦切り

## P0 リポジトリ雛形とCI

**実行場所**: **開発機のローカル**（Docker 上の Postgres が要る）。**完了。**

**読むもの**: `CLAUDE.md`, `BASIC_DESIGN_v09.md` 第4章・§17.6, `DATA_MODEL.md` §0, `DEV_ENVIRONMENTS.md`

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
- **ローカル（`postgres:16` コンテナ）で `install_pkgs.sh` → マイグレーション → RLSテストが通る**
  （クラウドセッションではセッション内 PostgreSQL 16 で同じことができる）
- **テーブル所有者を接続ロールにすると、RLSテストが失敗することを確認する**
  （所有者はRLSを素通りするため。ここを確かめないとテストが空回りする）
- `check-no-real-data` が、テスト用ダミーの `.mp3` を検出して失敗する
- `.env.example` に環境変数が列挙されている
- **`prepare: false` が設定され、それを検証するテストがある**（静的検査）
- **CI から Supavisor transaction mode（6543）へ実際に接続し、prepared statement を使う経路が失敗することを
  スモークテストで確かめる**（M17。CI の秘密情報を使うため、ローカルからは実行しない。v09 §17.6）
- **リポジトリ内の絶対パスと OS 固有パスを検出したら CI が失敗する**（M47。ローカル開発の再発防止）
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

**実行場所**: **ローカル**（クラウドセッションでも可）。**完了。**

**読むもの**: `HENDA_RULESET.md`, `ARGUMENT_MODEL.md` §1・§2・§5, `BASIC_DESIGN_v09.md` 第13章

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
  ← P1 時点の基準。v09 で `node_type`（A/B/C/OTHER）へ置き換わり、`ArgumentRole` → `NodeType` の一括書き換えは **P4.2**
- **`effect_kind` の語彙が `ARGUMENT_MODEL.md` §2 と一致している**（P1 時点は 9＋4 値。20値への拡張は P4.2）
- **`ComparisonAxis` で、`source='debater'` かつ `segmentIds` が空だと失敗する**（M26）

**やってはいけないこと**
- 大会ルールの本文をコードに埋め込む（条項番号と要約で参照する）
- 定型句辞書をハードコードする（rulesetの一部として外部定義する）

---

## P2 API基盤と試合登録

**実行場所**: **ローカル**（RLSは手元のPostgresで検証。クラウドセッションでも可）。**完了。**

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

**実行場所**: ローカルで実装 → **人の確認（実 Supabase で G1）**。**実装完了・G1 は人の確認待ち。**

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

## P4 ジョブ基盤（stub provider）— DB とドメインまで

**実行場所**: **開発機のローカル**（Docker 上の Postgres が要る）。**完了**（v09 で範囲を再定義。`HANDOFF.md` 件39 A）。

**読むもの**: `TRANSCRIPTION.md` §6, `DATA_MODEL.md` §4

- `transcription_jobs` のマイグレーション、状態遷移トリガ、RLS、システム actor（`public.system_actor_id()`）
- 状態遷移、冪等キー、楽観ロック、部分再実行（ドメイン。`packages/core/src/jobs/`）
- `schema/job.ts`（バレルと JSON Schema 生成への登録は P4.5）
- ネットワークを使わない stub provider

**受け入れ基準**
- `queued → running → succeeded` が遷移する
- **同じ冪等キーで二度実行しても結果が変わらない**（DB 側。`NULLS NOT DISTINCT`）
- 失敗ジョブだけを再実行でき、他のジョブに影響しない
- `metrics` に所要時間が記録される
- `consent` 未記録のmatchではジョブを作成できない
- 状態遷移の逆行を DB トリガが拒否する（M36）。他人のジョブが RLS で見えない（M40）。`sub` がシステム actor の JWT は 401（M41）

**やってはいけないこと**
- 進捗をメモリ上だけで持つ
- 失敗時に人手の確認結果ごとリセットする

**P4 に含まれないもの**: `API_SPEC.md` §3 の6本と実行契機（ポーリング／Vercel Cron）。これらは P4.5。

---

## P4.1 分割文書の v09 追随（文書のみ）

**実行場所**: どこでも。**完了**（2026-09-06。`HANDOFF.md` 件41）。

`BASIC_DESIGN_v09.md` を正本にした後、分割文書10本を v09 に合わせた。順序は v09 付録G「次の一手」2 のとおり
`DATA_MODEL` → `ARGUMENT_MODEL` → `JUDGE_LOGIC` → `API_SPEC` → `HENDA_RULESET` → `TRANSCRIPTION` →
`REVIEW_SEMANTICS` → `PRIVACY_RETENTION` → `ACCEPTANCE` → `TASKS`。コードは触らない。
テストが逐語で固定している表（`API_SPEC §0.5`、`ARGUMENT_MODEL §1・§2`、`HENDA_RULESET §3`）は P4.2 へ回し、
直前に【P4.2 で置換】の注記を置いた。

---

## P4.2 スキーマ・Zod・テストの v09 追随（スキーマ先行）

**実行場所**: **ローカル**（クラウドセッションでも可）

**読むもの**: `BASIC_DESIGN_v09.md` §13・§17.2, `HANDOFF.md` 件39〜41, `DATA_MODEL.md`, `ARGUMENT_MODEL.md` §1〜§2, `HENDA_RULESET.md` §3・§8

既に Zod / DB にあって v09 と食い違う語彙を**一括で**書き換える。新設テーブル群（`clash_events` 等）は含めない（P1.5 / P11 / P12）。

- `ArgumentRole`（5値）→ `NodeType`（4値）＋ `linkOrder`。`ATTACK_TARGET_ROLE` → `ATTACK_TARGET_NODE_TYPE`。`legacy_role` は作らない
- `AttackEffectKind` 11値・`DefendEffectKind` 7値・`AnswerEffectKind` 2値、`EffectKind` は3者の和（20値）。ANSWERS では任意
- `FlowLink.comparison` → `SummaryLink`
- `RuleFlagType` 15値（v07 の5値＋`dropped`）
- `ChairCueKind` に `self_introduction`。`henda-20.json` に自己紹介ラウンドのエントリ
- `ConsentScope` 5値（`expert_reference`）と `drizzle/0001` の CHECK
- `ERROR_STATUS` に `UNHEARD_CITED` / `GAPPED_STAGE_CITED` / `BALLOT_DUPLICATE` / `NON_STAGE_SEGMENT_CITED`
- `packages/core/src/schema/*.ts` と `ruleset/schema.ts` のヘッダコメント（`BASIC_DESIGN_v05 §13.x` → v09）、`flow.ts` の「4構成要素」「role」のコメント
- **テストを同時に直す**: `flow.test.ts` / `http-errors.test.ts` / `ruleset.test.ts`。**文書の表（P4.1 で注記した箇所）もこのとき書き換える**
- 既存マイグレーションは書き換えず、新しいマイグレーションで CHECK を差し替える

**受け入れ基準**
- `npm run test:unit` / `test:db` / `typecheck` / `lint` が緑
- `npm run generate-schemas` で差分ゼロ
- `flow.test.ts` の語彙テストが `ARGUMENT_MODEL.md` §1・§2 と `HENDA_RULESET.md` §3 の**書き換え後の表**と一致する
- `http-errors.test.ts` の `SPEC` が `API_SPEC.md` §0.5 の22件と一致する
- `docs/*.md` に【P4.2 で置換】の注記が残っていない

**やってはいけないこと**
- 語彙を散発的に足す（`CLAUDE.md`「スキーマの破壊的変更は一括で行う」）
- 新設テーブル（L1 / L2 / L3）をここで足す

---

## P4.5 ジョブ API（v09 で新設）

**実行場所**: **開発機のローカル**（Docker 上の Postgres が要る）

**読むもの**: `API_SPEC.md` §0・§3・§11, `TRANSCRIPTION.md` §6, `DATA_MODEL.md` §4, `HANDOFF.md` 件36〜37

- `API_SPEC.md` §3 の6本（`POST/GET /matches/{id}/jobs`、`POST /jobs/{id}/retry`、`POST /jobs/{id}/cancel`、
  `POST /matches/{id}/jobs/run`、`POST /internal/jobs/run`）を `defineHandler` 経由で通す
- `schema/job.ts` をバレル（`schema/index.ts`）と `scripts/generate-schemas.ts` に登録する
- 実行契機: クライアントのポーリング ＋ Vercel Cron（両方。`API_SPEC.md` §3.1）

**受け入れ基準**
- **同じ `Idempotency-Key` での `POST /jobs` 再送が 200 ＋ `Idempotent-Replay: true`、行が増えない**（M37）
- 他人のジョブへの `retry` / `cancel` が 404（M39）。`matchIdFrom` を渡している
- `failed` 以外への `retry` が `409 JOB_ALREADY_RUNNING`、終了状態への `cancel` が `409 VERSION_CONFLICT`
- `X-Job-Secret` / `Authorization: Bearer $JOB_CRON_SECRET` の照合。JWT では通らない。`sub` がシステム actor の JWT は 401（M41）
- `GET /jobs` に副作用が無い
- `schemas/job*.json` が生成され、差分ゼロ

**やってはいけないこと**
- 秘密（`JOB_CRON_SECRET`）をクライアントへ出す
- `GET /jobs` に実行の副作用を持たせる

---

## P1.5 scoring schema / config（列挙型と L2/L3 の Zod）

**実行場所**: **ローカル**（クラウドセッションでも可）。**P5 の直前に置く**（番号は v09 §17.3 のまま）。

**読むもの**: `BASIC_DESIGN_v09.md` §13.4・§12.1, `DATA_MODEL.md` §6.5・§7・§7.5, `TRANSCRIPTION.md` §5, `JUDGE_LOGIC.md` §1.1・§3.3

- `packages/core/src/schema/common.ts`（`MatchEventKind` / `CoverageStatus` / `NameSource` / `SeatBindingStatus`）、
  `scoring.ts`（L2。`RuleState` 16値、`ClashEvent`、`ArgumentNodeScore`、`IssueSnapshot`、`RuleStateTableEntry`、`CriteriaCatalogEntry`）、
  `learning.ts`（L3。`HpLedgerEntry`、`DeliveryScore`）、`decision-support.ts`（L1。`ScoringConfig`、`DecisionSupport`、`ReviewReasonCode` 6値）
- 依存方向は `flow → scoring → decision-support`。`judge` → `decision-support` は read only。`learning` はどちらからも import されない
- `scoring_config` / `criteria_catalog` / `rule_state_table` のマイグレーションと初期 config（版 `v0-pilot`）
- `StageTranscribeProvider.capabilities: { contextCache: boolean }` を provider.ts と stub に足す

**受け入れ基準**
- `Strength = P × V`、`RuleState` 全16値、`scoring_config` の版が Zod と DB で一致する
- `ClashEvent` / `ArgumentNodeScore` / `DecisionSupport` の refine が壊した fixture で落ちる（`REVIEW_REQUIRED` ⇔ `reviewReasons`、`attackSubtype` は `NO_EFFECT` のみ、等）
- `judge` から `scoring` への import が無い。`learning` を判定側が import していない（M25）
- `schemas/` の再生成で差分ゼロ

---

## P5 Pass A（実provider接続）

**実行場所**: **開発機のローカル（実キー）/ CI**。クラウドセッションでは走らせない

**読むもの**: `TRANSCRIPTION.md` §2, §5

- `AlignProvider` の実装（1つ）と `align_words` への保存
- 契約テスト（stubと実providerで同じ形が返る）

**受け入れ基準**
- 42分の音声から単語時刻が取れる
- **単語境界の誤差が合成 fixture で中央値 0.3 秒以内・95 パーセンタイル 1.0 秒以内**（M46）
- **provider が話者ラベルを返しても保存しない。`align_words` に `speaker` 列が無い**（M53）
- 所要時間と実トークン量／コストが `metrics` に記録される
- 契約テストが緑。`capabilities` を宣言している

**人の確認待ち**: 実音声1本での動作

---

## P6 Pass S（ステージ推定）

**実行場所**: **ローカル**（クラウドセッションでも可）

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

**実行場所**: ローカルで実装 → **人の確認（G3）**

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

## P7.5 自己紹介ラウンドと座席結び付け（画面C2）

**実行場所**: ローカルで実装 → **人の確認（H13）**

**読むもの**: `HENDA_RULESET.md` §1.1・§2.1, `TRANSCRIPTION.md` §8, `DATA_MODEL.md` §2・§5, `REVIEW_SEMANTICS.md` §6.1, `PRIVACY_RETENTION.md` §3

- `match_events`（3値）と `transcript_segments.stage_no` NULL 可＋`event_id`（CHECK）のマイグレーション。
  `stage_no` NULL 行の一意性（`UNIQUE NULLS NOT DISTINCT` か `(match_id, event_id, idx)` か）をここで比較して確定する（`HANDOFF.md` 件41）
- `match_members` の `intro_segment_id` / `name_source` / `seat_binding_status`
- 画面C2: 自己紹介の名乗り区間と A1〜N4 の対応、担当宣言との突き合わせ、名簿との照合
- `henda-20.json` の `self_introduction` エントリ（P4.2 で追加済み）を Pass S が境界に使う

**受け入れ基準**
- `stage_no` が NULL の区間は `event_id` を持つ。両方 NULL / 両方非 NULL は DB の CHECK で失敗（M48）
- 12ステージ外の区間を判定根拠に引くと `422 NON_STAGE_SEGMENT_CITED`（M49）
- 名乗り区間が未特定のまま `human_confirmed` にすると `400 VALIDATION_FAILED`（M54）。**自動では絶対に `human_confirmed` にならない**
- 各スピーチ冒頭の名乗りと担当者表の検算で矛盾があれば `speaker_role_mismatch` が立つ
- `is_self_introduction` が開会の名乗りとスピーチ冒頭の名乗りの両方に立つ

**人の確認待ち（H13）**: 8名の座席が矛盾なく決まるか

**やってはいけないこと**
- provider の話者ラベルを座席の結び付けに使う
- 名乗りが聞き取れないスピーカーの `display_name` を推測で埋める

---

## P7.6 ステージ長の妥当性検査と欠損の記録

**実行場所**: ローカルで実装 → **人の確認（H12）**

**読むもの**: `HENDA_RULESET.md` §1.2, `TRANSCRIPTION.md` §8.2, `DATA_MODEL.md` §5, `JUDGE_LOGIC.md` §4.1

- `stage_segments.coverage_status` / `coverage_note` のマイグレーション
- ステージ長の4検査（規定時間の2倍超・1/3未満・単一 segment 超過・合計差3分超）→ `stage_duration_anomaly` / `segment_duration_anomaly`
- 画面Cにステージ長の警告と欠損の記録（`missing` にできるのは人だけ）

**受け入れ基準**
- 規定時間の2倍を超えるステージで `stage_duration_anomaly`、規定時間を超える単一 segment で `segment_duration_anomaly` が立つ（M52）
- `coverage_status` を `missing` にできるのは人の操作だけ。ジョブ・解析経路からは書けない
- このフラグが判定に入らない

**人の確認待ち（H12）**: 「記録が無い」「聞き取れなかった」「応答しなかった」が画面上で別物として見えるか

---

## P8 Pass B（ステージ単位逐語）

**実行場所**: **ローカル（実キー）/ CI**（実音声も要る）。クラウドセッションでは走らせない

**読むもの**: `TRANSCRIPTION.md` §3, `REVIEW_SEMANTICS.md` §5

- `StageTranscribeProvider`。音声はFiles APIへ1回だけ上げ、file URIを使い回す
- ステージごとにMM:SS範囲を指定して転写（12ジョブ）

**受け入れ基準**
- 12ステージそれぞれの逐語が取れる
- **1ステージだけ再実行できる**
- **ステージ未確定で起動すると `409 STAGES_NOT_CONFIRMED`**
- **provider が `capabilities.contextCache = true` を宣言している場合に限り**、キャッシュが効いていることを `metrics` で確認できる
  （`TRANSCRIPTION.md` §3.1・§5。宣言が false の provider には要求しない）
- 沈黙区間が `is_silence` として保持される
- 12ステージ外の区間（自己紹介・アナウンス）も逐語で転写され、`event_id` を持つ segment として保存される

**人の確認待ち（H4）**: フィラー・言い直し・沈黙が残っているか → **G4**

**やってはいけないこと**
- 音声をステージごとに切り出す（ffmpegが要るようになる）
- 相づち・フィラーを整形して消す

---

## P9 Pass C（アンカー照合・TS移植）

**実行場所**: **ローカル**（音声不要のfixtureで完結。クラウドセッションでも可）

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

**実行場所**: ローカルで実装 → **人の確認**

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

## P11 Flow基盤（列は4 Issue、機能は AD1 / DA1）

**実行場所**: **ローカル**（クラウドセッションでも可）

**読むもの**: `JUDGE_LOGIC.md` §2, §4, `API_SPEC.md` §6, `DATA_MODEL.md` §6, `ARGUMENT_MODEL.md` §1〜§3

- `issues` / `argument_nodes`（`node_type` / `link_order`）/ `node_segments` / `evidence_refs` / `flow_links`（`effect_kind` 20値）/
  `summary_links` / `rule_flags`（15値）/ `flow_runs` のマイグレーション。**列は4 Issue ぶん先に入れる**
- **機能で扱うのは AD1 と DA1 のみ。relation は `ATTACKS` / `DEFENDS` / `EXTENDS` のみ**
- 画面E（最小）: 公式Flow Sheet型ボード、カード（A/B/C）、矢印
- AI抽出（`flow_runs`）→ **必ず `suggested` で保存**
- `judge_flow_links` ビュー

**受け入れ基準**
- **`argument_nodes` を `node_segments` 0件で作れない**（API `422` ＋ DB遅延制約・M21）
- `label` と `id` を**サーバが割り当てる**
- **LLMの応答スキーマに `id` / `label` / `reviewStatus` が含まれていない**（M12）
- relationの方向違反（`ATTACK → ATTACK` など）が `422` で拒否される
- **`DEFENDS` に `no_link`、`COMPARES` に `effect_kind` を付けると CHECK と `422` で拒否される**（M45）
- `link_order` を持てるのが `B_LINK` だけである
- `reviewStatus` を書けるのが `/review` エンドポイントだけである
- **`effectiveness_human` をジョブ・解析経路から書けない**（DBのCHECKで担保・M23）
- **`effectiveness` の人の入力が任意である**（未入力でも先へ進める）
- **解析画面のコンポーネントが `display_name` を参照していない**（M24）
- 判定の集計コードが `judge_flow_links` 以外を読んでいない（M22）

---

## P11.5 A/B/C ＋ Support Quality score（AD1/DA1 の範囲）

**実行場所**: **ローカル**（クラウドセッションでも可）

**読むもの**: `ARGUMENT_MODEL.md` §1・§10, `JUDGE_LOGIC.md` §1.1, `DATA_MODEL.md` §6.5

- `argument_node_scores` / `issue_snapshots` のマイグレーション（append-only）
- AI が A/B ノードの level 0〜4 と Support Quality タグと根拠を出し、サーバが `scoring_config.node_map` で `value` へ写す
- `constructive_end`（③終了時点）の snapshot 保存
- `POST /matches/{id}/scoring/run`（ジョブ）

**受け入れ基準**
- level 0〜4 と `value` の対応が `scoring_config` の版に従う。LLM の応答に小数が無い
- 証拠を確認できないとき level を下げず `evidence_status = unverifiable` になる
- `constructive_end` snapshot が保存され、後の再解析で上書きされない
- `impact_direction` を持てるのが `C_IMPACT` だけである

**人の確認待ち（H5 の一部）**: HEnDA経験者による level の妥当性

---

## P11.6 clash_events / Rule State（AD1/DA1 の範囲）

**実行場所**: **ローカル**（クラウドセッションでも可）

**読むもの**: `ARGUMENT_MODEL.md` §2.4・§10, `JUDGE_LOGIC.md` §3.3, `HENDA_RULESET.md` §3.2・§5, `API_SPEC.md` §12

- `clash_events` のマイグレーションと `POST /clash-events/{id}/review`、`POST /matches/{id}/rule-state/rebuild`
- ⑤⑦の Attack と ⑨⑩の Defense を `clash_events` へ登録。`effect_kind` → `attack_type` の対応表で写す
- `r = claimed_effect × support`、`r' = r × (1 − g)` をサーバが計算（`r_or_g`）
- Rule State をサーバが `rule_state_table` から決める（主要分岐。全16状態の分岐は P15）

**受け入れ基準**
- `type = attack` に `attack_type` / `claimed_effect_cat` / `support_cat` が無いと Zod で失敗。`type = defense` に `parent_event_id` が無いと失敗
- `attack_subtype` を `NO_EFFECT` 以外に付けると失敗
- `r_or_g` を LLM の応答から受け取らない。サーバが計算する
- `clash_events.status` を書けるのが `/clash-events/{id}/review` だけである
- `INADMISSIBLE_LATE_REPAIR` を fixture で再現できる
- Rule State が `rule_state_ruleset_version` と共に保存される

**人の確認待ち（H5 の一部）**: HEnDA経験者による event 種別と Rule State の妥当性

---

## P12 Judge最小と判定ロック（列は1ジャッジ1票）

**実行場所**: **ローカル**（クラウドセッションでも可）

**読むもの**: `JUDGE_LOGIC.md` 全体（特に §1.1・§5・§14）, `API_SPEC.md` §7, `DATA_MODEL.md` §7〜§8

- `judge_runs` / `judge_issue_assessments`（AI案）/ `judge_decisions` / **`judge_issue_assessments_human`**
- `judge_decisions` に **`UNIQUE(match_id, decided_by)`** / `is_chief` / `reason_grounds` / `compare_note`、
  `matches.panel_size`（奇数 CHECK）、`judge_issue_assessments_human` の `residual_note`（Strength=None で必須の CHECK）/ `segment_ids` を
  **列・制約として入れる**（後から一意制約を張ると既存行の掃除になる）。パネル UI と `GET /panel` は P22
- `judge_cited_segments` ビュー（`judge_issue_assessments_human.segment_ids` を UNION）
- `POST /judge/ballots`、`PUT /judge/ballots/{id}`、`POST /judge/ballots/{id}/lock`
- 画面F（最小）: Decision Chart（AD1/DA1）、Voting Issue、Communication、Strength=None の残存リスク記述、確定とロック
- 集計（AD合計 vs DA合計）は**サーバで計算**
- 4件のエラーコード（P4.2 で `ERROR_STATUS` に追加済み）を実際に投げる経路

**受け入れ基準**
- `Hi/Lo`・`Large/Small`・`Strong/Weak/None` が数値へ置換されていない（人間 Ballot の列に小数が無い）
- `winner` に引き分けを入れられない
- **`audibility = unknown` が根拠segmentに残っていると `409 AUDIBILITY_UNRESOLVED`**（M15）
  → `details.pendingSegmentIds` が返り、UIがそこへジャンプできる
- **`unheard` を引いていると `409 UNHEARD_CITED`**（M44）
- **`residualNote` が空の `None` が Zod と DB で失敗する**（M55）
- **同一ジャッジの2票目が `409 BALLOT_DUPLICATE`**（M57）、`panel_size` が偶数だと `400 VALIDATION_FAILED`（M58）
- `reason_grounds` の各段落が `ground` と根拠 segment を持つ（M56）
- `locked_at` が入ると以後変更できない（`409 DECISION_LOCKED`）
- `judge_decisions` が `judge_runs` を上書きしない
- **AFF/NEGを入れ替えた入力で判定が対称に反転する**（`gold-01-mirror`。M9）
- Best Debater の候補をAIが出していない
- **判定の集計コードが `judge_flow_links` 以外から `effectiveness` / `comparison` を読んでいない**（静的検査・M22）

**人の確認待ち（H5）**: HEnDA経験者2名の承認 → **G6**

---

## P12.1 AI Decision Support（AD1 vs DA1）

**実行場所**: **ローカル**（クラウドセッションでも可）

**読むもの**: `JUDGE_LOGIC.md` §1.1・§9・§13, `API_SPEC.md` §12, `DATA_MODEL.md` §7・§7.6

- `official_decision_support` のマイグレーション（版を持って追記）と `ai_scoring_inputs` ビュー
- `POST /matches/{id}/decision-support/recalculate`、`GET /matches/{id}/decision-support`
- P / V / Strength のカテゴリ写像、Net sum、`winner_suggestion`。AD1 vs DA1 で足りる
- 画面F に「AI参考判定」欄（右側・参考表示）

**受け入れ基準**
- **同じ入力・同じ `scoring_config` で `recalculate` を2回して差分ゼロ**（M63）
- `REVIEW_REQUIRED` のときだけ `review_reasons` が1件以上（M64）
- `ai_scoring_inputs` に `delivery_scores` / `hp_ledger` / `flow_links.effectiveness_*` が含まれない
- AI 参考判定の値を人間 Ballot へ一括コピーする経路が無い
- 画面上で常に「AI参考判定」と表示される

---

## P12.4 Decision Support / Ballot の権限分離

**実行場所**: **開発機のローカル**（Docker 上の Postgres が要る）

**読むもの**: `DATA_MODEL.md` §11, `API_SPEC.md` §0.2.1

- 3つ目のロール `app_ai_worker`（名前はここで確定。v09 では仮置き）を `db-bootstrap.sql` に足す
- `drizzle/0000` の `ALTER DEFAULT PRIVILEGES` を見直し、L2・L3・`official_decision_support` には GRANT、
  `judge_decisions` / `judge_issue_assessments_human` には GRANT しない
- AI worker のジョブがこのロールで接続する

**受け入れ基準**
- **`app_ai_worker` から `judge_decisions` / `judge_issue_assessments_human` への INSERT / UPDATE が DB で拒否される**（M62。G9）
- `app_ai_worker` が `/judge/ballots/{id}/lock` を呼べない（認証スコープ）
- 所有者接続で確かめない（FORCE RLS で 0 行のまま静かに成功する。`HANDOFF.md` 件12・件27）

---

## P12.5 欠損ステージの引用禁止

**実行場所**: **ローカル**（クラウドセッションでも可）

**読むもの**: `JUDGE_LOGIC.md` §4.1・§5, `DATA_MODEL.md` §8

- ロック不変条件の条件4・5（`coverage_status`、`stage_no` NULL）を API とトリガに足す
- `coverage_status ≠ complete` のステージを to とする DROPS を導出しない。`stage_coverage_gap` を立てる

**受け入れ基準**
- **`coverage_status ≠ complete` の区間を根拠に引いたままロックすると `409 GAPPED_STAGE_CITED`。該当 `stage_no` と segment id が返る**（M50）
- 欠損ステージを to とする DROPS が導出されず、`stage_coverage_gap` が立つ（M51）
- 12ステージ外の区間を引くと `422 NON_STAGE_SEGMENT_CITED`（M49）

---

## P13 判定理由メモのWord出力

**実行場所**: **ローカル**（クラウドセッションでも可）

**読むもの**: `JUDGE_LOGIC.md` §6, §9

- `docx`（npm）で **判定理由メモ 1種だけ** を出力する
- `POST /exports`（`Idempotency-Key`）、`locked` 済みの判定からのみ。`export_runs` に `decision_support_id` も記録

**受け入れ基準**
- **根拠なし段落ゼロ**（各段落が最低1つの `transcript_segment_id` を参照）
- 判定理由とアドバイスが別欄に分かれている。**AI 参考判定と人間 Ballot が明示分離され、結論が違えば並記される**
- Judge View外を根拠にした段落に、その旨が明示される
- 未ロックの判定から出力しようとすると拒否される
- **同じ判定＋同じ AI 参考判定＋同じテンプレート版から2回生成して差分ゼロ** → **G7（Phase A分）**

**やってはいけないこと**
- サーバでPDF化する
- 公式様式の画像・PDFを同梱する

---

## P13.5 Strength=None の残存リスクと判定理由の根拠種別

**実行場所**: **ローカル**（クラウドセッションでも可）

**読むもの**: `JUDGE_LOGIC.md` §6.2.1・§7, `HENDA_RULESET.md` §7

- 画面F の残存リスク記述欄と `reason_grounds` の段落ごとの `ground` 入力
- Word 出力で `ground` を段落属性として持ち、`advice` を判定理由に入れない

**受け入れ基準**
- `residualNote` 無しの `None` が `400`（Zod）と DB の CHECK で落ちる（M55）
- 根拠 segment を持たない段落、`ground` が未設定の段落が生成されない（M56）
- `ground = 'delivery'` の段落が Voting Issue / Strength の理由に接続されると `communication_in_content` が candidate で立ち、
  自動除外されない（M60）

**人の確認待ち**: HEnDA経験者による残存リスク記述の妥当性

---

## ★ G0 縦切り貫通ゲート

**実行場所**: **ローカル**（全工程を人が通す）

**合成試合1本が、取り込みからWord出力まで最後まで通ること。**

確認項目（`ACCEPTANCE.md` §3.2）:
1. `gold-01.mp3` を取り込み、12ステージを確定できる。自己紹介ラウンドから座席を結び付けられる
2. Transcriptを人がレビューし、`audibility` を全区間に設定できる
3. AD1 と DA1 を A/B/C に分けて作り、Attack / Defense を矢印でつなげる。clash_events と Rule State が付く
4. AI 参考判定（AD1 vs DA1）が出る。Decision Chartを人が埋め、Voting Issueを選び、**ロックできる**
5. 判定理由メモのWordが出る（AI 参考判定と人間 Ballot が明示分離）
6. 同じ判定からもう一度出して差分ゼロ

**ここを通るまでPhase Bへ進まない。** counterfactual（P12.2）、Value turn Gate（P12.3）、Rule State 全分岐（P15）、パネル（P22）は G0 の条件ではない。
通ったら、実試合1本で同じ流れを人が試す（**G8**。G3 / G4 / G6 の実試合分。`BASIC_DESIGN_v09.md` §17.2.1 の10手順）。

---

# Phase B — 拡張（★G0 の後）

## P14 AD2 / DA2 と 全relation

**実行場所**: **ローカル**（クラウドセッションでも可）

- Issueを片側2件まで扱う。`COMPARES`（`summary_links`）/ `QUESTIONS` / `ANSWERS`（`admits` / `declines_to_answer`）/ `CITES` / `DROPS` を追加
- 質疑ノード（`QUESTION` / `ANSWER`）とフローシートの細いQ&A列
- 4 Issue の全 relation を fixture で再現する

**受け入れ基準**: 片側3件目のIssueが `422 ISSUE_LIMIT_EXCEEDED`。`DROPS` が導出され `suggested` で出る。
`audibility = unheard` の区間や欠損ステージからは DROPS が導出されず `audibility_gap` / `stage_coverage_gap` が立つ → **G5**

---

## P12.2 Voting Issue counterfactual（P14 と同時か直後）

**実行場所**: **ローカル**（クラウドセッションでも可）

**読むもの**: `JUDGE_LOGIC.md` §11, `ARGUMENT_MODEL.md` §10.2

- `survival_candidate` / `clash_candidate`、`clash_leverage`、`winner_flip` を `constructive_end` snapshot から決定的に計算
- Counterfactual View（研修表示）

**受け入れ基準**
- survival / clash 候補と `clash_leverage` と `winner_flip` を fixture で再現
- 二候補が競合すると `confidence = low` と `VOTING_CANDIDATES_CONFLICT` で `REVIEW_REQUIRED`
- `decisive_event_ids` が必ず付く

**人の確認待ち**: HEnDA経験者による候補の妥当性

---

## P12.3 Value turn Review Gate

**実行場所**: **ローカル**（クラウドセッションでも可）

**読むもの**: `JUDGE_LOGIC.md` §12〜§13

- `impact_direction` と `value_turn_mode = review_gate`。turn 適用あり／なしの counterfactual net sum
- Gold Dataset v02 の Value turn 反転 fixture（`ACCEPTANCE.md` §4.6）

**受け入れ基準**
- turn の有無で winner が反転する fixture で `REVIEW_REQUIRED`（`VALUE_TURN_FLIPS_WINNER`）。human ballot は変更されない → **G10**
- L1 の表示に signed score が出ない

---

## P15 Rule State Engine ＋ RuleFlag 互換

**実行場所**: **ローカル**（クラウドセッションでも可）

**読むもの**: `HENDA_RULESET.md` §3・§3.2・§5, `JUDGE_LOGIC.md` §3〜§3.3

- Rule State の全16状態の分岐と `rule_state_table` の全行
- RuleFlag 15種の検出（P1 の9種＋v07 の5種＋`dropped`）と、Rule State との連動（`INADMISSIBLE_*` なら対応する RuleFlag も candidate）
- ロック不変条件の条件7（`INADMISSIBLE_*` の根拠参照）

**受け入れ基準**
- Gold Datasetに仕込んだ違反を検出。**Recall 0.9以上**、罠4件で誤検出ゼロ（M6）
- **③由来なら⑦の再反論を許す例外（罠 T2）を Rule State Engine が再現する**
- **`INADMISSIBLE_*` と `UNVERIFIABLE` のイベントが `ai_scoring_inputs` に入らない**
- **`candidate` のフラグが集計に影響しない**
- 人が `confirmed` にして初めて対象ノードが `excluded` になれる。`rejected` にすると `rule-state/rebuild` で `ADMISSIBLE` へ戻る
- `rationale` に根拠発言の時刻が含まれる
- New Argument の説明文が断定形になっていない
- **`candidate` が残っていると判定をロックできない**

---

## P16 Communication と 語数・速度

**実行場所**: **ローカル**（クラウドセッションでも可）

- `over_word_limit` / `over_speech_rate` の算出と表示
- Communication Points の減点事由入力欄（**人が入力。AIは提案しない**）

**受け入れ基準**: 勝敗の計算に一切入らないことをテストで確認する

---

## P17 7成果物すべて

**実行場所**: ローカルで実装 → **人の確認（印刷）**

- Flow Sheet / Judge Sheet（公式版・拡張版）/ 試合解説・学習レポート / 検証・ジャッジ間比較（成果物07 の基盤）/ 監査履歴 を追加
  （`BASIC_DESIGN_v09.md` §2.3 の7成果物）

**受け入れ基準**: 7成果物すべてで根拠なし段落ゼロ。**AI参考判定と Human Ballot がすべての成果物で明示分離**されている

**人の確認待ち（H6, H7）**: 教材としての妥当性、公式版の印刷崩れ

---

## P17.5 HP View（学習/観戦用）

**実行場所**: **ローカル**（クラウドセッションでも可）

**読むもの**: `ARGUMENT_MODEL.md` §7

- `HP = 10 × Strength`（L2 の内部値）から AD1/AD2/DA1/DA2 のバーを描く
- A / B（link_order ごと）/ C と Support Quality の状態（残っている／弱化→一部回復／Strong など）を併記

**受け入れ基準**
- **画面に常に「AI推定」と表示される**
- **判定の集計コードがHPモジュールを import していない**（静的検査・M25）
- **HPから判定を計算する経路が存在しない**（逆方向も検査）
- 音声・判定を削除した試合でも、残っているデータの範囲で描画が壊れない

**やってはいけないこと**
- 確定した判定からHPを計算する
- HPを公式の得点のように見せる

---

## P17.6 HP ledger / Learning View

**実行場所**: **ローカル**（クラウドセッションでも可）

**読むもの**: `ARGUMENT_MODEL.md` §7, `DATA_MODEL.md` §7.5

- `hp_ledger`（append-only）と `delivery_scores` のマイグレーション、`GET /matches/{id}/hp-ledger`
- Learning View（HP タイムライン、Delivery の4指標、初心者向け説明）

**受け入れ基準**
- `HP = 10 × AI Strength`。`scoring_config_version` が各行に記録される
- **human winner から HP を逆算していない**
- 判定側が `learning.ts` を import していない（M25）。`ai_scoring_inputs` に `hp_ledger` / `delivery_scores` が無い

**人の確認待ち**: 公式判定と視覚的に区別できるか

---

## P18 whosaid-editor インポート

**実行場所**: **ローカル**（クラウドセッションでも可）

**読むもの**: `REVIEW_SEMANTICS.md` §4

**受け入れ基準**
- `time_reviewed: true` → `human_verified` に写る。**`reviewed` は `role_status` に写さず `import_meta.whosaid_reviewed` に保持し、
  取り込み直後の `role_status` は `ai_suggested`**（`REVIEW_SEMANTICS.md` §4.1。自動処理が `human_confirmed` を立てない）
- `text_edited: true` の本文が `text_human` に入る
- **schema 5 以外を `422 UNSUPPORTED_IMPORT_SCHEMA` で拒否**
- `speakers[]` の座席対応づけを人が行う画面がある（自動でやらない）
- 取り込んだ `human_*` が再解析で上書きされない

---

## P19 保持レベルと削除

**実行場所**: ローカルで実装 → **人の確認（削除後の見え方）**

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

**実行場所**: **ローカル**（クラウドセッションでも可）

**受け入れ基準**
- `export_runs` から同じ資料が再生成でき、差分ゼロ → **G7（全体）**
- `edit_logs` に UPDATE / DELETE を打つとDBが拒否する（`redact_edit_logs` を除く）
- 「いつ、どの音声、どのモデル、どのルール、どの `scoring_config`、どの人間確認を基に、この判定資料ができたか」が
  1本の履歴として追える

---

## P22 パネルとバロット

**実行場所**: **ローカル**（クラウドセッションでも可）

**読むもの**: `JUDGE_LOGIC.md` §14, `API_SPEC.md` §7

- 画面F2（バロット一覧、多数と少数、Voting Issue の分布、判定理由の並置）と `GET /matches/{id}/panel`（ビュー `panel_result`）
- 列と一意制約は P12 で入っている。ここでは UI と読み取り API だけ

**受け入れ基準**
- 同一ジャッジの2票目が `409 BALLOT_DUPLICATE`（M57）。`panel_size` が偶数だと `400 VALIDATION_FAILED`（M58）
- **少数意見が集計後も残る**（M59）。`ballots_cast < panel_size` の間は勝者を出さない
- `human_disagreement` と AI の margin が別変数で保存される

**人の確認待ち（H14）**: 多数と異なる判定理由が同じ重みで読めるか

---

## P23 伝達評価の混入検出

**実行場所**: **ローカル**（クラウドセッションでも可）

**読むもの**: `JUDGE_LOGIC.md` §6.2.1・§7, `HENDA_RULESET.md` §7.1

**受け入れ基準**
- `ground = 'delivery'` の段落が Voting Issue / Strength の理由に使われると `communication_in_content` が candidate で立つ。**自動除外しない**（M60）
- AI 参考判定の説明に delivery 語彙（fluent / vivid / impressive 等）が混じったときも同じフラグが立つ

---

# Phase C — 熟練ジャッジ参照DB

## P24.5 Calibration harness（Phase C 前）

**実行場所**: ローカルで実装 → **HEnDA経験者の参加**

**読むもの**: `ACCEPTANCE.md` §3.3

- Pilot / Calibration / Hold-out のデータ分割を固定する
- Hold-out では `scoring_config` を変更できない仕組み

**受け入れ基準**
- 分割が固定され、Hold-out の試合で config の変更が拒否される
- Phase 3 の指標（`ACCEPTANCE.md` §3.3）が報告として出る

---

## P21 参照DBの基盤

**実行場所**: ローカルで実装 → **人の確認（素材の取り込み）**

**読むもの**: `ARGUMENT_MODEL.md` §8, `PRIVACY_RETENTION.md`

**着手前に満たすべき前提**（これが揃うまで実装しない）

1. 大会映像・音声の権利者の確認（主催者・学校・出場者）
2. 解説している熟練ジャッジ本人の許諾（コメントは個人情報であり著作物）
3. **参照データとして使うことへの明示的な同意。**
   通常の録画許諾に「AIの参照データにする」は含まれない
4. `consent_scope = 'expert_reference'`（5値の一つ。P4.2 で値域は入る）の保持期限を決めておく（`PRIVACY_RETENTION.md` §2）

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

## P24 ジャッジ間比較レポート（成果物07）

**実行場所**: ローカルで実装 → **人の確認**

**受け入れ基準**
- AI 提案・人間修正・`scoring_config`・複数 Ballot の一致・不一致とその理由が並ぶ
- 少数意見の判定理由が省略されない

---

## 順序とゲート

```
P-1 ─> P0 ─> P1 ─> P2 ─> P3 ─[G1]─> P4 ─> P4.1 ─> P4.2 ─> P4.5 ─> P1.5 ─> P5 ─> P6 ─> P7 ─[G3]─┐
                                                                                                  │
    ┌─────────────────────────────────────────────────────────────────────────────────────────────┘
    └─> P7.5 ─> P7.6 ─> P8 ─[G4]─> P9 ─[G2]─> P10 ─> P11 ─> P11.5 ─> P11.6 ─> P12 ─[G6]─┐
                                                                                          │
    ┌─────────────────────────────────────────────────────────────────────────────────────┘
    └─> P12.1 ─> P12.4 ─[G9]─> P12.5 ─> P13 ─[G7a]─> P13.5 ─> ★G0 縦切り貫通 ─> G8 実試合 ─> Phase B
                                                                                          │
    ┌─────────────────────────────────────────────────────────────────────────────────────┘
    └─> P14 ─[G5]─> P12.2 ─> P12.3 ─[G10]─> P15 ─> P16 ─> P17 ─> P17.5 ─> P17.6 ─> P18 ─> P19 ─> P20 ─[G7]─> P22 ─> P23 ─> v1.0
                                                                                                                      │
                                                        ┌─────────────────────────────────────────────────────────────┘
                                                        └─> [許諾・権利の確認] ─> P24.5 ─> P21 ─> P24（Phase C）
```

P4.1 / P4.2 は P4 完了後に挿入した v09 追随（文書・スキーマ）。P1.5 は P5 の直前。P7.5 / P7.6 は P7 の直後。
P12.2 / P12.3 は 4 Issue が要るので P14 の後。P22 は縦切りの貫通に要らないので Phase B の末尾（列と制約は P12 で入っている）。

ゲートの内容は `ACCEPTANCE.md` §3。
**ゲートは人の承認を伴う。CIが緑になっただけでは通過しない。**
