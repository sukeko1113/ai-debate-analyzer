# AI英語ディベート解析・ジャッジ支援 基本設計書 v04

> 実装ブロッカーを除去したClaude Code投入版　／　2026年8月25日

本書はリポジトリ `ai-debate-analyzer` の `docs/BASIC_DESIGN_v04.md` として配置する正本である。
実装がここと食い違う場合、コードを変える前に本書を改訂する。

---

> **v04の結論**  
> 目的も、v03で決めたクラウド完結の方針も変えない。v04が変えるのは、v03に残っていた実装ブロッカーである。  
> 第一に、DB接続方式の矛盾を解消した。Data APIを無効にしたままservice roleでDBへ入ることはできない。DBアクセスはSupavisorプーラー経由のPostgres接続に一本化する。  
> 第二に、HTTP API契約を確定した。「confirmedを書けるのはサーバだけ」と言う以上、APIがセキュリティ境界そのものである。  
> 第三に、audibilityが未確認のまま判定をロックできない不変条件を追加した。ここを開けておくと、AIの文字起こしを人が聞いたものとして判定に使う事故が起きる。  
> 第四に、個人情報の保持を5層に分け、試合単位で「何を、いつ消すか」を指定できるようにした。音声だけ消せばよい、ではない。  
> 第五に、ロードマップを組み替えた。まず全工程を細く1本通し、そのあと太らせる。

## 0. v04で何を変えたか

v03は方針としては正しかったが、実装に入ると必ず手が止まる箇所が残っていた。v04はそれを除去する。目的・正本・クラウド完結の方針・4パス構成は変えない。

| # | v03の問題 | v04の確定 |
| --- | --- | --- |
| 1 | 「Data APIは無効」と「service roleでDBアクセス」が両立しない。supabase-jsからのDBアクセスはPostgREST（＝Data API）経由である | DBアクセスはSupavisorプーラー（transaction mode / 6543）経由のPostgres接続に一本化。service role keyはStorageとAuth専用（§4.2） |
| 2 | 冒頭で「2パス構成」、第6章で「4パス構成」と表記が割れていた | 4パス（Pass A / S / B / C）に統一（第6章） |
| 3 | HTTP API契約がない。「confirmedを書けるのはサーバだけ」と言いながら、そのサーバの入口が定義されていない | 第14章とdocs/API_SPEC.mdで確定。method / path / Zod / 認可 / expectedVersion / Idempotency-Key / エラーコード |
| 4 | audibility = unknown（まだ人が聞いていない）のまま判定を確定できてしまう | ロック不変条件を追加。根拠segmentにunknownが残る間は判定をロックできない（§10.3） |
| 5 | 「音声を消してもフローと判定は残せる」だけで、transcript・氏名・判定理由の扱いが未定 | 保持レベルA〜Eに分け、試合単位で何をいつ消すかを指定できるようにした（第16章） |
| 6 | P0〜P16が実質v1.0完成ロードマップになっていた | Phase A（縦切り13本）とPhase B（拡張7本）に分割。★G0縦切り貫通ゲートを新設（第17章） |

### 0.1 三世代の主要決定

| 項目 | v02 | v03 | v04 |
| --- | --- | --- | --- |
| 実行形態 | ローカルPython先行 | 最初からWeb | 変更なし |
| DBアクセス | 未定 | service role（矛盾） | Supavisorプーラー経由のPostgres接続 |
| 転写 | エンジン差し替えの概念 | 2パス／4パスが混在 | 4パス（A / S / B / C）に統一 |
| API | 未定 | 未定 | API_SPEC.mdで確定 |
| 判定の確定 | 人が確定 | 人が確定 | ＋ロック不変条件（unknownを残せない） |
| 個人情報 | 一般的な注意 | 許諾の記録とGit規約 | ＋保持レベルA〜Eと段階削除 |
| ロードマップ | Phase 0〜7 | P0〜P16 | Phase A（縦切り）／Phase B（拡張） |
| スキーマ | 概念例 | Zodで確定 | ＋楽観ロック（expectedVersion） |

### 0.2 v02・v03から変えないこと

以下は確定した設計思想であり、v04でも動かさない。実装の都合でこれらを曲げたくなった場合は、コードを変える前に本書を改訂する。

- 本アプリの第一目的は、自動で勝敗を当てることではない。発言を確認可能な形で記録し、公式形式のフローシートを作り、ジャッジシートの判定材料を整理し、勝敗の過程と理由を時刻付き根拠で説明できる資料を作ることである。
- 正本は第20回全国高校生英語ディベート大会ルール、HEnDA Judge Sheet、HEnDA Flow Sheetである。独自の採点体系を先に作らない。
- AIは候補を出し、人が確定する。自動処理が人間確認済みの状態を作ることはない。
- Strong / Weak / None などの公式表現を、勝手に0〜100点へ置換しない。
- ジャッジが試合中に聞き取れなかった発言を、後から原稿や証拠資料で補って判定に使わない。
- 開発・検証・デプロイはクラウドで完結する。特定のPCに依存する工程を作らない。

## 1. クラウド完結の定義と、その帰結

### 1.1 「特定のPCに依存しない」を三条件で定義する

この要件は曖昧に扱うと守れない。次の三条件をすべて満たす状態を「クラウド完結」と呼ぶ。

| 条件 | 内容 | 設計上の帰結 |
| --- | --- | --- |
| (a) 交換点はGitHubだけ | ソースコード、設計書、fixture、CI定義のすべてがリポジトリに入っている。ローカルにしか存在しないファイルを前提にしない。 | 手元のExcelやメモに書いた仕様は存在しないものとして扱う。指示書もリポジトリに置く。 |
| (b) 実装・テスト・デプロイがクラウドで閉じる | Web版Claude Codeが書き、GitHub Actionsが検証し、Vercelが配信する。人がPCでビルドする工程を必要としない。 | PyInstaller、Inno Setup、Windows専用テストのような工程を持ち込まない。 |
| (c) 実行時に管理者PC固有の環境を要求しない | サーバ側にffmpeg.exeやffplay.exeを置かない。OS固有のパスや事前インストール済みバイナリに依存しない。 | 音声処理はブラウザの標準機能か、必要な場合のみブラウザ内WebAssemblyで行う。 |

### 1.2 なぜローカル版を先に作らないのか

v02は、42分の音声処理・ffmpeg・細かい区間再生がwhosaid-editorのWindows資産と相性がよいことを理由に、ローカル先行を推奨していた。技術的な相性についてはそのとおりである。問題は別のところにある。

whosaid-editorのCLAUDE.mdは、リポジトリの位置がC:\dev\01配下であること、作業前に.venvを有効化する必要があること、ffmpegとffplayがWinGetで導入済みであること、pytestでは一部のテストが黙ってスキップされるため個別実行が必要であることを前提としている。これは、人がその机に座っていて、画面を見ながら確かめられる状況を織り込んだ設計である。開発の中心をWeb版Claude Codeに置くなら、エージェント自身が実行して結果を確認できる形にそろえないと、実装は進むのに検証だけが滞る。

> **誤解を避けるための注記**  
> ローカル処理そのものを否定しているのではない。録音を外部に出せない案件では、whosaid-editorをローカルで使い、その作業JSONを本アプリへ取り込む経路を正式にサポートする（§6.7）。禁止するのは「本アプリの動作が特定のPC環境に依存すること」であって、「ユーザーが手元で前処理すること」ではない。

### 1.3 AIコーディングエージェントに検証できないこと

この設計で最も注意すべき点は、開発を担うエージェントが音を聞けないことである。テストが通ることと、実際に正しい位置の音が鳴ることは別である。受け入れ基準を作る前に、この境界を明示しておく。

| 対象 | エージェント による検証 | 確かめる主体と方法 |
| --- | --- | --- |
| 型・スキーマの整合、状態遷移、集計、ルール検査の分岐 | 可能 | CI（単体テスト・fixture回帰） |
| fixtureに対する検出精度（New Argument、担当者違反、語数超過など） | 可能 | CI（正解付き合成データ） |
| アンカー照合の正しさ | 可能 | CI（テキストと単語時刻のfixtureのみで完結する。音声は不要） |
| Word / PDF / JSONの生成と構造 | 可能 | CI（生成物のパースと必須項目チェック） |
| 音が鳴るか、区間再生が意図した位置か | 不可能 | 人が再生して確認 |
| 発言が聞き取れるか（audibility） | 不可能 | 人が耳で確認 |
| 話者が誰か | 不可能 | 人が確認。ただし本アプリではステージ確定により大部分が自動決定（§6.4） |
| ステージ境界が実音と一致しているか | 不可能 | 人が波形と音で確認 |
| 判定・解説の妥当性 | 不可能 | HEnDA経験者によるレビュー |

> **最も起きやすい失敗**  
> エージェントは「テストが通った」を「正しく動いた」として報告しがちである。音に関わる機能は、テストが通っても人が耳で確認するまで完了としない。第17章の受け入れ基準はこの前提で書いてある。

## 2. 目的・利用者・成果物

### 2.1 目的（v02からの継承）

HEnDA方式の英語ディベート試合を、あとから検証できる議論データに変換する。入力は録音・録画された試合であり、ユーザーは音声を聴き、必要なら映像を確認しながら、AIが提案した文字起こし・論点構造・判定案を修正し確定する。

> **設計原則**  
> 「AIがジャッジの代わりに決める」ではなく、「人間ジャッジが何を聞き、どの議論を追い、なぜその判定に至ったかを、再現可能な形にする」。

### 2.2 主な利用者

- HEnDA大会・県大会等のジャッジ：フロー作成と判定理由の整理
- 顧問・指導者：試合後の振り返り、選手への説明、ジャッジ研修
- 高校生・初心者：動画を見ながらフローの書き方と判定の考え方を学ぶ
- 大会運営者：許諾を得た試合の記録・教材化・ジャッジ間比較
- 研究・開発：AI解析と人間ジャッジの一致／不一致の検証

### 2.3 1試合から生成する6成果物（v02から変更なし）

| No. | 成果物 | 役割 | 形式 |
| --- | --- | --- | --- |
| 01 | タイムスタンプ付き逐語／準逐語記録 | 各発言を音声・動画の位置へ戻して確認できる。話者・AFF/NEG・Stageを保持 | 画面／JSON／Word |
| 02 | デジタルフローシート | 公式Flow Sheetの配置を踏襲し、Claim / Evidence / Attack / Defense / Summaryを矢印で接続 | 画面／JSON／Word |
| 03 | Judge Sheet下書き | AD1/AD2/DA1/DA2のProbability・Value・Strength、Voting Issue、新規議論チェックを候補提示 | 画面／Word（公式版・拡張版） |
| 04 | 判定理由メモ | どの議論が残り、どれが崩れ、どの比較が決定的だったかを時刻付き根拠で説明 | Word／JSON |
| 05 | 試合解説レポート | 試合の流れ、ターニングポイント、勝敗理由、学習ポイントを日本語で整理 | Word |
| 06 | 検証履歴 | AI提案・人間修正・確定者・モデル／ルール版・再解析履歴 | 画面／JSON |

PDF化はサーバでは行わない。理由は、フォント同梱とレンダラの導入がクラウド完結の三条件（c）と衝突しやすいためである。Wordファイルを配布し、必要な場合はユーザー側でPDFに変換する。ただし公式Judge Sheetに近いレイアウトは印刷される可能性が高いため、Word側で用紙・余白・表幅を固定する。

### 2.4 MVPの対象外

- リアルタイム公式判定の完全自動化
- AIの判定を人間の最終判定より優先する運用
- 3Dキャラクター等の観戦ゲーム演出
- 公開動画の無断ダウンロード機能
- 複数ジャッジの同時共同編集（Phase後半で検討）

## 3. HEnDA公式形式を正本とする

### 3.1 1試合の12ステージ

| No. | Stage | 日本語 | 時間 | 解析上の役割 |
| --- | --- | --- | --- | --- |
| ① | AFF Constructive | 肯定立論 | 4分 | Plan ＋ Advantage（最大2） |
| ② | Questions from NEG | 否定側質疑 | 2分 | 直前のAFF立論を確認・検証 |
| ③ | NEG Constructive | 否定立論 | 4分 | Disadvantage（最大2） |
| ④ | Questions from AFF | 肯定側質疑 | 2分 | 直前のNEG立論を確認・検証 |
| ⑤ | NEG Attack | 否定アタック | 3分 | AFF Advantageの証明を攻撃 |
| ⑥ | Questions from AFF | 肯定側質疑 | 2分 | 原則NEG Attackを確認・検証 |
| ⑦ | AFF Attack | 肯定アタック | 3分 | NEG Disadvantageの証明を攻撃 |
| ⑧ | Questions from NEG | 否定側質疑 | 2分 | 原則AFF Attackを確認・検証 |
| ⑨ | AFF Defense | 肯定ディフェンス | 3分 | AFF Advantageを再構築 |
| ⑩ | NEG Defense | 否定ディフェンス | 3分 | NEG Disadvantageを再構築 |
| ⑪ | AFF Summary | 肯定総括 | 3分 | 双方を要約・比較しAD ＞ DAを主張 |
| ⑫ | NEG Summary | 否定総括 | 3分 | 双方を要約・比較しDA ＞ ADを主張 |

