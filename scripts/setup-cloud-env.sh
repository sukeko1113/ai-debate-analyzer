#!/bin/bash
# ---------------------------------------------------------------------------
# scripts/setup-cloud-env.sh
#
# Claude Code on the web の「セットアップスクリプト」に貼る内容。
# 環境ダイアログ（claude.ai/code の環境セレクタ）に設定するが、
# 内容はここで版管理する。ずれたら気づけるように CI で突き合わせる。
#
# 実行条件（公式の制約）:
#   - root で走る（Ubuntu 24.04）
#   - 終了コード 0 でなければセッションが起動しない → 重要でない処理は || true
#   - 5分以内に終える → 超えると環境キャッシュが作られない
#   - キャッシュはファイルシステムのスナップショット。
#     ここで起動したプロセスは残らない（Postgres の起動は install_pkgs.sh 側）
#
# プリインストール済みなので、ここでは入れないもの:
#   Node.js 20/21/22, npm/yarn/pnpm, PostgreSQL 16, Redis 7, Docker,
#   git, gh, jq, ripgrep, chromedriver
# ---------------------------------------------------------------------------
set -u

log() { echo "[setup-cloud-env] $*"; }

log "start"

# --- Playwright のブラウザ本体 -------------------------------------------------
# chromedriver はあるが Playwright は自前のブラウザを要求する。
# キャッシュに乗せたいのでここで入れる。時間がかかるので chromium だけ。
if command -v npx >/dev/null 2>&1; then
  log "installing playwright chromium"
  npx --yes playwright@latest install --with-deps chromium || true
fi

# --- PDF 確認用（任意） --------------------------------------------------------
# サーバでの PDF 生成はしないが、生成した .docx を目視確認したい場合に使う。
# 5分の予算を圧迫するなら削ってよい。
# apt-get update -y && apt-get install -y --no-install-recommends poppler-utils || true

log "done"
exit 0
