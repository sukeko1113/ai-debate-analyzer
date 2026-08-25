-- ロールとデータベースを作る（DEV_ENVIRONMENTS.md §5 / DATA_MODEL.md §0.3）。
--
-- クラウドセッション（install_pkgs.sh）と CI（GitHub Actions）の両方から流す。
-- 二か所に同じ SQL を書くと必ずずれるので、ファイルを 1 つにする。
--
-- 要点: テーブルの所有者は RLS を素通りする。
--   app_migrator がテーブルを所有し、app_server には GRANT だけを与える。
--   同じロールにすると、RLS のテストが「通ったように見えて何も検証しない」状態になる。
--
-- 実行: psql -v app_password=devonly -v db_name=debate_dev -f scripts/db-bootstrap.sql
-- 冪等。スーパーユーザーで流す。

\set ON_ERROR_STOP on

-- psql の変数（:'app_password'）は $$ ... $$ の中では展開されないため、
-- DO ブロックではなく format() + \gexec で流す。

-- テーブル所有者。マイグレーションはこのロールで流す
SELECT format('CREATE ROLE app_migrator LOGIN NOSUPERUSER PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_migrator')
\gexec

SELECT format('ALTER ROLE app_migrator LOGIN NOSUPERUSER PASSWORD %L', :'app_password')
\gexec

-- アプリの接続ロール。RLS を素通りさせない
SELECT format('CREATE ROLE app_server LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_server')
\gexec

SELECT format('ALTER ROLE app_server LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD %L', :'app_password')
\gexec

-- CREATE DATABASE はトランザクション内で実行できないため \gexec で流す
SELECT format('CREATE DATABASE %I OWNER app_migrator', :'db_name')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db_name')
\gexec

SELECT format('GRANT CONNECT ON DATABASE %I TO app_server', :'db_name')
\gexec