*準備時間は①後1分、③後1分、④後2分、⑧後2分、⑩後2分。公式フォーマット全体は計42分。アプリでは準備時間とチェアパーソンのアナウンスも別イベントとして保持する。*

### 3.2 立論の内部構造

Advantage / Disadvantageはいずれも最大2つ。主張を一塊にせず、証明構造を三つの論点に分解して保存する。

| 論点 | 現状側 | 因果・効果 | 価値・重要性 |
| --- | --- | --- | --- |
| AFF Advantage | Present situation / Inherency・Necessity | Planのeffect / Solvency・Process | Importance / Significance / Impact |
| NEG Disadvantage | Present situation / Uniqueness | Planからのeffect / Link・Process | Importance / Significance / Impact |

### 3.3 Attack / Defense / Summaryの制約

- Attackは、相手のAD/DAの証明のどこを攻撃しているかを必ず対象リンクとして持つ。例：not necessary / no effect / not important / not unique。
- Defenseは自陣のAD/DAを再構築する防御的スピーチ。新しいAD/DAや新しいAttackを追加した場合はNew Argument候補として検出する。
- Summaryは双方のAD/DAと反論・再反論を要約して最終比較を行う。新しいAttackは不可だが、試合全体の正当な比較は許容されるため、「新規議論」と「比較」を区別する。
- 否定アタック後の肯定アタック⑦では、直前の否定アタックへの再反論が禁止される。この制約もフラグ対象とする。

### 3.4 機械可読化するルール（v03で追加）

v02はスピーチ順とAD/DA構造までを機械可読化の対象としていた。大会ルールを読み直すと、判定に直結し、かつ確定transcriptから機械的に確認できる規定が他にもある。これらをruleset packに含める。

| ルール | 出典 | 機械化の内容 | 出力フラグ |
| --- | --- | --- | --- |
| スピーチ担当者表（A1〜A4／N1〜N4、3人／4人チーム別） | 2.2 | 各ステージの発言者が担当表と一致するかを照合 | speaker_role_mismatch |
| 立論600語・平均150 wpm上限 | 2.1.10 | 確定transcriptから語数と発話速度を算出 | over_word_limit / over_speech_rate |
| 終了後10秒ルール | 2.2.3 | ステージ終了時刻＋10秒以降の発話を判定対象外候補に | over_time |
| AD/DAは各側最大2 | 2.1.1.3 / 2.1.2.1 | 3つ目以降を主要2つ以外として除外候補に | extra_issue |
| 新しい議論の禁止 | 4.2.2 | Defense / Summaryでの初出要素を検出 | new_argument |
| 引用時に必ず述べる事項（出典・年度・氏名・肩書等） | 3.2.1 | 証拠引用の直前に必須要素が読み上げられているかを確認 | evidence_incomplete |
| 独自計算による推定値の扱い（2025年追加） | 3.2.1.1 | 「自分で計算した」宣言と、元データの出典読み上げの有無を確認 | own_calculation |
| コミュニケーション点1〜5 | 4.3 | 勝敗判定と分離して記録。減点事由は人が入力 | （勝敗と非連動） |

> **重要**  
> これらはすべて候補である。自動で判定から除外しない。大会ルール4.2.2は「新しい議論であるかどうかの判断は、相手チームからの抗議の有無に左右されず、ジャッジが行う」と明記している。アプリはジャッジの注意を向けるだけで、判断を代行しない。

## 4. システム構成（確定）

### 4.1 技術スタック

| 層 | 採用 | 理由 |
| --- | --- | --- |
| フロントエンド | Next.js（App Router）＋ React ＋ TypeScript | ai-english-debateと同一。AIコーディングエージェントの参照実装が安定しており、古い書き方が混入しにくい |
| 型・検証 | Zod | スキーマを唯一の定義とし、JSON Schemaを生成物として出す |
| DB | Supabase PostgreSQL（東京 ap-northeast-1） | リージョンは作成後変更できないため作成時に指定 |
| DB接続 | postgres.js ＋ Supavisor（transaction mode / 6543） | Data APIを使わないための正規経路。prepared statementは使えないためprepare: falseが必須（§4.2） |
| クエリ層 | Drizzle ORM ＋ drizzle-kit | 型がスキーマから出る。マイグレーションSQLをリポジトリに残せる |
| ストレージ | Supabase Storage（非公開バケット） | 署名付きURLとTUS resumable uploadを使う |
| 認証 | Supabase Auth | MVPはメール招待制。学校アカウントとRLSはPhase後半 |
| ホスティング | Vercel（Fluid compute） | Next.jsとの適合。実行時間上限を前提にジョブを設計する（§4.4） |
| API | Next.js Route Handler ＋ defineHandler | 全エンドポイントを同じ形で書く。認可・検証・楽観ロック・監査を一箇所に集約（第14章） |
| CI | GitHub Actions | 型・lint・単体・スキーマ検証・fixture回帰。音声を要するテストは入れない |
| 文書生成 | docx（npm） | 既存の文書生成資産と同じ。サーバでのPDF化は行わない |
| 転写 | TranscriptionProvider アダプタ | Pass A（単語時刻）とPass B（逐語）で別providerを許す（第6章） |
| 解析・判定支援LLM | サーバ側からのみ呼ぶ | APIキーをクライアントに出さない。出力は必ずsuggested層に入る |

### 4.2 DB接続方式（v04で確定）

v03には矛盾があった。「Data APIを無効にする」と書きながら、「service role keyでDBへアクセスする」とも書いていた。supabase-jsからのDBアクセスはPostgREST、つまりData API経由なので、この二つは両立しない。実装を始めた時点で必ず手が止まる。

| 用途 | 経路 | 認証情報 |
| --- | --- | --- |
| DB読み書き | Next.js Server → Supavisorプーラー（transaction mode / 6543）→ Postgres | DATABASE_URL（専用ロール app_server） |
| マイグレーション | CI → session mode（5432）または direct connection | DIRECT_URL（app_migrator） |
| Storage | サーバから署名URL発行・削除 | SUPABASE_SERVICE_ROLE_KEY |
| Auth | JWT検証、招待などの管理操作 | SUPABASE_SERVICE_ROLE_KEY |
| ブラウザ | Auth（ログイン）と Storage（TUSアップロード）のみ | NEXT_PUBLIC_SUPABASE_ANON_KEY |

> **実装で必ず踏む三つの落とし穴**  
> 1. transaction mode（6543）は prepared statement を使えない。postgres.js では prepare: false を必ず指定する。指定を忘れると本番でだけ落ちる。  
> 2. マイグレーションは session mode / direct（5432）で流す。transaction modeでは CREATE INDEX CONCURRENTLY などが通らない。  
> 3. postgres スーパーユーザーで接続するとRLSが素通りする。専用ロール app_server（NOSUPERUSER / NOBYPASSRLS）を作り、各リクエストのトランザクション冒頭で SET LOCAL app.actor_id を発行する。

service role key の用途は Storage と Auth に限定する。DBアクセスには使わない。これにより「ブラウザからDBへ到達する経路が存在しない」という状態を、設定ではなく構成で保証できる。

### 4.2.1 Supabaseプロジェクトは既存と分ける

ai-debate-matchが使っている既存プロジェクトに相乗りしない。保持するデータの機微度、削除・保持ポリシー、RLSとストレージポリシーの設計がいずれも違うためである。新規プロジェクトも東京リージョン、Data APIは無効のままとする。

### 4.3 実行時間の制約とジョブ粒度

Vercel FunctionsはFluid computeで既定300秒、Pro / Enterpriseで最大800秒（さらに長い枠はベータ）である。42分の音声を1回の同期呼び出しで処理する設計にしてはならない。

> **ジョブ粒度の原則**  
> 1ジョブ＝2〜4分の音声、または純粋な計算処理とする。300秒以内に確実に終わる粒度に割る。  
> 失敗したジョブだけを再実行できるようにする。全体をやり直さない。  
> ジョブは冪等にする。同じ入力で二度走っても結果が壊れない。

### 4.4 環境変数

| 変数 | 用途 | 公開範囲 |
| --- | --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | Supabaseプロジェクト | クライアント可 |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | 認証のみ | クライアント可 |
| SUPABASE_SERVICE_ROLE_KEY | Storage と Auth の管理操作。DBには使わない | サーバのみ |
| DATABASE_URL | DB読み書き（Supavisor transaction mode / 6543・app_server） | サーバのみ |
| DIRECT_URL | マイグレーション（session mode / 5432・app_migrator） | CIのみ |
| TRANSCRIBE_A_PROVIDER / TRANSCRIBE_A_KEY | Pass A（単語時刻） | サーバのみ |
| TRANSCRIBE_B_PROVIDER / TRANSCRIBE_B_KEY | Pass B（逐語） | サーバのみ |
| ANALYSIS_MODEL / ANALYSIS_KEY | 論点抽出・判定支援 | サーバのみ |
| RULESET_DEFAULT | 既定のruleset id（例：henda-20） | サーバのみ |
| JOB_CRON_SECRET | Vercel Cronからのジョブ実行認可 | サーバのみ |

## 5. メディアの入力・保管・再生

### 5.1 入力の原則

- 必須入力は音声（mp3 / m4a / wav）。動画は任意の付随情報として扱う。
- 動画しか手元にない場合は、ブラウザ内で音声を抽出してからアップロードする（§5.4）。サーバにffmpegを置かない。
- 公開動画の無断ダウンロード機能は実装しない。利用権限が確認できる入力経路のみを提供する。

### 5.2 ファイルサイズと料金プランの関係

この制約は設計に直接効くため、数字で確定させておく。Supabase Storageのグローバル上限は、Freeプランでは50MBを超えて設定できない。Proプラン以上では最大500GBまで設定できる。また6MBを超えるファイルはresumable upload（TUS）を使うことが推奨されており、専用ストレージホストを使うと大きなファイルの転送性能が上がる。

| 入力 | 42分あたりの概算サイズ | Freeプランで通るか |
| --- | --- | --- |
| 音声 mono 64 kbps（mp3 / m4a） | 約20 MB | 通る |
| 音声 mono 96 kbps | 約30 MB | 通る |
| 音声 stereo 128 kbps | 約40 MB | 通る（上限に近い） |
| 動画 mp4（720p 中程度） | 300 MB〜1 GB | 通らない。Pro以上が必要 |

> **入力規約（確定）**  
> MVPの入力規約は「音声・mono・64〜96 kbps・50 MB以下」とする。この規約なら、Supabase Freeプランのままでも1試合が最後まで通る。動画を保管したい場合のみPro以上を要求する。

### 5.3 保管とアクセス

- バケットは非公開。パスは media/{match_id}/{sha256}.{ext}。
- DBにはURLを保存しない。保存するのはパス、source_sha256、duration_ms、mime、bitrate、channels。
- 再生用の署名URLは短命（既定15分）とし、必要になった時点でサーバが発行する。
- 6MBを超えるアップロードはTUS resumable uploadを使い、直接ストレージホスト（project-id.storage.supabase.co）へ送る。

### 5.4 動画からの音声抽出

動画しかない場合、ブラウザ内でffmpeg.wasmを使い、16 kHz mono・64 kbpsの音声に変換してからアップロードする。この処理はユーザーの端末で走るが、特定のPCを要求するものではない。ブラウザさえあれば、どの端末でも同じように動く。

| 論点 | 決定 |
| --- | --- |
| SharedArrayBufferの要求 | 対象ページにCOOP / COEPヘッダを設定する。Next.jsのheaders設定で該当ルートのみに限定する |
| 対応する入力サイズ | 2 GB未満。これを超える動画は、ユーザー側で音声を書き出してから読み込ませる |
| 失敗時 | 抽出に失敗した場合は音声ファイルの直接指定へ誘導する。サーバ側でのフォールバック変換は行わない |
| 元動画の保管 | 任意。保管しない場合でも、再生位置は元動画のタイムコードと一致させる |

### 5.5 同一性の判定

同じ音声に対する再解析なのか、別の音声なのかを機械的に判定できるようにする。

- source_sha256：Web Cryptoでストリーミング計算した元ファイルのSHA-256。
- duration_ms と mime：補助的な一致確認に使う。
- whosaid-editorが持つBLAKE2b 64bitの音声指紋は、インポート時に import_meta.original_fingerprint として保持するだけとし、アルゴリズムは移植しない。

### 5.6 区間再生

ここはwhosaid-editorの操作感をそのまま持ち込む。ただし実装はブラウザ標準のメディア要素で行い、ffplayに相当するものは持たない。

