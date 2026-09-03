# DEV_ENVIRONMENTS.md — どこで実装し、どこで確かめるか

## 0. 前提の整理

**製品が特定のPCに依存しないこと**と、**エージェントがどこで走るか**は別の話である。

- 守るべきは前者。CIが唯一の判定者であり、リポジトリが手元の環境を前提にしない。
- 後者は道具の使い分けにすぎない。**主たる開発環境はローカル（WSL2 上の Ubuntu）**で、
  クラウドセッション（Claude Code on the web）は補助である。
  どちらを使っても、上の一線を守る限り設計は壊れない。

2026-09-03 に、主従をクラウドからローカルへ切り替えた。理由は §3。
切り替え時に踏んだ穴は `HANDOFF.md`「ローカル環境への移行で分かったこと」に実測ごと残してある。

このファイルは、その使い分けを決める。

---

## 1. ローカル環境（主）

### 1.1 必要なもの

| 項目 | 内容 |
| --- | --- |
| OS | WSL2 上の Ubuntu（Linux ならどれでもよい） |
| Node.js | **22**。`.nvmrc` に書いてある。`engines` は `>=20 <23`、CI も 22。`nvm use` で合わせる |
| Docker | `postgres:16` コンテナを動かすため |
| PostgreSQL クライアント | **不要**。ホストに `psql` / `pg_isready` が無くても、`install_pkgs.sh` はコンテナ内のものを `docker exec` で借りる |

ホストに Postgres を直接入れる必要はない。**入れるなら 5432 を空けておく**か、`ADA_PG_PORT` で変える。

### 1.2 立ち上げ手順（初回）

```bash
# 1. Node を合わせる
nvm use                      # .nvmrc = 22

# 2. Postgres コンテナを起動する。POSTGRES_DB は渡さない（理由は §7.2）
docker run -d --name ada-pg -e POSTGRES_PASSWORD=devonly -p 5432:5432 postgres:16

# 3. 依存・ロール・DB・.env.local・マイグレーションをまとめて用意する
bash scripts/install_pkgs.sh

# 4. 確かめる
npm run test:db              # RLS・権限・API
```

**ロールと DB を手で `CREATE ROLE` しないこと。** `scripts/db-bootstrap.sql` と
`scripts/db-bootstrap-schema.sql` が正本で、CI とクラウドセッションもこれを流している。
手で作ると足りない権限を1つずつ追う羽目になる（`HANDOFF.md` 件33 で実際に踏んだ）。

`install_pkgs.sh` は SessionStart フック（`.claude/settings.json`）から**毎セッション**走る。
手で叩くのは初回と、DB を作り直したときだけでよい。

### 1.3 `install_pkgs.sh` がローカルで見る範囲・見ない範囲

| 見る | 見ない |
| --- | --- |
| `node_modules` が無ければ `npm ci` | **コンテナの起動・作成・削除** |
| Node のメジャーが `engines` の外なら warning（止めない） | ホストへの Postgres の導入 |
| `127.0.0.1:5432` の Postgres が**応答するか**の確認 | `.env.local` の**上書き**（既にあれば触らない。§5） |
| 応答があれば bootstrap SQL 2本を流す（冪等） | 実 Supabase への接続 |
| `.env.local` が**無ければ**生成する | |
| `.env.local` を読んで `npm run db:migrate`（冪等） | |

コンテナのライフサイクルを持たせないのは、SessionStart が毎セッション走るためである。
毎回 `docker run` を試みるフックは範囲が広すぎる。
**Postgres が応答しないときは、貼れる形の復旧手順（`docker start` / `docker run` の完全な行）を出して `exit 0` する。**
次のセッションはその出力を読んで自力で復旧できる。

環境変数で変えられるもの:

| 変数 | 既定 | 意味 |
| --- | --- | --- |
| `ADA_SKIP_LOCAL_DB=1` | — | DB の準備をすべて飛ばす（DB を自分で管理する人向け） |
| `ADA_PG_PORT` | `5432` | Postgres のポート |
| `ADA_PG_CONTAINER` | `ada-pg` | `psql` を借りるコンテナ名 |
| `ADA_PG_DB` | `debate_dev` | DB 名 |
| `ADA_PG_SUPERPASS` | `devonly` | ホストに `psql` があるときの superuser パスワード |

### 1.4 日常の操作

