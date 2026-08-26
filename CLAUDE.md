# CLAUDE.md

## プロジェクト概要

ai-debate-analyzer: HEnDA方式の英語ディベート試合（音声・動画）を解析し、
**フローシート・ジャッジシート・判定理由・解説資料**を作るWebアプリ。

製品価値は「勝敗を自動で当てること」ではない。
**人間ジャッジが何を聞き、どの議論を追い、なぜその判定に至ったかを、再現可能な形にすること**である。
AIは候補を出すだけで、確定するのは人間。

正本は `docs/BASIC_DESIGN_v03.md`。実装前に必ず読むこと。

---

## 絶対に守る設計原則

これらを破る実装は、動いていてもマージしない。破りたくなったら、コードを変える前に相談する。

- **自動処理が「人が確認した」印を立てることは決してない。**
  `human_verified` / `human_confirmed` / `human_edited` を書けるのは、人の操作を受けたAPIだけ。
  この区別が製品価値そのもの（whosaid-editorの `✓` と `△` の意味論を継承）。

- **AIの出力は必ず `suggested` 層に入る。**
  `confirmed` / `excluded` を書けるのはサーバのAPIだけ。AIにもクライアントにも直接書かせない。

- **短い相づち・フィラー・沈黙を自動削除しない。**
  ディベートでは「答えなかった」「沈黙した」「聞き返した」こと自体が判定材料になる。
  整文・要約は本文を置き換えず、別フィールドに持つ。

- **ArgumentNode は `segmentIds` を1つ以上持たなければならない。**
  原音の時刻へ戻れない議論は保存しない。根拠のない主張文は生成しない。

- **`audibility = unknown` を含む判定はロックできない。**
  `unknown` は「まだ人が聞いていない」の意味である。これを許すと、
  AIの文字起こしを人間が聞いたものとして判定に使うことになる。
  ロック時に `409 AUDIBILITY_UNRESOLVED` で止める（`JUDGE_LOGIC.md` §5）。

- **`audibility` を書けるのは人だけ。** ASRのconfidenceを代用にしない。
  DBのCHECK（`audibility <> 'unknown'` なら `audibility_set_by` が必須）で担保する。

- **再解析は `*_ai` 列だけを更新する。`*_human` 列に触らない。**
  表示は `COALESCE(human, ai)`。再解析の前後で human_* の件数が減っていたらバグ。

- **Issue key（AD1/AD2/DA1/DA2）とnode idはサーバが割り当てる。**
  AIに生成させない。生成させると重複と揺れが起き、履歴の同一性が壊れる。

- **`effectiveness`（そのやりとりが効いたか）とHPバーは、判定に一切入らない。**
  勝敗を決めるのは `judge_decisions` の Probability / Value / Strength だけ。
  判定の集計コードから `effectiveness`・`comparison`・HPモジュールを参照しない。

- **解析・観戦画面から `display_name` を参照しない。**
  役割と座席ラベル（A1〜N4）を主表示にする。氏名を使ってよいのは、
  試合登録画面と公式Judge Sheetの生成コードだけ。保持レベルCの匿名化が効かなくなる。

- **HEnDA公式の判定語彙を数値へ置換しない。**
  `Hi/Lo`・`Large/Small`・`Strong/Weak/None` を0〜100点に変換しない。
  勝敗に引き分けは存在しない（`winner` は AFF か NEG の二択）。

- **ルール違反は「候補」止まり。自動で判定から除外しない。**
  大会ルール4.2.2は「新しい議論かどうかの判断はジャッジが行う」と明記している。

- **実音声・実映像・実名・実試合transcriptをリポジトリに置かない。**
  `fixtures/` は合成データのみ。CIの `check-no-real-data` が検出したら失敗させる。

- **削除できる形で保存する。** 保持レベル A(音声) / B(transcript) / C(氏名) / D(フロー・判定) / E(統計)
  を分け、A→B→C→D の順に消せるようにする（`PRIVACY_RETENTION.md`）。
  「音声だけ消せばよい」ではない。transcriptも判定理由も個人情報になり得る。

- **スキーマの破壊的変更は一括で行う。** 散発的にフィールドを足さない。

---

## 環境（クラウド完結が前提）

- **開発・検証・デプロイはすべてクラウドで完結する。** 特定のPCに依存する工程を作らない。
- Next.js（App Router）＋ TypeScript ＋ Zod ＋ Drizzle ORM / Supabase（Postgres・Storage・Auth）/ Vercel / GitHub Actions
- **サーバにffmpegを置かない。** 音声の区間再生はブラウザ標準のメディア要素で行う。
  動画からの音声抽出が必要な場合のみ、ブラウザ内のffmpeg.wasmを使う。
- Supabaseの **Data API（PostgREST）は無効**。DBアクセスは
  **Next.js Server → Supavisor プーラー（transaction mode / 6543）→ Postgres** の一本だけ。
  `supabase-js` をDBアクセスに使わない。service role key は **Storage と Auth 専用**。
  `postgres.js` は `prepare: false` を必ず指定する（transaction modeでは prepared statement が使えない）。