| 機能 | 実装 | 既定値 |
| --- | --- | --- |
| 区間再生 | HTMLMediaElement の currentTime を区間先頭に置き、区間末尾で停止 | — |
| 前後の余白 | 区間の前後に余白を付けて鳴らす | 前1.0秒／後0.5秒 |
| 前後の確認 | 5秒前から／この先30秒 | whosaid-editorと同じ |
| キーボード操作 | Space：再生停止、↑↓：区間移動、Tab：未確認の次へ、Ctrl+S：保存 | 同上 |
| 再生速度 | 0.75 / 1.0 / 1.25 / 1.5 | 1.0 |

## 6. 転写パイプライン（確定）

### 6.1 解くべき問題

v02は「エンジンは差し替え可能にする」とだけ書いていた。実務上の要点は二つである。長尺を処理しきれるか、そして時刻が信用できるか。v03はここで2パスと4パスの表記が割れていた。v04は4パス（Pass A / S / B / C）に統一する。

whosaid-editorはこの二つ目で苦労しており、Geminiのタイムスタンプがドリフトする既知の問題に対して、按分補正（redistribute_times）と細切れ行の連結（merge_consecutive）で凌いでいる。その後、本文はGeminiの逐語モード、時刻はfaster-whisperの単語時刻という役割分離に到達した。同プロジェクトの技術方針書は、この分離が効いている理由を明確に書いている。whisperは時刻を測る物差しとしてしか使っていないため、whisperがフィラーを落としても本文からフィラーが消えることは構造的にない。

本アプリはこの結論をクラウドへ移す。ただし、クラウドでfaster-whisperを常時動かすのは第1章の三条件と相性が悪い。そこで、単語時刻を返すAPIをPass Aのproviderとして扱い、照合ロジックだけを自前で持つ。

### 6.2 4パス構成

| パス | 目的 | 入力 | 出力 | 実行単位 |
| --- | --- | --- | --- | --- |
| Pass A<br>アライン | 時刻の物差しを作る | 音声全体 | 単語と時刻の列 | 1ジョブ（provider側が長尺を処理） |
| Pass S<br>ステージ推定 | 12ステージ境界の候補を作る | Pass A出力＋定型句辞書＋公式時間 | 境界候補と信頼度 | 1ジョブ（純粋計算） |
| Pass B<br>逐語転写 | 判定に使う本文を作る | 音声＋ステージの時間範囲 | ステージ単位の逐語テキスト | 12ジョブ（ステージ単位） |
| Pass C<br>照合 | 本文と実測時刻を突き合わせる | Pass A出力＋Pass B出力 | 区間ごとの確定時刻と被覆率 | 1ジョブ（純粋計算） |

> **Pass Bをステージ単位に割る三つの効果**  
> 1. 1回の呼び出しが3分前後の音声に収まり、関数の実行時間内で確実に終わる。  
> 2. モデルに与える時間範囲が短くなるため、タイムスタンプのドリフトの絶対量が小さくなる。  
> 3. 失敗したステージだけを再実行できる。42分をやり直さなくてよい。

### 6.3 Pass Bの実装前提（Gemini）

Gemini APIは音声を1秒あたり32トークンとして扱う。42分の試合は約80,600トークンに相当する。1プロンプトあたりの音声長は最大約9.5時間であり、42分は余裕で収まる。また、MM:SS形式で範囲を指定した転写を要求できる。

- 音声はFiles APIへ1回だけアップロードし、以降はfile URIを使い回す。ステージごとに音声を切り出さない（＝ffmpegが不要になる）。
- 各ステージの呼び出しでは、Pass Sが決めた範囲をMM:SSで指定し、その範囲の逐語転写だけを求める。
- 逐語モードの指示（フィラー・言い直しを残す、整文しない）を必ず含める。
- コンテキストキャッシュの利用を前提にする。利用できない場合の入力トークン量は第18章で見積もる。

### 6.4 Pass Aのprovider要件と、話者分離が不要な理由

| 要件 | 内容 | 必須 |
| --- | --- | --- |
| 単語単位の時刻 | word / start / end の列を返す | 必須 |
| 長尺対応 | 42分以上を1リクエストで受ける、または非同期ジョブとポーリングを提供する | 必須 |
| URL入力 | 署名付きURLを渡せる（ファイル本体をサーバ経由で中継しない） | 推奨 |
| 話者分離 | 話者ラベルを返す | 不要 |

> **設計上の重要な差分**  
> whosaid-editorが解いていた最大の難問は「誰が言ったか」だった。会議では発言順が決まっていないため、声質クラスタと人手の突き合わせが必要になる。  
> HEnDAは違う。発言順は12ステージで固定され、どのスピーチを誰が担当するかは大会ルール2.2の担当者表で決まっている。したがってステージ境界さえ確定すれば、話者はほぼ自動的に決まる。  
> 本アプリは、話者割当に使っていた人手を「どの論点に対する発言か」の確定に振り向ける。これが本アプリとwhosaid-editorの役割の違いであり、UIの重心の違いでもある。

### 6.5 Pass Cのアンカー照合

whosaid-editorのanchor.pyは、正規化した本文と実測の単語列を区間ごとの時間窓の中で突き合わせ、一致した文字の時刻から区間の始まりと終わりを引き直す。全文どうしをdifflibに掛ける方式は52分の会議で66秒かかり、区間ごとに窓を切ると0.16秒で済むという実測がある。速さ以上に効くのは、窓の外にある同じ語句への誤マッチが構造的に起きなくなることである。

> **移植方針**  
> anchor.pyは純粋関数だけで書かれており、音声もモデルも要らず、テキストと単語のfixtureだけでテストできる。したがってTypeScriptへ移植したうえで、CIで完全に検証できる。音声系ロジックのうち、エージェントが自力で正しさを確認できる数少ない部分である。移植時は元実装のMITライセンス表記を残す。

- 窓幅：区間の推定時刻 ± 30秒を既定とする。
- 正規化：NFKC、記号落とし、大文字小文字の統一。元の位置へ戻る写像表を保持する。
- 被覆率が閾値（既定0.6）未満の区間は「照合できなかった」として返し、時刻を書き換えない。
- 補間による時刻推定は行わない。whosaid-editorが線形補間を試作したうえで不採用としている。

### 6.6 TranscriptionProvider インタフェース

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

export interface AlignProvider {          // Pass A
  readonly id: string;
  align(input: { signedUrl: string; durationMs: number }): Promise<AlignResult>;
}