```bash
npm run test:unit            # DB 不要
npm run test:db              # ローカル Postgres に対して RLS・権限・API
npm run dev                  # Next.js（.env.local を自分で読む）
```

**`npm run db:migrate` を手で叩くときは前置きが要る。**

```bash
set -a && . ./.env.local && set +a && npm run db:migrate
```

`scripts/db-migrate.ts` は `.env.local` を読まない。これは意図的である（§2 件32）。
`install_pkgs.sh` は自分で `.env.local` を読んで渡すので、普段は人が打つ必要がない。

---

## 2. よくある失敗（すべて実測）

移行時に踏んだ3件。詳細と実測のログは `HANDOFF.md` 件32〜34。

### 件32 `npm run db:migrate` が `DIRECT_URL が未設定です。` で落ちる

`scripts/db-migrate.ts` は `process.env.DIRECT_URL` を直接見るだけで、`.env.local` を読まない。
クラウドセッションでは `install_pkgs.sh` が値を渡していたので表面化しなかった。

**対処**: 上の `set -a` 前置き。`db-migrate.ts` に `.env.local` を読ませる案は**採らなかった**。
読ませると、`.env.local` に本番の `DIRECT_URL` を置いた瞬間、素の `npm run db:migrate` が本番へ流れる。
本番への適用は GitHub Actions からだけ行う（§4）。

**罠**: シェルで一度 `set -a && . ./.env.local` をしてから Claude Code を起動すると、
そのセッションでは素の `db:migrate` が**通ってしまう**（環境変数を継承するため）。
「通った」と報告する前に、`env -i PATH="$PATH" HOME="$HOME" bash -lc 'npm run db:migrate'` で
素の環境でも同じ結果かを見ること。

### 件33 `permission denied for database debate_dev`（42501）

```
PostgresError: permission denied for database debate_dev
  code: '42501'
```

マイグレーションの `CREATE SCHEMA IF NOT EXISTS "drizzle"` には、**DB への CREATE 権限**が要る。
`db-bootstrap.sql` は DB を `OWNER app_migrator` で作るので、通常は所有者権限で通る。
ところが `docker run -e POSTGRES_DB=debate_dev` とすると **postgres 所有の DB が先にでき**、
`CREATE DATABASE ... WHERE NOT EXISTS` が飛んで、app_migrator は所有者にならない。

**対処**: `db-bootstrap.sql` に `GRANT CREATE ON DATABASE ... TO app_migrator` を足した（所有者なら no-op）。
`POSTGRES_DB` を渡さなくても、渡してしまっても通る。
`ALTER SCHEMA public OWNER TO app_migrator` は**要らない**（実測。`public` は `pg_database_owner` のままで
migrate も `test:db` も通る）。

### 件34 Node が範囲外のまま動きかける

`engines` は `>=20 <23`、CI は `22`。ホストの既定が v24 だと、そのまま動きかける。
`.nvmrc`（`22`）を置き、`tests/unit/node-version.test.ts` が `.nvmrc`・`engines`・CI の
`NODE_VERSION`・**いま走っている Node** の4つが揃っていることを検査する。

---

## 3. クラウドセッション（補助）

Claude Code on the web の各セッションは Ubuntu 24.04（x86_64）のVMで、
リポジトリがクローンされた状態で始まる。

| 項目 | 内容 |
| --- | --- |
| リソース | 約 4 vCPU / 16 GB RAM / 30 GB ディスク |
| Node.js | 20 / 21 / 22（既定は22） |
| データベース | PostgreSQL 16（プリインストール。`install_pkgs.sh` が起動する） |
| ネットワーク | 既定は **Trusted**（npm・GitHub・Docker Hub・Ubuntu等の許可リストのみ） |
| シークレット | **置けない**（専用のストアが無く、環境を使う人全員から読める。§5） |

セッション内の Postgres 16 で、ローカルと同じ検証（マイグレーション・RLS・トリガー・CHECK）ができる。
`install_pkgs.sh` は `CLAUDE_CODE_REMOTE=true` を見て、Postgres の起動から migrate までを毎回行う。

**補助に回した理由**は、できないことが3つあるからである。

1. 実キーを置けない（P5・P8 の実プロバイダ接続）
2. 音を聞けない・画面を見られない（G1・G3・G4・★G0）
3. 実 Supabase の Storage・Auth に触れない

ローカルはこの3つとも満たす。Postgres の検証はどちらでもできる。

### 3.1 環境ダイアログと制約

