#!/bin/bash
# ---------------------------------------------------------------------------
# scripts/install_pkgs.sh
#
# SessionStart フックから毎セッション実行される（.claude/settings.json）。
# ローカルとクラウドの両方で走るため、CLAUDE_CODE_REMOTE で分岐する。
#
# ローカル（主。docs/DEV_ENVIRONMENTS.md §1）:
#   - 依存を導入する
#   - **Postgres の応答を確かめるだけ。コンテナの起動も作成もしない。**
#     応答が無ければ、貼れる形の復旧手順を出して exit 0 する。
#     SessionStart は毎セッション走る。コンテナのライフサイクルまで持たせない。
#   - 応答があれば、ロールと DB を bootstrap SQL で作り、.env.local が無ければ作り、
#     マイグレーションを流す
# クラウド（補助）:
#   - セッション内 PostgreSQL 16 を起動し、本番と同じロール構成を作る
#   - 依存を導入し、マイグレーションを適用する
#     （これが無いと npm run test:db が
#      「function public.app_actor_id() does not exist」で落ちる。P1 からの申し送り 件1）
#
# 重要: テーブルの所有者は RLS を素通りする。
#   app_migrator が所有し、app_server には GRANT だけを与える。
#   ここを同一ロールにすると、RLS のテストが「通ったように見えて何も検証しない」。
#
# 重要: ロールと DB を手で CREATE しない。scripts/db-bootstrap.sql を流す。
#   手で作ると権限が1つずつ足りない状態になる（HANDOFF.md 件33）。
# ---------------------------------------------------------------------------
set -u

log() { echo "[install_pkgs] $*"; }

PG_DB="${ADA_PG_DB:-debate_dev}"
PG_PASS="devonly"          # ローカル・セッション内だけの値。秘密ではない
JWT_SECRET="devonly-jwt-secret"   # 同上。実 Supabase の鍵ではない
JOB_SECRET="devonly-job-secret"   # 同上。内部API（API_SPEC.md §0.2）の共有秘密
PG_PORT="${ADA_PG_PORT:-5432}"
PG_CONTAINER="${ADA_PG_CONTAINER:-ada-pg}"   # ローカルで psql を借りるコンテナ名
DB_URL="postgres://app_server:${PG_PASS}@127.0.0.1:${PG_PORT}/${PG_DB}"
DIRECT_URL="postgres://app_migrator:${PG_PASS}@127.0.0.1:${PG_PORT}/${PG_DB}"

# --- 共通の部品 ----------------------------------------------------------------

# .env.local を書く。mode=force は毎回上書き（クラウド）、mode=keep は既存を残す（ローカル）。
# ローカルの .env.local は実キーの唯一の置き場になるため、上書きしてはならない
# （DEV_ENVIRONMENTS.md §5）。
write_env_local() {
  if [ "$1" = "keep" ] && [ -f .env.local ]; then
    log "existing .env.local を残しました（上書きしません）"
    return 0
  fi
  cat > .env.local <<EOF
# DB の接続先。クラウドセッションでは毎回このスクリプトが上書きする。
# ローカルでは、既に .env.local があれば上書きしない（実キーを消さないため）。
# いずれも実 Supabase には接続しない（DEV_ENVIRONMENTS.md §4）。
#
# NODE_ENV はここに書かない。
# 書くと \`set -a && . ./.env.local\` で export され、その状態の \`next build\` は
# React の本番/開発が食い違って /_global-error のプリレンダで落ちる。
# NODE_ENV は next が各コマンドで自分で決める。
DATABASE_URL=${DB_URL}
DIRECT_URL=${DIRECT_URL}
# JWT の検証鍵（API_SPEC.md §0.2）。**この環境だけの値であり秘密ではない。**
# 実 Supabase の鍵はここにも、クラウド環境の設定にも置かない（DEV_ENVIRONMENTS.md §5）。
# 未設定だと API が 500 になる。認証を素通りさせる分岐は用意していない
SUPABASE_JWT_SECRET=${JWT_SECRET}
# 内部API（/api/v1/internal/*）の共有秘密（API_SPEC.md §0.2）。**この環境だけの値。**
# X-Job-Secret ヘッダ、または Vercel Cron が送る Authorization: Bearer と照合する。
# JWT としては一切解釈しない。未設定だと内部APIが 500 になる
JOB_CRON_SECRET=${JOB_SECRET}
EOF
  log "wrote .env.local"
}

# マイグレーションは tsx（node_modules）で流すので、依存の導入を先に済ませる。
# package.json が無い状態で走らせると、依存ゼロの package-lock.json ができてしまう。
install_deps() {
  if [ -f package.json ] && [ ! -d node_modules ]; then
    log "npm ci"
    npm ci || npm install || true
  fi
}

