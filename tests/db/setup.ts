/**
 * DB テストの前提を揃える。
 * .env.local はクラウドセッションでは install_pkgs.sh が生成する。
 * CI では workflow が環境変数で渡す。
 */
import { existsSync } from "node:fs";

if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

for (const key of ["DATABASE_URL", "DIRECT_URL", "SUPABASE_JWT_SECRET"]) {
  if (!process.env[key]) {
    throw new Error(
      `${key} が未設定です。クラウドセッションでは scripts/install_pkgs.sh が .env.local を生成します。`,
    );
  }
}