| 項目 | 値 |
| --- | --- |
| ネットワークアクセス | **Trusted**（既定のまま） |
| 環境変数 | **なし** |
| セットアップスクリプト | `scripts/setup-cloud-env.sh` の内容を貼る |

- セットアップスクリプトは**終了コード0**でなければセッションが起動しない。
- **5分以内**に終える。超えると環境キャッシュが作られず、毎回走ることになる。
- キャッシュはファイルシステムのスナップショットなので、**起動したプロセスは残らない**。
  Postgres の起動は SessionStart フック側で行う。
- 内容はリポジトリにも置いて版管理し、CI が `scripts/setup-cloud-env.sh.sha256` と突き合わせる。
- `~/.claude/` に置いた設定はクラウドセッションに届かない。**リポジトリの `.claude/` に置くこと。**

---

## 4. 実 Supabase には接続しない（確定）

### 4.1 理由

1. **エージェントが実データベースを直接触れる状態を作らない。**
2. **不要である。** ローカルの `postgres:16` でも、セッション内の Postgres 16 でも同じ検証ができる。
3. クラウドセッションからは技術的にも届かない（外向きは HTTP/HTTPS プロキシ経由。Postgres ワイヤは通らない）。

### 4.2 代わりにこうする

| やること | どこで |
| --- | --- |
| マイグレーションの作成と検証 | ローカルの `postgres:16`（またはセッション内 Postgres） |
| RLS・トリガー・CHECK制約のテスト | 同上 |
| **本番/ステージング Supabase へのマイグレーション適用** | **GitHub Actions**（Secretsに `DIRECT_URL` を置く） |
| Supabase Storage / Auth の動作確認 | ローカル、または人の手 |

**リポジトリが「生きた Supabase があること」を前提にしない。**

### 4.3 ローカルではガードが効かない

`packages/core/src/db/client.ts` の `assertNotRealDatabaseFromCloudSession` は
**`CLAUDE_CODE_REMOTE=true` のときだけ**セッション外のホストを拒む。
ローカルには技術的な壁が無い。`.env.local` の `DATABASE_URL` / `DIRECT_URL` は
`127.0.0.1` を指したままにし、実 Supabase を指す値は置かない。**ここは人の規律で守る。**
`.env.local` に置いてよいキーとの区別は §5 に書いてある。

---

## 5. シークレット方針

`.env.local` に置いてよいのは **HTTP で外部サービスを叩くキー**だけである。
**Postgres の接続文字列（`DATABASE_URL` / `DIRECT_URL`）は `127.0.0.1` 固定**で、
実 Supabase を指す値はローカルのどこにも置かない（§4.3）。

区別の理由: API キーが漏れても被害はそのサービスの範囲で止まるが、
DB の接続文字列は RLS もサーバ権威も迂回して全データに届く。
`BASIC_DESIGN_v05.md` §4.2 が service role key を Storage と Auth に限定し DB に使わないと決めたのと同じ構造で、
「DB へ届く経路を設定ではなく構成で塞ぐ」ための線である。

| 種類 | 置き場所 |
| --- | --- |
| 転写プロバイダのAPIキー（Pass A / B） | GitHub Actions Secrets、または**ローカルの `.env.local`** |
| 解析・判定支援LLMのキー | 同上 |
| `SUPABASE_SERVICE_ROLE_KEY` | 同上 |
| `DATABASE_URL`（本番） | Vercel の環境変数のみ。**ローカルには置かない** |
| `DIRECT_URL`（本番マイグレーション用） | GitHub Actions Secrets のみ。**ローカルには置かない** |
| ローカル / セッション内 Postgres の接続情報 | ダミー値（`devonly`）。秘密ではない |

**クラウド環境の設定にはシークレットを1つも置かない。** 専用のストアが無く、
環境変数はその環境を使う人全員から読める。その結果、ネットワークは Trusted のままでよい。

**ローカルの `.env.local` が実キーの唯一の置き場になる。** だから `install_pkgs.sh` は、
ローカルでは `.env.local` を**上書きしない**（無いときだけ生成する）。
クラウドセッションでは毎回上書きする（実キーが入ることが無いため）。
`.env.local` は `.gitignore` 済みだが、**内容をチャットに貼らない**こと。

---

## 6. 実行場所の振り分け

既定は**ローカル**である。PR ごとに違うのは「そのPRが何を必要とするか」だけ。

