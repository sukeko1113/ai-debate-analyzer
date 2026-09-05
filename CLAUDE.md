# CLAUDE.md

## プロジェクト概要

ai-debate-analyzer: HEnDA方式の英語ディベート試合（音声・動画）を解析し、
**フローシート・ジャッジシート・判定理由・解説資料**を作るWebアプリ。

製品価値は「勝敗を自動で当てること」ではない。
**人間ジャッジが何を聞き、どの議論を追い、なぜその判定に至ったかを、再現可能な形にすること**である。
AIは候補を出すだけで、確定するのは人間。

正本は `docs/BASIC_DESIGN_v09.md`。実装前に必ず読むこと。
`BASIC_DESIGN_v05.md` / `v08.md` は履歴。**分割文書（`DATA_MODEL.md` 等）と `packages/core/src/schema/` は v09 への追随が
次の PR で行われる予定であり、それまで v09 と食い違う箇所がある。食い違ったら v09 を正とし、勝手に片方へ寄せず相談する。**

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

- **判定支援は三層に分かれ、混ぜない（`BASIC_DESIGN_v09.md` §3.6・§12.6）。**
  L1 AI Decision Support（`official_decision_support`。名前に official を含むが **AI 側の表**、画面では常に「AI参考判定」）、
  L2 Internal Analysis（`argument_node_scores` / `clash_events` / `issue_snapshots` / `scoring_config`）、
  L3 Learning（HP・delivery）、そして **Human Ballot**（`judge_decisions` / `judge_issue_assessments_human`）。
  - 勝敗を決めるのは Human Ballot の Probability / Value / Strength だけ。人間 Ballot の集計コードは `judge_decisions` だけを読む。
  - AI Decision Support の計算はビュー `ai_scoring_inputs`（L2 と `scoring_config`）だけを読む。`flow_links.effectiveness_*`・`summary_links`・HP は L1 にも Human Ballot にも入らない。
  - **AI は `judge_decisions` / `judge_issue_assessments_human` を書かない。** DB ロールで拒否する。AI 値を人間 Ballot へ自動コピーする機能は作らない。
  - **`Strength = Probability × Value` は L2 の内部計算。** AI はカテゴリと根拠を出し、数値写像は `scoring_config` でサーバが行う。LLM に小数を出させない。
  - `winner_suggestion = REVIEW_REQUIRED` は**正常な状態**であり、エラーでも未判定でもない。人間 Ballot のロックを機械的には止めない。

- **「記録が無い」「聞き取れなかった」「応答しなかった」を混ぜない。**
  `coverage_status ≠ complete`（記録が無い）、`audibility = unheard`（聞き取れなかった）、DROPS（応答しなかった）は別の事象で、
  判定材料になるのは DROPS だけ。欠損ステージや unheard の区間から DROPS を導出しない。
  欠損ステージの区間と `stage_no` が NULL の区間（自己紹介・アナウンス）は判定根拠に引けない
  （`409 GAPPED_STAGE_CITED` / `422 NON_STAGE_SEGMENT_CITED`）。unheard を引いたままロックできない（`409 UNHEARD_CITED`）。

- **判定は1ジャッジ1票。** `judge_decisions` は `UNIQUE(match_id, decided_by)`。パネル結果はビューで導出し、少数意見を消さない。
  `Strength = None` には残存リスクの記述（`residual_note`）を必ず書かせる。判定理由の段落は根拠種別を持ち、
  `delivery` を内容判定の理由にしたら `communication_in_content` を candidate で立てる。自動で消さない。

- **provider が返した話者ラベルを保存しない。** 座席（A1〜N4）は担当者表と自己紹介の名乗りから決める。`align_words` に speaker 列を作らない。

- **解析・観戦画面から `display_name` を参照しない。**
  役割と座席ラベル（A1〜N4）を主表示にする。氏名を使ってよいのは、
  試合登録画面と公式Judge Sheetの生成コードだけ。保持レベルCの匿名化が効かなくなる。

- **HEnDA公式の判定語彙を数値へ置換しない。**
  L1 の公式表示と人間 Ballot は `Hi/Lo`・`Large/Small`・`Strong/Weak/None` の語彙だけを持ち、0〜100点に変換しない。
  比較が要るときも `STRENGTH_ORDER` の順序関係だけを使う。L2 の内部数値はここへ写さない。
  勝敗に引き分けは存在しない（`winner` は AFF か NEG の二択）。

- **ルール違反は「候補」止まり。自動で判定から除外しない。**
  大会ルール4.2.2は「新しい議論かどうかの判断はジャッジが行う」と明記している。

- **実音声・実映像・実名・実試合transcriptをリポジトリに置かない。**
  `fixtures/` は合成データのみ。CIの `check-no-real-data` が検出したら失敗させる。

- **削除できる形で保存する。** 保持レベル A(音声) / B(transcript) / C(氏名) / D(フロー・判定) / E(統計)
  を分け、A→B→C→D の順に消せるようにする（`PRIVACY_RETENTION.md`）。
  「音声だけ消せばよい」ではない。transcriptも判定理由も個人情報になり得る。

- **スキーマの破壊的変更は一括で行う。** 散発的にフィールドを足さない。

- **設計書の改訂は直前の版を複製して差分を当てる。** 古い本文から書き起こさない。
  第13章のコード例は `packages/core/src/schema/` から写す。v08 で実装済みの Zod が巻き戻った事故を繰り返さない。

---

## 環境（製品と CI はクラウド完結・開発はローカルが主戦場）

