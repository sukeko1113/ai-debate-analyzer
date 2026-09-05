/**
 * DB テストの前提を揃える。
 * .env.local はクラウドセッションでは install_pkgs.sh が生成する。
 * CI では workflow が環境変数で渡す。
 */
import { existsSync } from "node:fs";

if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

/**
 * **未設定を既定値で埋めない。** 埋めると、設定漏れが「なぜか 401 になる」形で現れ、
 * 原因を探すことになる。ここで名指しして落とす。
 *
 * JOB_CRON_SECRET は内部API（API_SPEC.md §0.2）の共有秘密。
 * install_pkgs.sh が生成する .env.local には入るが、**既存の .env.local は上書きされない**
 * （件35）。P4 より前に作られた .env.local には無いので、その場合はここで落ちる。
 */
for (const key of ["DATABASE_URL", "DIRECT_URL", "SUPABASE_JWT_SECRET", "JOB_CRON_SECRET"]) {
  if (!process.env[key]) {
    throw new Error(
      `${key} が未設定です。scripts/install_pkgs.sh が .env.local を生成しますが、` +
        `既存の .env.local は上書きしません。手元の .env.local に足してください。`,
    );
  }
}