export interface StageTranscribeProvider { // Pass B
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

契約テストを1本用意し、どのproviderを差しても同じ形の結果が返ることをCIで確認する。テストにはネットワークを使わないstub providerを用いる。

### 6.7 whosaid-editor 作業JSONの取り込み

ローカルで前処理を済ませたユーザーのために、.speakers.json（schema 5）を正式な入力として受け付ける。これによりPass A・Pass Bを省略でき、録音を外部へ送らずに本アプリの解析・判定支援だけを使う運用が成立する。

| whosaid-editor（schema 5） | 本アプリ | 備考 |
| --- | --- | --- |
| segments[].start / end | transcript_segments.start_ms / end_ms | 秒→ミリ秒 |
| segments[].text | text_ai（text_edited が true なら text_human） | 人手修正を人手として引き継ぐ |
| segments[].reviewed | role_status：true→human_confirmed、false→bulk_applied | ✓と△の意味論を保存する |
| segments[].time_reviewed | time_status：true→human_verified | 同上 |
| segments[].orig_start / orig_end | ai_start_ms / ai_end_ms | AIが出した元の時刻を残す |
| segments[].cluster / chunk | import_meta | 参考情報として保持のみ |
| speakers[] | 取り込み時に人がAFF/NEG・A1〜N4へ対応づける | 名簿と競技上の役割は別物 |
| source_sha256 | media_sources.source_sha256 | 同一音声かどうかの検証に使う |
| audio_fingerprint（BLAKE2b） | import_meta.original_fingerprint | アルゴリズムは移植しない |
| edit_log | edit_logs へ追記型で移送 | 履歴を切らない |

取り込み後もPass AとPass Cは任意で実行できる。時刻だけを検証したい場合に使う。取り込んだ人手確認済みの状態は、再解析で上書きしない。

## 7. レビュー状態モデル

### 7.1 whosaid-editorから継承する絶対原則

whosaid-editorのCLAUDE.mdは、壊してはならない設計原則を明示している。本アプリはドメインが違うが、原則はそのまま効く。

> **三つの絶対原則**  
> 1. 自動処理が「人が確認した」印を立てることは決してない。✓（人が耳で聴いて確定）と△（一括適用で埋めただけ）の区別が製品価値そのものである。  
> 2. 短い相づちやフィラーを自動削除しない。会議では同意の意思表示が消えるからだが、ディベートではさらに直接的で、「答えなかった」「沈黙した」「聞き返した」こと自体が判定材料になる。  
> 3. 点検・提案は本体データを自動で書き換えない。提案の適用は人の操作であり、適用結果はレビュー状態の意味論を壊さない。

### 7.2 4軸の状態

会議の議事録では「誰が言ったか」の1軸で足りたが、本アプリは判定に使うため軸を分ける。ひとつの区間について、次の4軸を独立に持つ。

| 軸 | 値 | 意味 | 誰が設定できるか |
| --- | --- | --- | --- |
| text_status | ai_draft / human_edited | 本文がAI出力のままか、人が直したか | human_editedは人のみ |
| time_status | unverified / derived / human_verified | unverified＝AI出力のまま、derived＝アンカー照合で引き直した、human_verified＝人が耳で確かめた | human_verifiedは人のみ |
| audibility | unknown / clear / partial / unheard | 人のレビューで実際に聞き取れたか | 人のみ |
| role_status | ai_suggested / rule_derived / human_confirmed | ステージと発言者の割当。rule_derived＝ステージ確定と担当者表から導出 | human_confirmedは人のみ |

v02は「Machine recognition / Human audibility / Debate meaning」の3層として同じ趣旨を書いていた。v03はそれをカラムに落とし、どの層をどの主体が書けるかまで確定させた。v04ではDBのCHECK制約でも担保する。transcript_segmentsにaudibility_set_byを持ち、audibilityがunknown以外ならこの列が必須である。ジョブや解析経路からはこの列を書けないため、AIはaudibilityをunknownから動かせない。

### 7.2.1 unknown の扱い（v04で確定）

unknownは「聞こえない」ではなく「まだ人が聞いていない」である。ここを曖昧にすると、本設計が最も避けたい事故が起きる。

| 場面 | 扱い |
| --- | --- |
| 解析View | 本文を表示する |
| Judge View | 本文を表示する。ただし「未確認」と明示する |
| 判定のロック | 根拠として引用されたsegmentにunknownが1件でも残っていたら、ロックできない |

Judge Viewでunknownの本文を隠す設計も考えられるが、それではレビュー前に何も読めず、作業が始められない。だから隠さず、ロックの段階で止める。またunknownへ戻すAPIは用意しない。clear / partial / unheardのいずれかを人が選んだ時点で、二度とunknownには戻らない。

### 7.3 Judge View と 解析View

大会ルールは、発音や速度のためにジャッジが聞き取れなかった箇所を、試合後に原稿や証拠資料を読んで補って判定してはならないとしている。この規定を画面で表現する。

| ビュー | audibility = unheard の区間 | 用途 |
| --- | --- | --- |
| Judge View | 本文を表示しない。「聞き取れなかった」と表示する | 判定作業。ジャッジが実際に得た情報だけを見る |
| 解析View | 本文を表示する（unheardの印付き） | 研修・解説・研究。何が起きていたかを確認する |

判定理由メモとJudge Sheetの生成はJudge Viewの内容のみを根拠にする。解説レポートは両方を使えるが、その場合は根拠がJudge View外であることを明示する。

### 7.4 再解析しても人手の結果を壊さない

- AI出力は *_ai 列、人手の結果は *_human 列に分けて持つ。表示は COALESCE(human, ai)。
- 再転写・再解析は *_ai 列だけを更新する。*_human 列には触れない。
- edit_logs は追記型。削除や上書きをしない。
- 再解析の前後で、human_verified / human_confirmed / human_edited の件数が減っていないことをテストで確認する。

## 8. ステージ自動区分

### 8.1 三つの信号を組み合わせる

| 信号 | 内容 | 強さ |
| --- | --- | --- |
| チェアパーソンの定型句 | 「Affirmative Constructive Speech」「Negative Attack Speech」等の宣言 | 強い。ただし大会差と言い換えがある |
| 公式時間 | 4分／3分／2分と準備時間1分・2分の並び | 中程度。単独で決めない |
| 「Please say your name and start」直後の名乗り | 各スピーチは名乗りから計測が始まる | 強い。境界の先頭を特定しやすい |

### 8.2 定型句辞書（D1チェアパーソンスクリプトより）

辞書はコードに埋め込まず、ruleset packの一部として外部定義する。大会ごとの言い換えに差し替えで対応するためである。

| 定型句（部分一致） | 対応 | 備考 |
| --- | --- | --- |
| Affirmative Constructive Speech | ①開始 | — |
| Questions from the Negative Side | ②または⑧ | 直前ステージで判別 |
| Negative Constructive Speech | ③開始 | — |
| Questions from the Affirmative side | ④または⑥ | 直前ステージで判別 |
| Negative Attack Speech | ⑤開始 | — |
| Affirmative Attack Speech | ⑦開始 | — |
| Affirmative Defense Speech | ⑨開始 | — |
| Negative Defense Speech | ⑩開始 | — |
| Affirmative Summary Speech | ⑪開始 | — |
| Negative Summary Speech | ⑫開始 | 最終スピーチ |
| preparation time | 準備時間 | 1分／2分は前後のステージで決まる |
| Please say your name and start | スピーチ開始直前 | 計測開始点の手掛かり |
| The debate is now over | 試合終了 | 以降は判定対象外 |

> **注意**  
> 「Questions from the Affirmative side」は④と⑥の両方で同じ文言が使われる。「Questions from the Negative」も②と⑧で重なる。文言だけでは区別できないため、直前に確定したステージと経過時間の両方を使って決める。ここを取り違えると、以降のフロー全体が1ステージずれる。

### 8.3 担当者表による検証

大会ルール2.2の担当表をrulesetに入れておくと、ステージ確定後に発言者の妥当性を機械的に確認できる。間違ったスピーカーがスピーチした場合、次のスピーチが終わった後に判明すると反則負けになる規定があるため、指導・研修上の価値も高い。

| ステージ | 肯定 4人 | 肯定 3人 | 否定 4人 | 否定 3人 |
| --- | --- | --- | --- | --- |
| ① 肯定立論 | A1 | A1 | — | — |
| ② 否定質疑 | — | — | N4 | N2 |
| ③ 否定立論 | — | — | N1 | N1 |
| ④ 肯定質疑 | A4 | A2 | — | — |
| ⑤ 否定アタック | — | — | N2 | N2 |
| ⑥ 肯定質疑 | A3 | A3 | — | — |
| ⑦ 肯定アタック | A2 | A2 | — | — |
| ⑧ 否定質疑 | — | — | N3 | N3 |
| ⑨ 肯定ディフェンス | A3 | A3 | — | — |
| ⑩ 否定ディフェンス | — | — | N3 | N3 |
| ⑪ 肯定総括 | A4 | A1 | — | — |
| ⑫ 否定総括 | — | — | N4 | N1 |

### 8.4 出力は候補、確定は人

- Pass Sは境界候補と信頼度を返す。信頼度が低い境界は画面で強調する。
- 人は波形と音を確認しながら境界をドラッグで微調整し、確定する。
- 確定後、担当者表から発言者が導出され、role_status は rule_derived となる。人が確認すれば human_confirmed になる。

## 9. デジタルフローシート

### 9.1 公式配置を踏襲する

紙のHEnDA Flow Sheetと行き来しやすいよう、独自の時系列表ではなく公式の配置を基本表示とする。各ボックスはクリックで原音・逐語記録・根拠へ戻れる。

> **フローの本質**  
> フローシートはきれいな要約ではなく、主張と根拠、そしてどの反論がどの論点に当たったかを追跡するための記録である。AIは要約し過ぎず、ClaimとGround / Evidenceを分け、反論の矢印を明示する。

### 9.2 フローの内部データ

| オブジェクト | 主な項目 | 役割 |
| --- | --- | --- |
| Issue | label（AD1 / AD2 / DA1 / DA2）、side、title | 主要論点。各側最大2 |
| ArgumentNode | kind、role（present / effect / importance）、text、stage_no、evidence_refs | Claim / Attack / Defense等の単位 |
| EvidenceRef | 引用内容、出典種別、出典要素の充足状況、transcript_segment_id | 根拠 |
| Question | type（confirmation / examination）、対象node | 質疑 |
| FlowLink | from_node、to_node、relation、confidence、review_status | 矢印 |
| SummaryLink | 総括で拾ったIssue、比較軸、相手Issueとの比較 | 最終比較 |
| RuleFlag | type、target、rationale、status | 判定除外候補 |

### 9.3 relation の語彙（確定）

| relation | 意味 | 許される方向 |
| --- | --- | --- |
| ATTACKS | 相手の証明要素を攻撃する | Attack → Claim |
| DEFENDS | 自陣への攻撃に再反論する | Defense → Attack |
| EXTENDS | 既出の論点を維持・強調する | Summary / Defense → Claim |
| COMPARES | AD群とDA群を比較する | Summary → Issue |
| QUESTIONS | 質疑で確認・検証する | Question → Claim / Attack |
| ANSWERS | 質疑に応答する | Answer → Question |
| CITES | 証拠を参照する | Node → EvidenceRef |
| DROPS | 反論されず、応答もされないまま残った | システムが導出（人が確認） |

### 9.4 AI提案の状態

| 状態 | 意味 | 表示 | 判定での扱い |
| --- | --- | --- | --- |
| suggested | AIが抽出・リンクしただけ | 灰色／点線 | 勝敗計算に自動確定しない |
| reviewed | 人間が原音・文脈を確認 | 青 | レビュー済みとして使用可 |
| confirmed | 人間がフロー上の意味まで確定 | 濃色／実線 | Judge Sheetの材料に使用 |
| excluded | New Argument等で判定から除外 | 赤取り消し線 | 解説には残すが勝敗に算入しない |

## 10. Judge Sheet と判定支援

### 10.1 公式Decision Making Chartを中心に置く

| 欄 | 公式表現 | アプリの支援 |
| --- | --- | --- |
| 1. List of issues | AD1 / AD2 / DA1 / DA2（各側最大2） | 主要論点だけを確定。3つ目以降は extra_issue として除外候補 |
| 2. Probability | Hi / Lo | 事実と証拠で構築され、Attack後もどこまで成立したかを候補提示 |
| 3. Value (Impact) | Large / Small | 重要性がどこまで説明・防御されたかを候補提示 |
| 4. Strength | Strong / Weak / None | Probability × Value の総合。人が確定 |
| 5. Compare | AD合計 と DA合計を比較 | AFF：AD ＞ DA、NEG：DA ≧ AD（公式シートの表記に従う） |
| 6. Voting Issue | AD1等の1ラベル | 投票を最も決定した論点。候補と根拠時刻を提示 |
| New Argument check | Yes / No | 後半の新規議論で判定が汚染されていないか |
| Communication | 1〜5の整数 | 勝敗とは別枠。減点事由は人が入力 |
| Best Debater | 1名 | 候補は出さない。人が入力する |

> **禁止事項**  
> HEnDA公式モードでは Strong / Weak / None 等を勝手に0〜100点へ置換しない。「砂山」「HP」「残存率」のような可視化は、学習・観戦用の補助表示としてのみ使用し、公式Judge Sheetの判定ロジックと混ぜない。

### 10.2 サーバ権威の原則

ai-english-debateで確立した原則を、そのまま持ち込む。判定に関わる状態を、AIやクライアントが直接書けるようにしてはならない。

| 対象 | 原則 | 理由 |
| --- | --- | --- |
| Issue key（AD1等）とnode id | サーバが割り当てる。AIに生成させない | AIが生成したキーは重複・揺れが起き、履歴の同一性が壊れる |
| confirmed / excluded 状態 | サーバのAPIだけが書ける | クライアントからの直接書き込みを許すと改竄経路になる |
| AD合計とDA合計の比較 | サーバで計算する | 判定の再現性を保つ |
| AIの出力 | 必ず suggested 層に入る | AIが確定状態を作れないことを構造で保証する |
| ruleset版・モデル版 | 実行時にサーバが記録する | どのルールとモデルで作られた判定かを後から追える |

### 10.3 判定ロックの不変条件（v04で追加）

判定を確定（ロック）できるのは、次をすべて満たすときだけとする。APIとDBトリガの両方で検査する。

- winner / voting issue / Communication Points / 判定理由が埋まっている。
- voting issueに対応するIssueがconfirmedである。
- 判定根拠として引用された全segmentのaudibilityが、clear / partial / unheardのいずれかに人間確定されている。
- candidateのまま放置されたRuleFlagがない（Phase B）。

> **三つ目がなぜ要るのか**  
> audibility = unknown は「まだ人が聞いていない」を意味する。これを許すと、AIの文字起こしを人間が聞いたものとして判定に使ってしまう。  
> 大会ルールは、発音や速度のためにジャッジが聞き取れなかった箇所を、試合後に原稿や証拠資料を読んで補って判定してはならないとしている。unknownを残したままのロックは、この規定を静かに破る。  
> 未確定が残る場合は 409 AUDIBILITY_UNRESOLVED を返し、該当segmentのidを添えて返す。UIはそこへ直接ジャンプする。エラーを出して終わりにしない。

「判定根拠として引用されたsegment」は、確定したIssueから確定したArgumentNodeを辿り、そのnode_segmentsを集めたものと定義する。定義をビューとして持ち、APIとトリガが同じ定義を参照する。

### 10.4 New Argument detector

New Argumentは勝敗に直結するため、AIが自動除外するのではなく候補として赤フラグを付ける。人が対象発言と過去のフローを比較し、confirm または reject する。

- Defense / Summaryで初めて現れたPlan・Advantage・Disadvantage
- Defense / Summaryで初めて出た新しいAttackの証拠
- 相手に反論機会がほとんどない段階での新規主張
- 一方で、既出議論のより深い比較や証拠比較は正当な比較として区別する

肯定アタック⑦での「直前の否定アタックへの再反論」も同じ枠組みで検出する。ただし、否定立論③にアタックに該当する議論が含まれていた場合は例外的に許されるため、フラグの説明文にその可能性を書き添える。

### 10.5 Communication / Intelligibility

発音や流暢さを勝敗の直接基準にしてはならない一方、議論が実際に伝わったかは重要であり、コミュニケーション点として1〜5の整数で別枠評価される。内容判定と伝達評価を分離する。

| 項目 | 記録 | 扱い |
| --- | --- | --- |
| Speech rate | 推定wpm、過度に速い区間 | 平均150 wpmを目安に警告候補。自動減点はしない |
| Word count | 立論の語数 | 600語超過は候補フラグ。超過部分の扱いは人が判断 |
| Audibility | 声量、ASR失敗、人が聞けたか | 聞き取れなかった議論はJudge Viewで不明瞭扱い |
| Clarity | 区切り、間、明瞭さ | コミュニケーション点のコメント候補 |
| Manner | 質疑の態度、妨害等 | 映像または人の確認が必要。音声だけで判定しない |
| Accent | 訛りそのもの | 勝敗理由にしない。聞き取れた／聞き取れないという結果のみ扱う |

## 11. 解説資料の生成

### 11.1 標準構成

解説はフローとJudge Sheetから機械生成し、すべての重要記述に時刻付き根拠を持たせる。

- 試合情報：Motion、日時、Round、AFF/NEG、メンバー、ruleset版
- 結論：Winner、Voting Issue、判定の要点（3〜5行）
- 議論マップ：AD1 / AD2 / DA1 / DA2ごとの立論→Attack→Defense→Summary
- Judge Decision Chart：Probability × Value = Strength
- 勝敗を分けた場面：タイムコード付きで2〜5箇所
- New Argument / Drop / 未応答等の注意点
- Communication Pointsの説明（勝敗理由とは分離）
- 指導用コメント：判定理由とは別枠
- 付録：確認済み文字起こしとフローの検証状態

### 11.2 判定理由とアドバイスを分ける

判定理由は試合内で実際に出た議論だけから作る。指導者としての改善提案や「こう言えばもっと強かった」は、別のAdvice欄へ分ける。この分離は、埼玉いなほカップに掲載されているジャッジ基準の三原則（公平性・客観性・説明責任）と、判定理由とアドバイスを区別して試合後に述べるという運用に直接対応する。

### 11.3 根拠の必須化

- 解説の各段落は、少なくとも1つのtranscript_segment_idを参照する。
- 参照のない主張文は生成しない。生成された場合はCIで検出して落とす。
- Judge Viewに存在しない内容を根拠にした段落には、その旨を明示する。

## 12. データモデル

### 12.1 テーブル一覧

| テーブル | 主なカラム | 性質 |
| --- | --- | --- |
| matches | id, motion, held_on, round, aff_team, neg_team, ruleset_id, ruleset_version, status | 試合 |
| match_members | match_id, side, seat（A1〜N4）, display_name, is_minor | 出場者 |
| media_sources | id, match_id, storage_path, source_sha256, duration_ms, mime, bitrate, channels | 不変 |
| imports | id, match_id, kind（whosaid_json）, payload_hash, imported_by, import_meta | 取り込み履歴 |
| transcription_jobs | id, match_id, kind（align / stage / anchor）, target_stage_no, status, attempt, provider_id, model, params_hash, lock_version | ジョブ |
| align_words | media_source_id, idx, word, start_ms, end_ms, confidence | Pass A出力。不変 |
| stage_segments | id, match_id, stage_no, type, side, seat, start_ms, end_ms, role_status, confidence | 12ステージ |
| transcript_segments | id, match_id, stage_no, idx, start_ms, end_ms, ai_start_ms, ai_end_ms, text_ai, text_human, text_status, time_status, audibility, coverage | 逐語記録 |
| issues | id, match_id, label, side, title, review_status | AD1〜DA2 |
| argument_nodes | id, match_id, issue_id, kind, role, stage_no, text, review_status | 議論単位 |
| evidence_refs | id, node_id, source_type, cited_elements（jsonb）, transcript_segment_id, completeness | 証拠 |
| flow_links | id, match_id, from_node, to_node, relation, confidence, review_status | 矢印 |
| rule_flags | id, match_id, type, target_ref, rationale, status, decided_by | ルール検査結果 |
| flow_runs | id, match_id, model, prompt_version, ruleset_version, created_at | 解析Run |
| judge_runs | id, match_id, flow_run_id, ruleset_version, model, voting_issue_draft, winner_draft | 判定Run |
| judge_issue_assessments | judge_run_id, issue_id, probability, value, strength, evidence_refs | Decision Chart |
| judge_decisions | id, match_id, winner, voting_issue, comm_aff, comm_neg, best_debater, reason, decided_by, locked_at | 人間の確定 |
| export_runs | id, match_id, flow_run_id, judge_decision_id, template_version, output_paths | 生成履歴 |
| edit_logs | id, match_id, entity, entity_id, before, after, actor, at | 追記型 |

### 12.2 不変・追記の原則

- media_sources と align_words は不変。更新しない。
- judge_runs と judge_decisions は別テーブル。AI案を人間の確定で上書きしない。
- edit_logs は追記のみ。DELETE と UPDATE をトリガで拒否する。
- export_runs は「どの確定版から生成したか」を保持し、同じ資料を後から再現できるようにする。

### 12.3 RLS方針

| 段階 | 方針 |
| --- | --- |
| MVP | Data APIを無効にしたまま運用し、DBアクセスはサーバ（service role）経由のみとする。RLSは有効化するが、実質の防御はサーバ側の認可で行う |
| 共有段階 | match単位のメンバーシップ表を作り、所属するmatchの行だけ読めるRLSを追加する |
| 学校運用 | 学校テナントを導入し、テナント境界でRLSを張る。ai-debate-matchのPhase 2と同じ考え方を使う |

## 13. コアスキーマ（確定）

スキーマの唯一の定義はZodとする。JSON Schemaはビルド時に生成し、docs/schemas/ へ出力する。手書きのJSON Schemaを別に持たない。

### 13.1 ruleset（henda-20）

```ts
// packages/core/src/ruleset/schema.ts
export const StageDef = z.object({
  no: z.number().int().min(1).max(12),
  type: z.enum([
    'AFF_CONSTRUCTIVE','NEG_QUESTIONS','NEG_CONSTRUCTIVE','AFF_QUESTIONS',
    'NEG_ATTACK','AFF_ATTACK','AFF_DEFENSE','NEG_DEFENSE',
    'AFF_SUMMARY','NEG_SUMMARY',
  ]),
  side: z.enum(['AFF','NEG']),
  durationSec: z.number().int().positive(),
  prepAfterSec: z.number().int().min(0),
  seat4: z.string(),           // 4人チームの担当（例 'A1'）
  seat3: z.string(),           // 3人チームの担当
  allowsNewIssue: z.boolean(), // 立論のみ true
  allowsAttack: z.boolean(),
  allowsDefense: z.boolean(),
  allowsComparison: z.boolean(),
});

export const Ruleset = z.object({
  id: z.literal('henda-20'),
  version: z.string(),                 // 例 '2025-11-28'
  maxIssuesPerSide: z.literal(2),
  constructiveMaxWords: z.literal(600),
  maxWordsPerMinute: z.literal(150),
  graceSecAfterBell: z.literal(10),
  communicationPoints: z.object({ min: z.literal(1), max: z.literal(5), integerOnly: z.literal(true) }),
  tieBreak: z.literal('NEG'),          // 優劣がつけられない例外時は否定側
  stages: z.array(StageDef).length(12),
  chairCues: z.array(z.object({ pattern: z.string(), stageNo: z.array(z.number()) })),
  evidenceRequirements: z.object({
    factData: z.array(z.string()),     // ['source','year']
    expert:   z.array(z.string()),     // ['name','credential']
    news:     z.array(z.string()),     // ['outlet','date']
  }),
});
```

### 13.2 flow

```ts
export const ReviewStatus = z.enum(['suggested','reviewed','confirmed','excluded']);

export const Issue = z.object({
  id: z.string(),                      // サーバ割当
  label: z.enum(['AD1','AD2','DA1','DA2']),
  side: z.enum(['AFF','NEG']),
  title: z.string().max(120),
  reviewStatus: ReviewStatus,
});

export const ArgumentNode = z.object({
  id: z.string(),
  issueId: z.string().nullable(),
  kind: z.enum(['CLAIM','ATTACK','DEFENSE','QUESTION','ANSWER','SUMMARY_POINT']),
  role: z.enum(['present','effect','importance','other']).nullable(),
  stageNo: z.number().int().min(1).max(12),
  text: z.string(),
  segmentIds: z.array(z.string()).min(1),   // 根拠時刻へ必ず戻れる
  reviewStatus: ReviewStatus,
});

export const FlowLink = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  relation: z.enum(['ATTACKS','DEFENDS','EXTENDS','COMPARES','QUESTIONS','ANSWERS','CITES','DROPS']),
  confidence: z.number().min(0).max(1),
  reviewStatus: ReviewStatus,
});

export const RuleFlag = z.object({
  id: z.string(),
  type: z.enum(['new_argument','extra_issue','over_time','over_word_limit',
                'over_speech_rate','speaker_role_mismatch','evidence_incomplete',
                'own_calculation','premature_rebuttal']),
  targetRef: z.string(),
  rationale: z.string(),
  status: z.enum(['candidate','confirmed','rejected']),
});
```

### 13.3 judge

```ts
export const IssueAssessment = z.object({
  issueId: z.string(),
  probability: z.enum(['Hi','Lo']),
  value: z.enum(['Large','Small']),
  strength: z.enum(['Strong','Weak','None']),
  segmentIds: z.array(z.string()),
});

export const JudgeRun = z.object({
  id: z.string(),
  matchId: z.string(),
  flowRunId: z.string(),
  rulesetVersion: z.string(),
  model: z.string(),
  assessments: z.array(IssueAssessment).max(4),
  votingIssueDraft: z.enum(['AD1','AD2','DA1','DA2']).nullable(),
  winnerDraft: z.enum(['AFF','NEG']).nullable(),
  newArgumentFlags: z.array(z.string()),
});

export const JudgeDecision = z.object({          // 人間の確定。AI案を上書きしない
  id: z.string(),
  matchId: z.string(),
  winner: z.enum(['AFF','NEG']),                // 引き分けは存在しない
  votingIssue: z.enum(['AD1','AD2','DA1','DA2']),
  commPoints: z.object({
    aff: z.number().int().min(1).max(5),
    neg: z.number().int().min(1).max(5),
  }),
  bestDebater: z.string().nullable(),
  reason: z.string().min(1),
  decidedBy: z.string(),
  lockedAt: z.string().datetime().nullable(),
});
```

> **スキーマ上で保証すること**  
> 引き分けを表現できないこと（winnerはAFFかNEGの二択）、コミュニケーション点が1〜5の整数であること、AD/DAが各側2件までであること、ArgumentNodeが必ず1つ以上のsegmentIdを持つこと。これらは公式ルールを型で強制する箇所であり、実装の都合で緩めない。

### 13.4 バージョニング

- ruleset.version は大会ルールの改定日（例：2025-11-28）を使う。
- スキーマの破壊的変更は一括で行う。散発的にフィールドを足さない（whosaid-editorの教訓）。
- 生成物 docs/schemas/*.json はCIで再生成し、差分があれば失敗させる。

## 14. API契約（v04で追加）

v03はZodスキーマ・DB・画面・PR分割まで細かく決めていたが、HTTP APIが定義されていなかった。本アプリは「confirmed / excluded / locked を書けるのはサーバのAPIだけ」と宣言している。つまりAPIがセキュリティ境界そのものであり、そこが未定義のままでは実装を始められない。

完全な契約は docs/API_SPEC.md に置く。本章はその要点である。

### 14.1 共通仕様

| 項目 | 規約 |
| --- | --- |
| ベースパス | /api/v1 |
| 成功応答 | { "data": ... } |
| 失敗応答 | { "error": { "code", "message", "details" } } |
| 認証 | Authorization: Bearer（Supabase Auth JWT）。サーバで検証しactor_idを得る |
| 認可 | actor_idが対象matchのメンバーであること。トランザクション内でSET LOCAL app.actor_idを発行し、RLSにも同じ値を渡す |
| 内部API | /api/v1/internal/* は X-Job-Secret のみ。JWTを受け付けない |
| 楽観ロック | lock_versionを持つ全エンティティの更新でexpectedVersionを必須にする。省略は400、不一致は409 |
| 冪等性 | 副作用のあるPOSTはIdempotency-Keyヘッダを必須にする。再送は既存結果を返す |

### 14.2 主なエラーコード

| code | HTTP | 意味 |
| --- | --- | --- |
| VALIDATION_FAILED | 400 | Zod検証失敗 |
| FORBIDDEN | 403 | matchのメンバーでない |
| VERSION_CONFLICT | 409 | expectedVersion不一致。currentVersionを返す |
| CONSENT_REQUIRED | 409 | 許諾未記録のまま解析しようとした |
| DECISION_LOCKED | 409 | ロック済みの判定を変更しようとした |
| AUDIBILITY_UNRESOLVED | 409 | 根拠segmentにaudibility = unknownが残っている |
| STAGES_NOT_CONFIRMED | 409 | ステージ未確定でPass Bを起動しようとした |
| NODE_WITHOUT_SEGMENT | 422 | segmentIdsが空 |
| INVALID_LINK_DIRECTION | 422 | relationの方向違反 |
| ISSUE_LIMIT_EXCEEDED | 422 | 片側3件目のIssue |
| RETENTION_PURGED | 410 | 保持期限切れで削除済みの層を要求した |

### 14.3 エンドポイントの骨格

| 領域 | 主なエンドポイント | 備考 |
| --- | --- | --- |
| Match | POST/GET/PATCH /matches、POST /matches/{id}/consent、PUT /members | 許諾未記録では解析を開始できない |
| Media | POST /media/upload-intent、POST /media、GET /media/{id}/playback-url | ファイル本体はAPIを通らない |
| Job | POST/GET /jobs、POST /jobs/{id}/retry、POST /internal/jobs/run | Idempotency-Key必須 |
| Stage | GET/PUT /matches/{id}/stages | confirmを書ける唯一の経路。seatはサーバが導出 |
| Transcript | GET /segments、PATCH /segments/{id}、POST /segments/{id}/audibility | audibilityは人だけが書ける。unknownへ戻すAPIはない |
| Flow | POST /flow/runs、POST /issues /nodes /links、POST /{entity}/{id}/review | reviewStatusを書ける唯一の経路が/review |
| Judge | POST /judge/runs、PUT /judge/decision、POST /judge/decision/lock | lockで不変条件を検査する |
| Export | POST /exports、GET /exports/{id} | locked済みの判定からのみ |
| Retention | PUT /retention、POST /purge | 第16章 |

### 14.4 サーバが決めること（リクエストで受け取らない）

- id（UUID）とIssueのlabel（AD1 / AD2 / DA1 / DA2）。
- reviewStatusの初期値。AI由来のものは常にsuggestedで入る。
- ステージ確定後のseat（担当者表から導出する）。
- AD合計とDA合計の比較結果。

> **実装上の要点**  
> LLMの応答スキーマに id / label / reviewStatus を含めない。含めると、いつか誰かがそのまま保存する。返させるのはtitleと根拠だけにする。

### 14.5 defineHandler

全エンドポイントを同じ形で書く。例外を作らない。素のRoute Handlerを直接書くと、次のどれかが必ず抜ける。

> **defineHandlerが担保する七つ**  
> 1. JWT検証 → actor  
> 2. トランザクション開始 → SET LOCAL app.actor_id（RLSがこの値を見る）  
> 3. Zod検証（params / body）  
> 4. expectedVersionの照合  
> 5. Idempotency-Keyの記録と再送判定  
> 6. 例外からエラーコードへの変換  
> 7. edit_logsへの追記（before / after / actor）

## 15. 画面設計

| 画面 | 主要UI | 目的 | 音の確認が必要か |
| --- | --- | --- | --- |
| A. 試合登録 | Motion / Round / 両チーム / 出場者（A1〜N4）/ ruleset選択 | 入力 | 不要 |
| B. メディア取り込み | ファイル選択、抽出（必要時）、アップロード進捗、指紋表示、whosaid JSON取り込み | 取り込み | 不要 |
| C. ステージ確認 | 波形＋定型句ヒット位置＋12ステージ境界のドラッグ調整 | 区間確定 | 必要 |
| D. Transcript Review | 左：区間一覧／中央：本文／右：再生・audibility・時刻確認 | 文字起こし確認 | 必要 |
| E. Flow Editor | 公式Flow Sheet型ボード、Argumentカード、矢印、RuleFlag | 議論追跡 | 一部必要 |
| F. Judge Assistant | Decision Chart、New Argument、Voting Issue、Communication | 判定支援 | 一部必要 |
| G. Explanation | 判定理由、タイムコード、勝敗を分けた場面、指導コメント | レポート確認 | 不要 |
| H. Export | Word（公式版・拡張版）、JSON、確定版ロック | 成果物出力 | 不要 |
| I. 履歴 | Run一覧、差分、再解析、監査ログ | 再現性 | 不要 |

最終列は第18章の受け入れ基準に直結する。「音の確認が必要」と書かれた画面は、CIが通っても人が確認するまで完了としない。

### 15.1 Flow Editorの操作方針

- セル内のカードを選ぶと、右ペインに原文・時刻・音声再生・AI根拠・確認状態を表示する。
- 矢印はカードのドラッグで引く。relationは引いた後に選ぶ。
- AI提案の矢印は点線。人が確認すると実線になる。
- 肯定側と否定側は色で分ける。紙のフローシートの慣習（肯定＝赤系、否定＝青系）に合わせる。
- キーボードだけで一周できること。Transcript Reviewと同じキー割り当てを使う。

## 16. セキュリティ・個人情報・権利

### 16.1 扱うデータの性質

本アプリは、未成年である高校生の音声と氏名を扱う。これは個人情報であり、扱いを誤ると事業そのものが止まる。クラウド完結にしたことで、データが外部サービスを経由する経路も増えている。

### 16.2 規約（確定）

| 規約 | 内容 | 強制方法 |
| --- | --- | --- |
| 実データをGitに入れない | 実試合の音声・映像・氏名・transcriptをリポジトリに置かない | .gitignore＋CIで音声/映像拡張子と大容量ファイルを検出して失敗させる |
| fixtureは合成データのみ | CIで使う正解データは架空の試合から作る（付録G） | レビュー規約。fixture配下に実データ由来のファイルを置かない |
| 外部送信先の明示 | どのAPIへ音声とテキストを送るかを画面に表示し、同意を得てから実行する | 取り込み画面での明示的な同意チェック |
| 未成年の同意 | 録音・利用の許諾（本人・保護者・学校）を試合単位で記録する | matchesに許諾の記録欄を設け、未記録では解析を開始できない |
| 段階的な保持 | 音声・transcript・氏名・フロー判定を別レベルとして扱い、試合単位で期限を設定できる | 保持レベルA〜E（§16.3）。削除順序をDBトリガで強制する |
| 非公開ストレージ | バケットは非公開。署名URLは短命 | バケット設定＋サーバでのURL発行 |
| APIキーの秘匿 | クライアントにキーを出さない | 外部API呼び出しはサーバ経由のみ |

> **クラウド完結にしたことの代償**  
> ローカル完結なら「録音を外に出さない」が成立する。クラウドにした以上、それは成立しない。だからこそ、送信先の明示と許諾の記録を任意ではなく必須の工程にする。録音を外部に出せない案件には、whosaid-editorでのローカル前処理と作業JSON取り込みという経路を用意する（§6.7）。

### 16.3 保持レベルと段階的削除（v04で追加）

v03は「音声を消してもフローと判定は残せる」とだけ書いていた。しかし個人情報になり得るのは音声だけではない。transcriptの本文、選手の氏名、判定理由に含まれる引用、監査ログの差分も同じである。したがって保持を5層に分け、試合単位で「何を、いつ消すか」を指定できるようにする。

| レベル | 内容 | 消したら失われるもの | 残るもの |
| --- | --- | --- | --- |
| A 音声・動画 | Storage上のメディア本体 | 原音での再確認、audibilityの再判定 | 時刻・本文・フロー・判定 |
| B transcript本文 | text_ai / text_human、align_words | 発言内容の閲覧、逐語記録としての価値 | ノードの要約・フロー構造・判定 |
| C 氏名・識別情報 | display_name、best_debater、本文中の人名 | 誰の試合かの特定 | 座席ラベル（A1〜N4）・構造・判定 |
| D フロー・判定 | issues / nodes / links / judge / 解説 | 議論構造と判定記録 | 匿名化された集計値 |
| E 匿名化統計 | 試合数、ステージ長、フラグ件数、一致率 | — | （最後まで残す層） |

- 削除は A → B → C → D の順にしか進めない。Dだけ消してBを残す、のような穴あきは許さない（Bが残っていれば実質的に復元できてしまうため）。
- 既定の保持期限は許諾の範囲から導く。校内練習なら音声90日・transcript1年、研修教材や研究なら氏名は試合終了時に即匿名化する。許諾に期限があればそちらが優先される。
- 削除はトランザクション内で完結させる。半分だけ消えた状態を作らない。
- UIは削除済みの層を「削除済み」と明示する。空欄にして「データがない」ように見せない。

> **見落としやすい二点**  
> 1. edit_logs を忘れない。追記専用にしてあるため、本文や氏名がここに残り続けると、消したつもりで残る。追記の原則は保ちつつ、削除に伴う差分の伏せ字化だけを専用関数に許可し、その操作自体も記録する。  
> 2. 本文中の人名を自動置換しない。スピーチには選手の名乗りが必ず入り、証拠資料の引用には専門家の氏名が入る。前者は消すべきで後者は消してはいけないが、機械的な人名検出では区別できない。名乗り区間を人が印付けし、その区間だけを伏せる。

詳細は docs/PRIVACY_RETENTION.md を正本とする。

### 16.4 権利

- 大会の映像・音声には、大会主催者・学校・出場者の権利が関わる。教材化・公開の前に権利者の確認を取る。
- 公開動画の無断ダウンロード機能は実装しない。
- 証拠資料そのもの（新聞記事等）を本アプリに保存・再配布しない。保存するのは引用の出典情報と、試合中に読み上げられた範囲のtranscriptである。

## 17. 開発ロードマップとPR分割

### 17.1 進め方の原則

- 1 PR = 1縦切り。受け入れ基準を満たしたことを確認するまで、次のPRへ進まない。
- 指示書を書くセッションと、実装するセッションを分ける。指示書は、書いた本人が口頭で補わなくても成立する程度に自足させる。
- 仕様変更は本書の改訂として行う。コードだけを先に変えない。
- ブランチは feature/xxx → PR → main。コミット履歴を残す。

### 17.2 縦切りを先に1本通す（v04で再構成）

v03のP0〜P16は、名前はMVPだったが実質はv1.0完成ロードマップだった。全機能の20%を作るのではなく、最終製品の全工程を細く1本通す方が、クラウドのコーディングエージェントとの相性がよい。工程のつなぎ目でこそ設計の齟齬が出るからである。

> **Phase A（縦切り）で扱う範囲**  
> 合成試合 → 音声取込 → ステージ確定 → Transcriptレビュー → AD1とDA1だけのFlow → Judge候補 → 判定確定とロック → 判定理由メモのWord出力。  
> Phase Aの間は AD1 と DA1 だけを扱う。relationも ATTACKS / DEFENDS / EXTENDS の三つだけ。  
> AD2・DA2、RuleFlag 9種、Communication、6成果物すべて、whosaid-editorインポート、保持と削除、監査は、すべてPhase Bへ送る。

### 17.3 PR一覧

| PR | 内容 | 主な受け入れ基準 | 検証 |
| --- | --- | --- | --- |
| P-1 | Gold Dataset v01（先行作業・実装ではない） | 正解Flow・正解Judge Sheet・正解判定理由まで揃う | 人 |
| P0 | 雛形、CI、DB接続（Supavisor / prepare: false）、マイグレーション | CIが緑。デプロイされたURLが開く。prepare設定を検証するテストがある | CI |
| P1 | rulesetとZodスキーマ、JSON Schema生成 | 壊したrulesetで必ず失敗する。再生成で差分ゼロ | CI |
| P2 | API基盤（defineHandler）と試合登録 | expectedVersion省略が400、不一致が409。他人のmatchがRLSで見えない | CI |
| P3 | メディア取り込み（TUS・指紋・署名URL） | ファイル本体がAPIを通過しない。sha256が一致する | CI＋人（G1） |
| P4 | ジョブ基盤（stub provider） | 冪等キーで二重実行が防げる。失敗ジョブだけ再実行できる | CI |
| P5 | Pass A（実provider接続） | 42分から単語時刻が取れる。契約テストが緑 | CI＋人 |
| P6 | Pass S（ステージ推定） | 境界誤差2秒以内、誤分類ゼロ。質疑の文言重複を判別できる | CI |
| P7 | ステージ確認UI | seatがサーバで導出される。人が確認するまでhuman_confirmedにならない | 人（G3） |
| P8 | Pass B（ステージ単位逐語） | 1ステージだけ再実行できる。未確定なら409。キャッシュ利用を確認できる | CI＋人（G4） |
| P9 | Pass C（アンカー照合・TS移植） | 音声なしのfixtureで完結。被覆率0.6未満なら書き換えない | CI（G2） |
| P10 | Transcript Review UI | audibilityを人だけが書ける。unknownへ戻すAPIがない。再解析でhuman_*が減らない | 人 |
| P11 | Flow最小（AD1 / DA1のみ） | segmentIds 0件のノードを作れない。reviewStatusは/reviewだけが書ける | CI＋人 |
| P12 | Judge最小と判定ロック | unknownが残ると409。AFF/NEG反転で判定が対称に反転する | CI＋経験者（G6） |
| P13 | 判定理由メモのWord出力 | 根拠なし段落ゼロ。2回生成して差分ゼロ | CI＋人 |
| ★G0 | 縦切り貫通ゲート | 合成試合1本が取り込みからWord出力まで通る | 人 |
| P14 | AD2 / DA2 と全relation | 片側3件目が422。DROPSが導出されsuggestedで出る | CI（G5） |
| P15 | RuleFlag 9種 | Recall 0.9以上。candidateが集計に影響しない。残っているとロックできない | CI |
| P16 | Communicationと語数・速度 | 勝敗の計算に一切入らない | CI |
| P17 | 6成果物すべて | すべてで根拠なし段落ゼロ | CI＋人 |
| P18 | whosaid-editorインポート | ✓と△の意味論が保存される。schema 5以外を422で拒否 | CI |
| P19 | 保持レベルと削除 | A→B→C→Dの順序を強制。edit_logsから本文と氏名が消える | CI＋人 |
| P20 | 履歴・再現・監査 | 同じ確定版から差分ゼロで再生成できる | CI（G7） |

### 17.4 実行環境の使い分け

開発をWeb版Claude Codeで完結させるという方針は変えない。ただし、音を聞く作業と実プロバイダのキーを使う作業は、そもそもクラウドのエージェントには不可能である。この二つだけをデスクトップ版に切り出す。

> **クラウドセッションに入っているもの**  
> Ubuntu 24.04（x86_64）、約4 vCPU / 16 GB RAM / 30 GB ディスク。  
> Node.js 20 / 21 / 22、Docker、chromedriver、そして PostgreSQL 16 と Redis 7 がプリインストールされている。  
> この最後の一点が効く。マイグレーション、RLSポリシー、トリガー、CHECK制約の検証は、本物のSupabaseに接続せずセッション内で完結する。

実Supabaseには接続しない。クラウドセッションの外向き通信はHTTP/HTTPSプロキシを通るため、Postgresワイヤプロトコルは届かない見込みであり、そもそもエージェントが実データベースを直接触れる状態を作るべきではない。本番へのマイグレーション適用はGitHub Actionsから行う。

クラウド環境には専用のシークレットストアがなく、環境変数はその環境を使う人全員から読める。したがってクラウド環境の設定にはシークレットを一つも置かない。その結果、ネットワークアクセスは既定のTrustedのままでよい。

| PR | 実行場所 | 理由 |
| --- | --- | --- |
| P-1 Gold Dataset | 執筆はどこでも／音声化はデスクトップ | 42分の音声を組み立てて聴く |
| P0・P1・P2・P4・P6・P9・P11・P12・P13 | Web | セッション内Postgresと純粋計算で完結する |
| P3・P7・P10 | Webで実装 → デスクトップで人の確認 | 再生位置・ステージ境界・audibilityは人の耳 |
| P5・P8 | デスクトップ / CI | 実プロバイダのキーが要る |
| ★G0 縦切り貫通 | デスクトップ | 全工程を人が通す |
| P14〜P20 | 原則Web（P17・P19に人の確認あり） | 印刷確認と削除後の見え方 |

> **見落とすと検証が空回りする点**  
> テーブルの所有者はRLSを素通りする。app_migratorがテーブルを所有し、app_serverにはGRANTだけを与える構成にすること。所有者と接続ロールを同じにすると、RLSのテストが通ったように見えて何も検証していない状態になる。念のためFORCE ROW LEVEL SECURITYも併用する。

デスクトップ版を使うこと自体は、第1章の三条件に反しない。破ってはいけないのは、CIが唯一の判定者であること、絶対パスや手元にしかないファイルをリポジトリの前提にしないこと、本番の認証情報をGitHub Actions Secretsにだけ置くこと、の三つである。whosaid-editorがC:\dev\01配下と導入済みffmpegを前提にしてしまった、あの状態を再発させないための線である。

### 17.5 着手順

P0を先に置く。理由は三つある。第一に、実データ混入を検出するCIが先に入っていないと、Gold Datasetを置いたときに検査の仕組みがない状態になる。第二に、P0は軽く、Web版が実際に使えるか（Postgres起動、セットアップスクリプトの5分制限、Playwrightでの再生位置アサート）を最初に確かめられる。第三に、P-1は原稿執筆と正解データ作成が主で、リポジトリの足場を必要としないため並行できる。

P1の受け入れテストには手書きの小さなfixtureを使う。Gold Datasetが必要になるのはP6（ステージ推定）からなので、そこまでにP-1が終わっていればよい。

### 17.4 最初にGold Dataset v01を作る

v02の「次の一手」は、実試合1本について人間が作った正解Flow・Judge Sheet・判定理由をGold Datasetにする、というものだった。方向は正しいが、クラウド完結では成立しない。実試合の音声と氏名はGitに置けず、CIから参照できないためである。

> **Gold Dataset v01（合成試合）**  
> 架空の論題で12スピーチの英語原稿を書く。AD2つ、DA2つ、Attack、Defense、Summaryを含め、意図的にNew Argument・語数超過・担当者違反・証拠要素の欠落を1〜2箇所ずつ仕込む。  
> 原稿をTTSで音声化し、チェアパーソンのアナウンスと準備時間も含めて42分の1ファイルに組み立てる。これもクラウドで完結する。  
> 原稿は正解transcriptそのものになる。正解Flow、正解RuleFlag、正解Judge Sheet、正解判定理由を人が作る。  
> この一式をリポジトリに置く。公開できる合成データなので、権利と個人情報の問題がない。

実試合での検証は別に行う。ただしそれはCIの外側であり、人が実施して結果だけを記録する。

## 18. 受け入れ基準と品質ゲート

### 18.1 機械が検証すること

| 対象 | 指標 | 合格条件 |
| --- | --- | --- |
| ruleset整合 | 12ステージ・担当者表・時間の一貫性 | 壊したfixtureで必ず失敗する |
| スキーマ | Zod検証、JSON Schema生成の一致 | 差分ゼロ |
| ジョブ | 状態遷移、冪等性、部分再実行 | 二重実行で結果が変わらない |
| アンカー照合 | 合成fixtureでの時刻誤差 | 中央値0.5秒以内、被覆率閾値未満は書き換えなし |
| ステージ推定 | 合成試合での境界誤差とステージ誤分類 | 誤差2秒以内、誤分類ゼロ |
| ルール検査 | New Argument等のPrecision / Recall | Recall 0.9以上、Precisionは記録して人が判断 |
| Issue抽出 | AD/DAラベル一致、present / effect / importanceの抽出 | 合成試合で一致率を記録 |
| Flowリンク | Attack→対象Claim、Defense→Attackの一致率 | 同上 |
| 出力 | 6成果物の生成、根拠なし段落の不在 | 根拠なし段落ゼロ |
| 人手の保存 | 再解析前後でhuman_*件数が減らない | 減っていたら失敗 |
| データ保護 | 音声・映像拡張子と大容量ファイルの混入 | 検出したら失敗 |
| 許諾 | 許諾未記録のmatchでのジョブ作成 | 409 CONSENT_REQUIRED で拒否される |
| ロック不変条件 | 根拠segmentにunknownが残る状態でのロック | 409 AUDIBILITY_UNRESOLVED。該当segment idが返る |
| audibilityの書き手 | ジョブ・解析経路からaudibilityを書こうとする | DBのCHECKで失敗する |
| DB接続方式 | postgres.jsのprepare設定、supabase-jsのDB利用 | prepare: false であること。DBアクセスにsupabase-jsを使っていないこと |
| RLS | 他人のmatchへのアクセス | アプリの分岐を外してもRLSで見えないこと |
| 楽観ロック | expectedVersionの省略・不一致 | 省略は400、不一致は409 |
| ノードの根拠 | segmentIds 0件でのノード作成 | 422とDB遅延制約の両方で失敗する |
| 保持と削除 | A→B→C→Dの順序、edit_logsの伏せ字化 | 順序違反が拒否される。B削除後にedit_logsにも本文が残らない |

> **negative testを必ず書く**  
> ruleset整合・ロック不変条件・audibilityの書き手・RLS・ノードの根拠は、いずれも「拒否されること」を確かめるテストである。正しいデータで通るだけのテストは、ルールを守れているかを検証していない。

### 18.2 人が検証すること

| 対象 | 確認方法 | 誰が |
| --- | --- | --- |
| 区間再生の位置 | 無作為に10区間を再生し、意図した発言が鳴るか | 開発者または利用者 |
| ステージ境界 | 12境界すべてを実音で確認 | 利用者 |
| audibility | 聞き取れない箇所の判断 | ジャッジ |
| 逐語の忠実さ | フィラー・言い直し・沈黙が残っているか | 利用者 |
| 判定支援の妥当性 | Decision Chart候補とVoting Issue候補が納得できるか | HEnDA経験者 |
| 解説の妥当性 | 教材として使えるか、判定理由とアドバイスが分離されているか | HEnDA経験者・指導者 |
| 公式版の印刷 | 用紙・余白・表幅が崩れないか | 利用者 |
| 削除後の見え方 | 削除済みの層が「削除済み」と明示されているか | 利用者 |

### 18.3 品質ゲート

| ゲート | 内容 | 通過条件 |
| --- | --- | --- |
| G1 取り込み | 音声が入り、再生できる | 実音声1本で、人が10区間の再生位置を確認 |
| G2 時刻 | アンカー照合が機能する | 合成fixtureで誤差中央値0.5秒以内 |
| G3 ステージ | 12ステージを安定して切れる | 合成試合で誤分類ゼロ、実試合1本で人が全境界を承認 |
| G4 逐語 | 判定材料を落としていない | 実試合1本で、重要論点の聞き落としがないことを人が確認 |
| G5 フロー | 議論の矢印が追える | 合成試合でリンク一致率を記録し、人が実試合1本で承認 |
| G6 判定 | Judge Sheetが埋まり、理由が説明できる | HEnDA経験者2名が、判定理由の説明可能性を承認 |
| G7 再現 | 同じ確定版から同じ資料が出る | 2回生成して差分ゼロ |
| ★G0 縦切り貫通 | 合成試合1本が最後まで通る | 取り込み→ステージ確定→レビュー→AD1/DA1のFlow→判定ロック→Word出力→再生成で差分ゼロ |

> **★G0 が最も重要なゲートである**  
> Phase Aの終わりに置く。ここを通るまでPhase Bへ進まない。  
> 工程のつなぎ目でこそ設計の齟齬が出る。全機能の20%を作ってからつなぐより、細くても最初から最後まで通っている状態を早く作る方が、齟齬を早く見つけられる。  
> 通ったら、実試合1本で同じ流れを人が試す。合成データでは検証できないもの（audibility、実際の英語の聞き取りやすさ）はここで初めて分かる。

> **KPIの置き方**  
> Winner一致率だけを最重要KPIにしない。人間ジャッジ同士でも判断は割れる。重視するのは、どのFlowを見て、どのIssueをVoting Issueとしたかを説明できることである。

## 19. コスト

### 19.1 呼び出し回数とトークン量を確定する

単価は変動する。設計書に単価を書き込むと、書いた瞬間から古くなる。v03は「何回・どれだけ呼ぶか」だけを確定し、単価は設定ファイルに置く。

| 項目 | 1試合（42分）あたりの量 | 備考 |
| --- | --- | --- |
| Pass B 音声入力トークン | 42分 × 60秒 × 32トークン ＝ 約80,600トークン／1回 | Geminiは音声1秒を32トークンとして扱う |
| Pass B 呼び出し回数 | 12回（ステージ単位） | file URIを再利用。範囲をMM:SSで指定 |
| Pass B 入力の上限 | 約967,000トークン | コンテキストキャッシュが効かない最悪ケース |
| Pass B 出力トークン | 英語約6,000語＋タイムスタンプ ≒ 12,000トークン前後 | 逐語モードのため整文分の削減はない |
| Pass A | 音声42分 × provider単価 | 分課金のproviderを想定 |
| 解析・判定支援LLM | 確定transcript（約6,000語）＋プロンプト、3〜6回 | 論点抽出、リンク付け、ルール検査、判定候補、解説 |
| ストレージ | 音声 約20〜30 MB／試合 | 動画を保管する場合は別枠 |

- 単価は config/pricing.json に外出しし、scripts/estimate-cost.ts が1試合あたりの見積りを出す。
- 実行時には実際のトークン量と所要時間をjobに記録し、見積りと実績を比較できるようにする。
- コンテキストキャッシュの有無で入力量が一桁変わるため、P8の受け入れ基準にキャッシュ利用の確認を含める。

### 19.2 インフラの下限

| 用途 | 最小構成 | 上げる条件 |
| --- | --- | --- |
| Supabase | Free（音声のみ・50MB以下の入力規約を守る場合） | 動画を保管する、または保存容量が上限に近づいたらPro |
| Vercel | Hobby（Fluid computeの既定300秒で足りる粒度に割ってある） | 実行時間300秒で足りないジョブが出たらPro（最大800秒） |
| 外部API | 従量課金 | — |

*Vercel Hobbyは個人利用の範囲である。学校や大会での運用に入る段階でPro以上へ移行する。*

## 20. リスクと設計上の防波堤

| リスク | 問題 | 対策 |
| --- | --- | --- |
| エージェントが音を確認できない | テストが通っただけで「動いた」と報告される | 受け入れ基準を二分し、音に関わるPRは人間検証を必須にする（第17章） |
| AI要約が議論を単純化 | 重要なQualifier・Evidence・例外条件が消える | ArgumentNodeにsegmentIdを必須化。要約だけで判定しない |
| ASR誤認識 | 聞き取れる英語を機械だけが落とす | audibilityを独立させ、原音レビューを通す |
| 聞き取れない発言の補完 | AI推測で「言ったこと」にしてしまう | Judge Viewでは補完禁止。unheardを明示 |
| New Argument誤判定 | 正当な比較を除外してしまう | AIは候補のみ。人のconfirmが必要 |
| 独自数値採点への逸脱 | HEnDA公式判定と別物になる | 公式Judge Sheetのカテゴリを正本とする |
| ステージが1つずれる | 質疑の文言が重複しており、取り違えるとフロー全体が壊れる | 直前ステージと経過時間の両方で判別。境界は人が確定（§8.2） |
| 長時間ジョブのタイムアウト | 42分を1回で処理して落ちる | 1ジョブ＝2〜4分。冪等な部分再実行 |
| 無料枠の50MB上限 | 動画やビットレートの高い音声が入らない | 入力規約（mono 64〜96 kbps）。動画はPro以上 |
| 実データがGitに入る | 個人情報の流出 | .gitignore＋CI検査＋fixture合成規約 |
| providerの仕様変更 | 転写が止まる | adapterに隔離し、契約テストで検出する |
| whosaid-editorとのスキーマ乖離 | インポートが壊れる | 対応スキーマをschema 5に固定。変換層をひとつに集約 |
| Data APIとservice roleの取り違え | supabase-jsでDBへ入る実装が混入し、Data API無効の前提が崩れる | DBアクセスをSupavisor経由に一本化。CIでsupabase-jsのDB利用を検出する（§4.2） |
| unknownのまま判定を確定 | AIの文字起こしを人が聞いたものとして判定に使ってしまう | ロック不変条件。根拠segmentにunknownが残る間はロックできない（§10.3） |
| APIを通さない書き込み経路 | confirmedやlockedを迂回して書ける穴ができる | 全エンドポイントをdefineHandlerで書く。素のRoute Handlerを禁止する（第14章） |
| 消したつもりで残る | transcriptや氏名がedit_logsや生成物に残る | 保持レベルA〜Eと、edit_logsの伏せ字化（§16.3） |
| MVPが太る | 全工程が通らないまま機能だけ増える | Phase Aは縦切り。AD1/DA1のみ。★G0を通るまでPhase Bへ進まない（§17.2） |
| 既存2アプリの肥大化 | 責務が混ざり保守困難 | 新規リポジトリとして独立。共有はcore / schema単位 |

## 21. 将来：観戦型ゲームへの接続

観戦型ゲームはv03の目的ではないが、構造化Flowが完成すれば自然に接続できる。ゲーム側は勝敗を演出の都合で作るのではなく、確定Flowイベントを読むだけにする。

| 解析イベント | 将来の演出 |
| --- | --- |
| confirmed ATTACKS | 対象論点への矢印と実況表示 |
| confirmed DEFENDS | 再構築・盾の表示 |
| DROPS | 警告と解説 |
| EvidenceRef | 証拠カードの表示 |
| Summary COMPARES | 最終比較ボード |
| JudgeDecision | Probability / Value / Strengthの視覚化 |
| Communication | 内容とは別メーターで伝達性を表示 |

## 付録A. HEnDA Flow Sheetの画面マッピング

紙のFlow Sheetに近い横のつながりを保つ。細いQ&A列も、Attackの対象を特定する重要情報として省略しない。

| 肯定側の行 | 内容 |
| --- | --- |
| ① AFF Constructive | AD1 / AD2（present / effect / importance） |
| ② NEG Q&A | 否定側質疑（細い列） |
| ⑤ NEG Attack | → AD への攻撃 |
| ⑥ AFF Q&A | 肯定側質疑（細い列） |
| ⑨ AFF Defense | AD再構築 |
| ⑪ AFF Summary | 比較と要約 |

| 否定側の行 | 内容 |
| --- | --- |
| ③ NEG Constructive | DA1 / DA2（present / effect / importance） |
| ④ AFF Q&A | 肯定側質疑（細い列） |
| ⑦ AFF Attack | → DA への攻撃 |
| ⑧ NEG Q&A | 否定側質疑（細い列） |
| ⑩ NEG Defense | DA再構築 |
| ⑫ NEG Summary | 比較と要約 |

各セル内に Claim / Evidence / Attack / Defense のカードを縦に並べ、対象関係を矢印で表示する。カードを選ぶと右ペインに原文・時刻・音声再生・AI根拠・確認状態が出る。

## 付録B. Judge Sheet入力マッピング

| Issue | Probability | Value | Strength | 根拠（アプリ拡張） |
| --- | --- | --- | --- | --- |
| AD1 | Hi / Lo | Large / Small | Strong / Weak / None | EvidenceRef＋timecode |
| AD2 | Hi / Lo | Large / Small | Strong / Weak / None | EvidenceRef＋timecode |
| DA1 | Hi / Lo | Large / Small | Strong / Weak / None | EvidenceRef＋timecode |
| DA2 | Hi / Lo | Large / Small | Strong / Weak / None | EvidenceRef＋timecode |

公式シートには根拠時刻の欄はないが、アプリ上では必須とする。出力時は（A）公式レイアウトに近いシートと、（B）時刻・根拠を含む拡張版の2種類を生成する。公式版は印刷しても崩れないよう、用紙と余白と表幅を固定する。

## 付録C. 参照資料と優先順位

ルール解釈が競合した場合は、古い解説記事よりも第20回大会ルールと現行HEnDA様式を優先する。

| 優先 | 資料 | v03で使う内容 |
| --- | --- | --- |
| 最優先 | 第20回 全国高校生英語ディベート大会 大会ルール | スピーチ順、AD/DA、Attack / Defense / Summary、担当者表、語数と速度、10秒ルール、証拠の要件、判定、新規議論、Communication |
| 最優先 | HEnDA Judge Sheet | Decision Making Chart、Voting Issue、Winner、Communication Points、Best Debater |
| 最優先 | HEnDA Flow Sheet | 画面配置とステージ対応 |
| 補助 | D1 チェアパーソンスクリプト | 定型句辞書、進行、名乗りと計測開始、10秒の運用 |
| 補助 | ジャッジ基準（埼玉いなほカップ掲載） | fairness / objectivity / accountability、判定理由とアドバイスの分離、5ステップの判定手順 |
| 補助 | フローシートを上手に書くコツ | Claimと根拠の分離、矢印、色分け、記号化などUXの参考 |

## 付録D. 参照リポジトリ

### whosaid-editor

https://github.com/sukeko1113/whosaid-editor（公開・MIT License）

日本語会議音声の逐語反訳＋話者割当エディタ。Python 3.12＋Tkinter、Windowsデスクトップ。転写はGemini API。製品価値は転写速度ではなく「誰が言ったかの検証済み記録」。

| 継承するもの | v03での位置づけ |
| --- | --- |
| ✓と△の意味論（人が聴いて確定／一括適用で埋めただけ） | 第7章のレビュー状態モデルの土台。軸を4本に拡張して継承 |
| 提案と本体データの分離（自動点検パイプライン） | AI提案はsuggested層に入り、自動適用しない（§10.2） |
| anchor.py の区間ごと時間窓による文字アンカー照合 | TypeScriptへ移植。純粋関数のためCIで完全検証できる（§6.5） |
| 本文と時刻の役割分離（Gemini＋faster-whisper） | Pass A（時刻）とPass B（本文）の役割分離として継承（§6.2） |
| 作業JSON schema 5 | インポート経路として正式サポート（§6.7） |
| 短い相づちを自動削除しない方針 | ディベートでは沈黙と未応答が判定材料になるため、さらに厳格に適用 |
| スキーマ変更は一括で行う | 第13.4節の規約として継承 |

- 継承しないもの：Tkinter GUI、PyInstaller / Inno Setupのビルド系、ffmpeg / ffplayへの依存、BLAKE2b音声指紋、ローカルASR（sherpa-onnx等）の導入計画。
- 移植時はMIT Licenseの表記を残す。なお現行のLICENSEファイルは著作権者名が仮置き（[Your Name]）のままである。移植の前に実名へ更新しておくのが望ましい。

### ai-english-debate

https://github.com/sukeko1113/ai-english-debate（非公開）

継承するのは、Next.js / TypeScript / PostgreSQL構成、サーバ権威の原則、答案と採点Runの分離、evidence付き採点、再採点と上書き履歴の分離、DBアクセスの分離である。

### ai-debate-match

HEnDA 12セクションの状態機械を実装したPhase 1の資産。ステージ順序・時間・役割の扱いに共通点があるため、ruleset定義の書き方とテストの当て方を参考にする。ただしコードは共有せず、本アプリは独立したリポジトリとする。

## 付録E. HEnDA名称・ルール利用に関する確認事項

本アプリは大会ルールと公式様式を正本として動作する。名称と様式の扱いについては、実装が一定程度進んだ段階でHEnDAへ確認する。確認が取れるまでは、次の方針で進める。

| 項目 | 確認前の方針（Plan B） | 確認後にできること |
| --- | --- | --- |
| リポジトリ・製品名 | ai-debate-analyzer。名称にHEnDAを使わない | 正式名称・ロゴの利用可否を確認のうえ変更 |
| ruleset id | henda-20（内部識別子として使用） | 版の更新方法と告知経路を確認 |
| Judge Sheet / Flow Sheetの様式 | レイアウトを踏襲した独自版を生成する。公式様式の画像・PDFを同梱しない | 公式様式の再現・配布の可否を確認 |
| 大会での利用 | 個人・校内での練習と研修に限定 | 大会運営での利用、ジャッジ研修での利用を相談 |
| ルール本文 | 本文をアプリに埋め込まず、条項番号と要約で参照する | 引用範囲を確認 |

## 付録F. Claude Codeへ渡す文書構成

実装セッションが本書を読まずに進むことがないよう、リポジトリ内の文書構成を固定する。

```ts
ai-debate-analyzer/
├─ CLAUDE.md                  # 絶対に守る設計原則。短く、破ってはいけないことだけ
├─ docs/
│  ├─ BASIC_DESIGN_v04.md     # 本書
│  ├─ HENDA_RULESET.md        # 条項番号と機械可読化の対応
│  ├─ DATA_MODEL.md           # テーブルと制約
│  ├─ TRANSCRIPTION.md        # 4パス構成（A / S / B / C）とprovider契約
│  ├─ API_SPEC.md             # HTTP API契約。セキュリティ境界そのもの
│  ├─ PRIVACY_RETENTION.md    # 保持レベルA〜Eと段階的削除
│  ├─ DEV_ENVIRONMENTS.md     # Web版/デスクトップ版の使い分け
│  ├─ REVIEW_SEMANTICS.md     # 4軸の状態と、壊してはならない規則
│  ├─ JUDGE_LOGIC.md          # Decision Chartとサーバ権威
│  ├─ ACCEPTANCE.md           # 機械検証／人間検証の二分と品質ゲート
│  └─ TASKS.md                # Phase A（P0〜P13）／Phase B（P14〜P20）
├─ .claude/settings.json      # SessionStartフック（リポジトリに置く。~/.claude は届かない）
├─ .env.example               # 環境変数の一覧と置き場所
├─ packages/core/             # ruleset / schema / anchor / rules / db（UIに依存しない）
├─ app/                       # Next.js App Router
├─ schemas/                   # 生成物。手書きしない
├─ fixtures/gold-01/          # 合成試合。音声・原稿・正解一式
├─ drizzle/                   # マイグレーションSQL（生成物だがコミットする）
└─ scripts/                   # setup-cloud-env / install_pkgs / generate-schemas
                              # estimate-cost / check-no-real-data
```

### CLAUDE.mdに書く絶対原則（案）

- 自動処理が human_verified / human_confirmed / human_edited を立てることは決してない。
- AIの出力は必ず suggested に入る。confirmed / excluded を書けるのはサーバのAPIだけ。
- 短い相づち・フィラー・沈黙を自動削除しない。
- ArgumentNodeはsegmentIdを1つ以上持たなければならない。根拠に戻れない議論は保存しない。
- 再解析は *_ai 列だけを更新する。*_human 列に触らない。
- audibility = unknown を含む判定はロックできない。unknownは「まだ人が聞いていない」の意味である。
- audibilityを書けるのは人だけ。ASRのconfidenceを代用にしない。
- DBアクセスはSupavisor経由のPostgres接続だけ。supabase-jsをDBに使わない。service role keyはStorageとAuth専用。
- 素のRoute Handlerを直接書かない。defineHandlerを通す。
- クラウドセッションから実Supabaseへ接続しない。DBの検証はセッション内Postgresで行う。
- デスクトップ指定のPRを、Webで「動いた」と報告しない。
- 実音声・実名・実試合データをリポジトリに置かない。
- スキーマの破壊的変更は一括で行う。散発的に足さない。
- 受け入れ基準を満たしたことを確認するまで次のPRへ進まない。
- 設計書と食い違う実装をしたくなったら、勝手に変えず相談する。

## 付録G. Gold Dataset v01の作り方

CIで回帰を取るには、公開できる正解データが要る。実試合は権利と個人情報の理由でリポジトリに置けないため、架空の試合を作る。

| 手順 | 内容 | 成果物 |
| --- | --- | --- |
| 1. 論題を作る | 実在の政策論題を避け、架空だが構造が明確な論題を1つ作る | motion.md |
| 2. 原稿を書く | 12スピーチ分の英語原稿。AD2つ、DA2つ、Attack、Defense、Summary。立論は600語未満に収める | speeches/01〜12.md |
| 3. 違反を仕込む | New Argument 1件、語数超過 1件、担当者違反 1件、証拠要素の欠落 2件を意図的に含める | violations.json |
| 4. 音声化 | TTSで各スピーチを読み上げ、チェアパーソンのアナウンスと準備時間を挟んで42分に組み立てる | gold-01.mp3（mono 64 kbps） |
| 5. 正解を作る | 正解transcript（原稿そのもの）、正解ステージ境界、正解Flow、正解RuleFlag、正解Judge Sheet、正解判定理由 | gold/*.json |
| 6. 固定する | 音声のsha256を記録し、CIで同一性を確認する | gold-01.sha256 |

> **合成データの限界を承知しておく**  
> TTS音声は明瞭すぎるため、audibilityの検証には使えない。実際の高校生の英語・訛り・声量・雑音は再現できない。  
> したがってGold Datasetで検証できるのは、ステージ区分、時刻照合、論点構造、ルール検査、集計、出力までである。  
> 聞き取りやすさに関わる機能（audibility、Communication、実運用でのASR精度）は、許諾を得た実試合で人が確認する。その結果はリポジトリではなく、別管理の検証記録に残す。

> **次の一手**  
> 1. 本書の内容で合意する。特に、DB接続方式（§4.2）、4パス構成（第6章）、判定ロックの不変条件（§10.3）、保持レベル（§16.3）、Phase A / Bの分割（§17.2）は、後から戻すと作り直しになる。  
> 2. リポジトリ ai-debate-analyzer を作り、付録Fの文書構成を置く。本書をBASIC_DESIGN_v04.mdとして入れる。  
> 3. Gold Dataset v01（付録G）を作る。これがP1以降すべての受け入れテストの土台になる。  
> 4. P0（雛形・CI・DB接続）から着手し、★G0（縦切り貫通）を最初の目標にする。