- **「クラウド完結」は製品と CI の条件であって、開発をクラウドで行うという意味ではない**（`BASIC_DESIGN_v09.md` §1.1・§17.6）。
  守るのは三条件：(a) 交換点は GitHub だけ（手元にしかないファイル・絶対パス・OS 固有パスをリポジトリの前提にしない）、
  (b) CI が唯一の判定者で、Vercel が配信する（人が PC でビルドする工程を要らなくする）、
  (c) 実行時に管理者 PC 固有の環境（ffmpeg.exe 等）を要求しない。
  開発そのものは 2026-09-03 以降ローカル（次節）で行う。
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

## 実行場所（ローカルが主 / クラウドセッションは補助）

詳細は `docs/DEV_ENVIRONMENTS.md`。ここでは守るべき点だけ。

- **主たる開発環境はローカル（WSL2 上の Ubuntu ＋ `postgres:16` コンテナ）。**
  マイグレーション、RLS、トリガー、CHECK制約は**手元のPostgresで検証する**。
  クラウドセッション（セッション内 PostgreSQL 16）でも同じ検証はできるが、実キーは置けず、音は聞けない。
- **立ち上げは `bash scripts/install_pkgs.sh`。ロールと DB を手で `CREATE ROLE` しない。**
  `scripts/db-bootstrap.sql` が正本で、ローカル・クラウド・CI の三者が同じファイルを流す。
  手で作ると権限が1つずつ足りない（`HANDOFF.md` 件33）。
  `install_pkgs.sh` はコンテナを起動も作成もしない。応答が無ければ復旧手順を出して終わる。
- **`npm run db:migrate` を手で叩くときは `set -a && . ./.env.local && set +a` を前置きする。**
  `db-migrate.ts` は意図的に `.env.local` を読まない（本番 `DIRECT_URL` への誤爆を防ぐ）。
- **実 Supabase には接続しない。** ローカルからは技術的に届くが、`.env.local` に実 Supabase を指す
  `DATABASE_URL` / `DIRECT_URL` を書かない。本番へのマイグレーション適用は GitHub Actions から行う。
- **クラウド環境の設定にシークレットを置かない。** 専用のシークレットストアがなく、
  その環境を使う人全員から読める。実キーはローカルの `.env.local` か CI Secrets にだけ置く。
  だから `install_pkgs.sh` はローカルの `.env.local` を上書きしない。
- **テーブルの所有者はRLSを素通りする。** `app_migrator` が所有し、`app_server` は `GRANT` だけ。
  同じロールにすると、RLSのテストが通ったように見えて何も検証していない状態になる。
- 各PRの実行場所は `docs/TASKS.md` の「実行場所」に書いてある。
  **実キーが要るPR（P5・P8）をクラウドセッションで走らせない。
  人の確認が要るPRを、テストが緑なだけで「動いた」と報告しない。**

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
- **Phase A（P0〜P13）は縦切りである。列は4 Issue ぶん先に入れ、機能は AD1 と DA1 だけで★G0 を通す。**
  スキーマ（`node_type`・`clash_events`・`scoring_config`・`official_decision_support`・`coverage_status`・`match_events`・
  1ジャッジ1票の制約など、`BASIC_DESIGN_v09.md` §17.2 の列挙）は後から足すと破壊的変更になるので Phase A 開始時に入れる。
  AD2/DA2 の機能（P14）、Voting Issue counterfactual（P12.2）、Value turn Review Gate（P12.3）、Rule State Engine の全分岐（P15）、
  パネル UI（P22）、7成果物、whosaid import は★G0 の後。Phase Aの途中でそれらを実装しない。
  **全機能の20%ではなく、全工程を細く1本**が目的。
- **P4 は「DB とドメインまで」。job API 6本は P4.5**（`API_SPEC.md` §3）。P5 の前に入れる。
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
| `docs/BASIC_DESIGN_v09.md` | **正本。全体設計。** 冒頭の改訂履歴で v08 から引き継いだ点・実装から取り込んだ点・v09 で決めた点を3系統に分けている |
| `docs/CONCEPT_DESIGN_v07.md` | コンセプト設計書。技術を外した全体像。三層と Strength=P×V の意図 |
| `docs/BASIC_DESIGN_v05.md` / `v08.md` | 履歴。正本ではない |
| `docs/HENDA_RULESET.md` | 大会ルールの条項と機械可読化の対応 |
| `docs/DATA_MODEL.md` | テーブル定義と制約（列の型と CHECK の正本）。**v09 への追随は次の PR** |
| `docs/TRANSCRIPTION.md` | 4パス構成（Pass A / S / B / C）とprovider契約、ジョブモデル |
| `docs/API_SPEC.md` | HTTP API契約。**セキュリティ境界そのもの。エラーコードの正本（§0.5）** |
| `docs/PRIVACY_RETENTION.md` | 保持レベルA〜Eと削除、consent_scope と保持期限の対応 |
| `docs/REVIEW_SEMANTICS.md` | レビュー状態の4軸。壊してはならない規則 |
| `docs/ARGUMENT_MODEL.md` | 議論のモデル（A/B/C・Support Quality・effect_kind・比較軸・HP・役割優先UI）。**v09 への追随は次の PR**（現行は4構成要素で書かれている） |
| `docs/JUDGE_LOGIC.md` | Decision Chartとサーバ権威。**§1.1 の L1/L2 書き分けは次の PR** |
| `docs/ACCEPTANCE.md` | 受け入れ基準（機械検証／人間検証）と品質ゲート |
| `docs/TASKS.md` | Phase A（P0〜P13・縦切り）／Phase B（P14〜P20）のPR分割と実行場所。**P4.5 / P1.5 / P11.5 等の挿入は次の PR** |
| `docs/HANDOFF.md` | **PR間の申し送り。着手前に読み、完了時に追記する** |
| `docs/DEV_ENVIRONMENTS.md` | ローカル（主）とクラウドセッション（補助）の使い分け、立ち上げ手順、踏んだ穴 |
