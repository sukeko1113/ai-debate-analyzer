#!/bin/bash
# ---------------------------------------------------------------------------
# scripts/install_pkgs.sh
#
# SessionStart フックから毎セッション実行される（.claude/settings.json）。
# ローカルとクラウドの両方で走るため、CLAUDE_CODE_REMOTE で分岐する。
#
# クラウド:
#   - セッション内 PostgreSQL 16 を起動し、本番と同じロール構成を作る
#   - 依存を導入する
# ローカル:
#   - 依存が無いときだけ導入する。DB は各自の環境に任せる
#
# 重要: テーブルの所有者は RLS を素通りする。
#   app_migrator が所有し、app_server には GRANT だけを与える。
#   ここを同一ロールにすると、RLS のテストが「通ったように見えて何も検証しない」。
# ---------------------------------------------------------------------------
set -u

log() { echo "[install_pkgs] $*"; }

PG_DB="debate_dev"
PG_PASS="devonly"          # セッション内だけの値。秘密ではない
DB_URL="postgres://app_server:${PG_PASS}@127.0.0.1:5432/${PG_DB}"
DIRECT_URL="postgres://app_migrator:${PG_PASS}@127.0.0.1:5432/${PG_DB}"

# --- ローカルセッション --------------------------------------------------------
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  if [ ! -d node_modules ]; then
    log "local: npm ci"
    npm ci || npm install || true
  fi
  exit 0
fi

# --- クラウドセッション --------------------------------------------------------
log "cloud: starting postgresql"
service postgresql start || true

# 起動を待つ
for i in $(seq 1 20); do
  if pg_isready -q -h 127.0.0.1 -p 5432; then break; fi
  sleep 1
done
pg_isready -h 127.0.0.1 -p 5432 || log "warning: postgres not ready"

psql_su() { su postgres -c "psql -v ON_ERROR_STOP=0 -q -c \"$1\"" 2>/dev/null || true; }

log "cloud: creating roles and database"
psql_su "CREATE ROLE app_migrator LOGIN NOSUPERUSER PASSWORD '${PG_PASS}';"
psql_su "CREATE ROLE app_server   LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${PG_PASS}';"
psql_su "CREATE DATABASE ${PG_DB} OWNER app_migrator;"
psql_su "GRANT CONNECT ON DATABASE ${PG_DB} TO app_server;"
su postgres -c "psql -q -d ${PG_DB} -c \"GRANT USAGE ON SCHEMA public TO app_server;\"" 2>/dev/null || true
su postgres -c "psql -q -d ${PG_DB} -c \"ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_server;\"" 2>/dev/null || true

# --- 接続情報を .env.local に書く（agent が読む） -------------------------------
log "cloud: writing .env.local"
cat > .env.local <<EOF
# このファイルはセッションごとに install_pkgs.sh が生成する。編集しても次回上書きされる。
# セッション内 PostgreSQL 16 を指しており、実 Supabase には接続しない。
DATABASE_URL=${DB_URL}
DIRECT_URL=${DIRECT_URL}
NODE_ENV=development
EOF

# --- 依存 ---------------------------------------------------------------------
if [ ! -d node_modules ]; then
  log "cloud: npm ci"
  npm ci || npm install || true
fi

log "cloud: done"
exit 0
