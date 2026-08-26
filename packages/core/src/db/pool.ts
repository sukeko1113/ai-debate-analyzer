/**
 * リクエストから使う接続の入口。
 *
 * 接続の生成は遅延させる。モジュール読み込み時に作ると、DATABASE_URL の無い
 * 環境（CI の next build）でビルドが落ちる。
 */
import type { Sql } from "postgres";
import { createSqlClient } from "./client";

let cached: Sql | undefined;

export function getSql(): Sql {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL が未設定です。クラウドセッションでは scripts/install_pkgs.sh が .env.local を生成します。",
    );
  }
  cached = createSqlClient(url);
  return cached;
}

/** テストから接続を差し替える。本番の経路では使わない */
export function setSqlForTesting(sql: Sql | undefined): void {
  cached = sql;
}
