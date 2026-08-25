# ai-debate-analyzer

HEnDA方式の英語ディベート試合（音声・動画）を解析し、
**フローシート・ジャッジシート・判定理由・解説資料**を作るWebアプリ。

> 目的は「勝敗を自動で当てること」ではない。
> **人間ジャッジが何を聞き、どの議論を追い、なぜその判定に至ったかを、再現可能な形にすること**である。

---

## 1試合から作る6成果物

| No | 成果物 | 役割 |
| --- | --- | --- |
| 01 | タイムスタンプ付き逐語記録 | 各発言を音声の位置へ戻して確認できる |
| 02 | デジタルフローシート | 公式Flow Sheetの配置で、議論の矢印を追う |
| 03 | Judge Sheet下書き | Probability × Value = Strength、Voting Issue、新規議論チェック |
| 04 | 判定理由メモ | どの議論が残り、どれが崩れたかを時刻付き根拠で説明 |
| 05 | 試合解説レポート | 流れ、ターニングポイント、勝敗理由、学習ポイント |
| 06 | 検証履歴 | AI提案・人間修正・確定者・モデル／ルール版・再解析履歴 |

---

## 構成

```
ai-debate-analyzer/
├─ CLAUDE.md                  # 絶対に守る設計原則。実装前に必ず読む
├─ docs/
│  ├─ BASIC_DESIGN_v04.md     # 正本。全体設計
│  ├─ HENDA_RULESET.md        # 大会ルールの条項と機械可読化の対応
│  ├─ DATA_MODEL.md           # テーブル定義と制約
│  ├─ TRANSCRIPTION.md        # 4パス構成（Pass A / S / B / C）とprovider契約
│  ├─ API_SPEC.md             # HTTP API契約（セキュリティ境界）
│  ├─ PRIVACY_RETENTION.md    # 保持レベルA〜Eと削除
│  ├─ DEV_ENVIRONMENTS.md     # Web版/デスクトップ版の使い分け
│  ├─ REVIEW_SEMANTICS.md     # レビュー状態の4軸。壊してはならない規則
│  ├─ JUDGE_LOGIC.md          # Decision Chartとサーバ権威
│  ├─ ACCEPTANCE.md           # 受け入れ基準（機械／人間）と品質ゲート
│  └─ TASKS.md                # P0〜P16のPR分割
├─ packages/core/             # ruleset / schema / anchor / rules（UIに依存しない）
├─ app/                       # Next.js App Router
├─ schemas/                   # 生成物。手書きしない
├─ fixtures/gold-01/          # 合成試合。音声・原稿・正解一式
├─ .claude/settings.json      # SessionStart フック（リポジトリに置く）
└─ scripts/                   # setup-cloud-env / install_pkgs / generate-schemas
                              # estimate-cost / check-no-real-data
```

---

## 開発コマンド

```bash
npm run typecheck          # tsc --noEmit
npm run lint               # eslint
npm run format             # prettier --check（docs/ と CLAUDE.md は対象外）
npm run test:unit          # DB を必要としないテスト
npm run test:db            # セッション内 PostgreSQL に対する RLS・権限テスト
npm run test:e2e           # Playwright（メディア要素の再生位置）
npm run db:migrate         # drizzle マイグレーション（DIRECT_URL / app_migrator）
npm run generate-schemas   # Zod → schemas/*.json（生成物。手書きしない）
npm run check-no-real-data # 実データ混入の検査
npm run build              # Next.js production ビルド
npm run check-dev-routes   # /dev/* が production ビルドに無いことの確認
```

DB は SessionStart フック（`scripts/install_pkgs.sh`）が起動し、
`scripts/db-bootstrap.sql` でロールとデータベースを作る。
CI も同じ SQL を使う。**実 Supabase には接続しない**（`docs/DEV_ENVIRONMENTS.md` §2）。

`/dev/media-probe` は再生位置を確かめるための開発専用ページで、
production ビルドには含まれない。

---

## 技術

Next.js（App Router）＋ TypeScript ＋ Zod ＋ Drizzle ORM /
Supabase（Postgres・Storage・Auth）/ Vercel / GitHub Actions

DBアクセスは **Supavisor プーラー（transaction mode）経由の Postgres 接続**。
Data API（PostgREST）は無効で、ブラウザからDBへ到達する経路を持たない。

**開発・検証・デプロイはすべてクラウドで完結する。特定のPCに依存する工程を作らない。**
サーバにffmpegを置かない。音声の区間再生はブラウザ標準のメディア要素で行う。

---

## データの扱い（重要）

このアプリは**未成年である高校生の音声と氏名**を扱う。

- 実音声・実映像・実名・実試合transcriptを**リポジトリに置かない**
- `fixtures/` は合成データのみ。CIの `check-no-real-data` が検出したら失敗する
- 許諾（本人・保護者・学校）が記録されていない試合は、解析を開始できない
- 保持レベル A(音声) / B(transcript) / C(氏名) / D(フロー・判定) / E(統計) を分け、
  試合単位で「何を、いつ消すか」を指定できる
- 外部APIへの送信先を画面に明示し、同意を得てから実行する

録音を外部へ出せない案件には、[whosaid-editor](https://github.com/sukeko1113/whosaid-editor) で
ローカル前処理を行い、作業JSONを取り込む経路がある（`REVIEW_SEMANTICS.md` §4）。

---

## 関連

- [whosaid-editor](https://github.com/sukeko1113/whosaid-editor) — レビュー状態の意味論とアンカー照合の移植元（MIT）
- ai-english-debate — Next.js / Postgres構成とサーバ権威の原則の継承元
- ai-debate-match — HEnDA 12セクションの状態機械

HEnDAの名称・様式の利用については `docs/BASIC_DESIGN_v04.md` 付録E を参照。
確認が取れるまでは、名称にHEnDAを使わず、公式様式の画像・PDFを同梱しない。