# --- ローカルセッション --------------------------------------------------------
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  # リポジトリの外（空ディレクトリなど）では何もしない。DB にも docker にも触れない
  [ -f package.json ] || exit 0

  node_major="$(node -v 2>/dev/null | sed 's/^v//; s/\..*//')"
  case "${node_major:-}" in
    20|21|22) ;;
    "") log "warning: node が見つかりません" ;;
    *) log "warning: node v${node_major} は package.json の engines（>=20 <23）の外です。.nvmrc は 22 です（nvm use）" ;;
  esac

  install_deps

  if [ "${ADA_SKIP_LOCAL_DB:-}" = "1" ]; then
    log "local: ADA_SKIP_LOCAL_DB=1 のため DB の準備を飛ばしました"
    exit 0
  fi

  # Postgres が応答するか。ホストに pg_isready が無い環境が普通なので docker exec も試す。
  # ここで試すのは「応答するか」だけであり、起動も作成もしない
  pg_ready() {
    if command -v pg_isready >/dev/null 2>&1; then
      pg_isready -q -h 127.0.0.1 -p "${PG_PORT}" && return 0
    fi
    if command -v docker >/dev/null 2>&1; then
      docker exec "${PG_CONTAINER}" pg_isready -q -U postgres >/dev/null 2>&1 && return 0
    fi
    return 1
  }

  if ! pg_ready; then
    cat <<GUIDE
[install_pkgs] warning: 127.0.0.1:${PG_PORT} の PostgreSQL が応答しません。DB の準備を飛ばします。
  このスクリプトはコンテナを起動も作成もしません。次のどちらかを手で打ってください。

  コンテナが停止しているだけなら:
    docker start ${PG_CONTAINER}

  まだ無いなら（POSTGRES_DB は渡さない。DB は scripts/db-bootstrap.sql が OWNER app_migrator で作る）:
    docker run -d --name ${PG_CONTAINER} -e POSTGRES_PASSWORD=${PG_PASS} -p ${PG_PORT}:5432 postgres:16

  そのあと、もう一度:
    bash scripts/install_pkgs.sh

  手順の詳細: docs/DEV_ENVIRONMENTS.md §1
GUIDE
    exit 0
  fi

  # ロールと DB は CI・クラウドと同じ SQL で作る。手で CREATE ROLE しない（HANDOFF.md 件33）
  psql_super() {
    if command -v psql >/dev/null 2>&1; then
      PGPASSWORD="${ADA_PG_SUPERPASS:-$PG_PASS}" psql -h 127.0.0.1 -p "${PG_PORT}" -U postgres "$@"
    elif command -v docker >/dev/null 2>&1; then
      docker exec -i "${PG_CONTAINER}" psql -U postgres "$@"
    else
      return 127
    fi
  }

  log "local: applying db-bootstrap.sql"
  if psql_super -q -v ON_ERROR_STOP=1 -v app_password="${PG_PASS}" -v db_name="${PG_DB}" \
       < scripts/db-bootstrap.sql \
     && psql_super -q -v ON_ERROR_STOP=1 -d "${PG_DB}" < scripts/db-bootstrap-schema.sql; then
    log "local: roles and database ready"
  else
    cat <<GUIDE
[install_pkgs] warning: bootstrap SQL を流せませんでした。手で流してください（ロールを手で CREATE しないこと）:
    docker exec -i ${PG_CONTAINER} psql -U postgres -v ON_ERROR_STOP=1 \\
      -v app_password=${PG_PASS} -v db_name=${PG_DB} < scripts/db-bootstrap.sql
    docker exec -i ${PG_CONTAINER} psql -U postgres -v ON_ERROR_STOP=1 \\
      -d ${PG_DB} < scripts/db-bootstrap-schema.sql
GUIDE
    exit 0
  fi

  write_env_local keep
fi

# --- クラウドセッション --------------------------------------------------------
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
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

  # 接続情報はセッションごとに作り直す（agent が読む）
  write_env_local force

  install_deps
fi

# --- マイグレーション -----------------------------------------------------------
# これが無いと、新しいセッションの最初の `npm run test:db` が
#   PostgresError: function public.app_actor_id() does not exist
# で落ちる（HANDOFF.md「P1 から P2 への申し送り」件1）。
#
# 冪等である。drizzle が __drizzle_migrations に適用済みを記録しており、
# 二度目以降は何も流れない。SQL 自体も IF NOT EXISTS / OR REPLACE /
# DROP ... IF EXISTS → CREATE で書いてある。
#
# 接続先は .env.local から読む。scripts/db-migrate.ts は .env.local を読まない
# （読ませると、実 DB を指す .env.local を置いた瞬間に素の npm run db:migrate が
#  そこへ流れてしまう。DEV_ENVIRONMENTS.md §2）。ここで明示的に渡す。
#
# 失敗してもセッションは起動させる（exit 0）。ここで止めると、
# マイグレーションを直したくても Claude Code が上がってこない。
if [ -d node_modules ] && [ -f .env.local ]; then
  log "applying migrations"
  if ( set -a; . ./.env.local; set +a; npm run db:migrate --silent ); then
    log "migrations applied"
  else
    log "warning: マイグレーションに失敗しました。npm run db:migrate を手動で確認してください"
    log "warning: 手で流すときは前置きが要ります: set -a && . ./.env.local && set +a && npm run db:migrate"
  fi
elif [ ! -d node_modules ]; then
  log "warning: node_modules が無いためマイグレーションを飛ばしました"
fi

log "done"
exit 0