| 必要なもの | 該当 | クラウドセッションで |
| --- | --- | --- |
| 何も要らない（コードと Postgres だけ） | P0・P1・P2・P4・P6・P9・P11・P12・P13・P14〜P16・P17.5・P18・P20 | **可** |
| **実キー**（`.env.local` か CI Secrets） | **P5・P8** | 不可（キーを置けない） |
| **人の耳・目**（G1・G3・G4・印刷・削除後の見え方） | P3・P7・P10・P17・P19・P21・**★G0** | 不可（実装まではできる） |

`TASKS.md` の各PRの「実行場所」はこの語彙で書いてある。

**人の確認が要るPRは、テストが緑でも「人の確認待ち」として報告する**（`ACCEPTANCE.md` §2.1）。
ローカルは人がそこにいる環境だが、エージェントが音を聞いたわけではない。

---

## 7. Postgres の落とし穴

### 7.1 テーブルの所有者はRLSを素通りする

`app_migrator` がテーブルを所有し、`app_server` には `GRANT` だけを与える構成にすること。
所有者と接続ロールを同じにすると、RLSのテストが「通ったように見えて何も検証していない」状態になる。

念のため `ALTER TABLE ... FORCE ROW LEVEL SECURITY` も併用する。

```sql
-- scripts/db-bootstrap.sql が作る構成
CREATE ROLE app_migrator LOGIN NOSUPERUSER;   -- テーブル所有者
CREATE ROLE app_server   LOGIN NOSUPERUSER NOBYPASSRLS;
-- マイグレーションは app_migrator で流し、アプリは app_server で接続する
```

これは本番の Supabase と同じ構成なので、ここで通ったRLSは本番でも同じように効く。

### 7.2 DB の所有者と `CREATE SCHEMA`

マイグレーションは `drizzle` スキーマを作る。これには **DB への CREATE 権限**が要り、
DB の所有者は暗黙に持つ。`db-bootstrap.sql` は DB を `OWNER app_migrator` で作るのでそれで足りる。

**DB が先にある**と（`docker run -e POSTGRES_DB=...`、既存の DB を使い回す等）、
所有者は postgres のままになる。`db-bootstrap.sql` は
`GRANT CREATE ON DATABASE ... TO app_migrator` も流すので、どちらの経路でも通る。
`POSTGRES_DB` は**渡さない**のが素直だが、渡してしまっても壊れない。

`public` スキーマの所有者を変える必要は**無い**（§2 件33）。

---

## 8. ファイル

| ファイル | 役割 | 実行される場所 |
| --- | --- | --- |
| `.nvmrc` | Node のメジャー（22）。`engines`・CI と一致することをテストが検査 | ローカル |
| `scripts/install_pkgs.sh` | プロジェクトの下ごしらえ（依存・ロール・`.env.local`・migrate） | 毎セッション（`CLAUDE_CODE_REMOTE` で分岐） |
| `scripts/db-bootstrap.sql` | ロールと DB。**ローカル・クラウド・CI の三者が同じファイルを流す** | superuser で |
| `scripts/db-bootstrap-schema.sql` | `public` スキーマの USAGE / CREATE | 対象 DB に接続して |
| `scripts/setup-cloud-env.sh` | クラウドVMの下ごしらえ（現在は何もしない） | クラウドのみ・Claude Code起動前 |
| `.claude/settings.json` | SessionStart フックの登録 | ローカル・クラウド両方 |
| `.env.example` | 環境変数の一覧 | — |

---

## 9. 守るべき一線

ローカルを主にしたことで、**「手元では通った」を根拠にする誘惑は強くなる**。破ってはいけないのは次だけである。

- **CIが唯一の判定者。**「手元では通った」を根拠にしない。
  手元のシェルが `.env.local` を継承している、Node が違う、などで結果は変わる（§2）。
- 絶対パス、ローカル専用スクリプト、手元にしかないファイルをリポジトリの前提にしない。
  `install_pkgs.sh` がコンテナを起動・作成しないのも、この一線の内側にいるためである。
- 本番の認証情報は GitHub Actions Secrets にだけ置く。
- クラウド環境の設定にシークレットを置かない。
- ローカルから実 Supabase を指す `DATABASE_URL` / `DIRECT_URL` を `.env.local` に書かない（§4.3）。

> whosaid-editor は `C:\dev\01` 配下であること、`.venv` を有効にすること、
> ffmpeg が WinGet で導入済みであることを前提にしていた。
> あれを再発させないための一線である。
