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
  # package.json が無い状態で npm ci を走らせると、依存ゼロの空 package-lock.json が
  # 生成されてしまう。package.json があるときだけ走らせる。
  if [ -f package.json ] && [ ! -d node_modules ]; then
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

# ロールとデータベースは CI と同じ SQL で作る（scripts/db-bootstrap.sql）。
# 二か所に書くとずれる。
log "cloud: creating roles and database"
su postgres -c "psql -q -v ON_ERROR_STOP=1 -v app_password=${PG_PASS} -v db_name=${PG_DB} -f '$(pwd)/scripts/db-bootstrap.sql'" \
  || log "warning: db-bootstrap.sql に失敗しました"
su postgres -c "psql -q -v ON_ERROR_STOP=1 -d ${PG_DB} -f '$(pwd)/scripts/db-bootstrap-schema.sql'" \
  || log "warning: db-bootstrap-schema.sql に失敗しました"

# --- 接続情報を .env.local に書く（agent が読む） -------------------------------
log "cloud: writing .env.local"
cat > .env.local <<EOF
# このファイルはセッションごとに install_pkgs.sh が生成する。編集しても次回上書きされる。
# セッション内 PostgreSQL 16 を指しており、実 Supabase には接続しない。
#
# NODE_ENV はここに書かない。
# 書くと \`set -a && . ./.env.local\` で export され、その状態の \`next build\` は
# React の本番/開発が食い違って /_global-error のプリレンダで落ちる。
# NODE_ENV は next が各コマンドで自分で決める。
DATABASE_URL=${DB_URL}
DIRECT_URL=${DIRECT_URL}
EOF

# --- 依存 ---------------------------------------------------------------------
if [ -f package.json ] && [ ! -d node_modules ]; then
  log "cloud: npm ci"
  npm ci || npm install || true
fi

log "cloud: done"
exit 0