- **DBアクセスは必ずトランザクションを開き、最初に `SET LOCAL app.actor_id` を発行する。**
  RLSがこの値を見る。素の `route.ts` を直接書かず、`defineHandler` を通す（`API_SPEC.md` §11）。
- 外部API（転写・LLM）は**サーバからのみ**呼ぶ。キーをクライアントに出さない。
- Vercel Functionsの実行時間を前提に、**1ジョブ＝2〜4分の音声、または純粋計算**に割る。
  42分を1回の同期呼び出しで処理する設計にしない。

---

## 実行場所（Web版 / デスクトップ版）

詳細は `docs/DEV_ENVIRONMENTS.md`。ここでは守るべき点だけ。

- **クラウドセッションには PostgreSQL 16 と Docker が入っている。**
  マイグレーション、RLS、トリガー、CHECK制約は**セッション内のPostgresで検証する**。
- **実 Supabase には接続しない。** 外向き通信はHTTP/HTTPSプロキシを通るため
  Postgresワイヤプロトコルは届かない見込みであり、そもそも接続すべきでもない。
  本番へのマイグレーション適用は GitHub Actions から行う。
- **クラウド環境の設定にシークレットを置かない。** 専用のシークレットストアがなく、
  その環境を使う人全員から読める。実キーを要するPR（P5・P8）はデスクトップかCIで動かす。
- **テーブルの所有者はRLSを素通りする。** `app_migrator` が所有し、`app_server` は `GRANT` だけ。
  同じロールにすると、RLSのテストが通ったように見えて何も検証していない状態になる。
- 各PRの実行場所は `docs/TASKS.md` の「実行場所」に書いてある。
  **デスクトップ指定のPRを、Webで「動いた」と報告しない。**

---

## お前（Claude Code）に検証できないこと

これは能力の問題ではなく、実行環境の問題である。自覚して報告すること。

| 検証できる | 検証できない |
| --- | --- |
| 型・スキーマ・状態遷移・集計 | 音が鳴るか、区間再生が意図した位置か |
| fixtureに対する検出精度 | 発言が聞き取れるか（audibility） |
| アンカー照合（純粋関数・音声不要） | ステージ境界が実音と一致しているか |
| API契約・権限・不変条件 | 判定・解説の妥当性 |
| 出力ファイルの生成と構造 | 逐語の忠実さ（フィラーが残っているか） |

**「テストが通った」を「正しく動いた」と報告しない。**
`docs/ACCEPTANCE.md` で「人間検証」に分類されている項目は、
テストが緑でも完了とせず、「人の確認待ち」として報告すること。

---

## 作業の進め方（必須）

- **1 PR = 1縦切り。** `docs/TASKS.md` のPR単位で進める。
  現在のPRの受け入れ基準を満たしたことを確認するまで、次のPRへ進まない。
- **Phase A（P0〜P13）は縦切りである。** 扱うのは AD1 と DA1 だけ。
  AD2/DA2・RuleFlag・6成果物・whosaid import はPhase Bに置いてある。
  Phase Aの途中でそれらを実装しない。**全機能の20%ではなく、全工程を細く1本**が目的。
- 着手前に実装計画を提示し、承認を得てから手を動かす。
- ブランチ運用: `feature/pXX-xxx` → PR → `main`。コミット履歴を保つ。
- 実装前に、そのPRに関係する `docs/*.md` を必ず読む。
  設計書と食い違う実装をしたくなったら、勝手に変えず相談する。
- テストを消して通す、`skip` で回避する、閾値を緩めて通す、はしない。
  通らない理由を報告する。

---

## ドキュメント

| ファイル | 内容 |
| --- | --- |
| `docs/BASIC_DESIGN_v04.md` | 正本。全体設計 |
| `docs/HENDA_RULESET.md` | 大会ルールの条項と機械可読化の対応 |
| `docs/DATA_MODEL.md` | テーブル定義と制約 |
| `docs/TRANSCRIPTION.md` | 4パス構成（Pass A / S / B / C）とprovider契約 |
| `docs/API_SPEC.md` | HTTP API契約。**セキュリティ境界そのもの** |
| `docs/PRIVACY_RETENTION.md` | 保持レベルA〜Eと削除 |
| `docs/REVIEW_SEMANTICS.md` | レビュー状態の4軸。壊してはならない規則 |
| `docs/ARGUMENT_MODEL.md` | 議論の4構成要素、やりとりの効果、比較軸、HP、役割優先UI |
| `docs/JUDGE_LOGIC.md` | Decision Chartとサーバ権威 |
| `docs/ACCEPTANCE.md` | 受け入れ基準（機械検証／人間検証）と品質ゲート |
| `docs/TASKS.md` | Phase A（P0〜P13・縦切り）／Phase B（P14〜P20）のPR分割と実行場所 |
| `docs/DEV_ENVIRONMENTS.md` | Web版とデスクトップ版の使い分け、クラウド環境の設定 |
