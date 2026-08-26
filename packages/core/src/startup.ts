/**
 * 起動時に一度だけ確かめる設定（HANDOFF.md 件3 の判断）。
 *
 * getRuleset() は未知の id で例外を投げるが、RULESET_DEFAULT の値そのものは
 * env の Zod 定義で検証していない。つまり不正な ruleset id を環境変数に入れると、
 * 起動は成功し、最初のリクエストを受けた時点で落ちる。
 *
 * 設定ミスはリクエストを受けた後ではなく、起動時に落ちるべきである。
 * defineHandler がこのモジュールを import しているので、
 * ルートを 1 つでも読み込んだ時点でこの検査が走る。
 *
 * ここで parseEnv() 全体を呼ばないのは意図的である。
 * DATABASE_URL が無い環境（CI の next build）で落ちてしまうため、
 * 「起動時に検査できるもの」だけをここに置く。
 */
import { getRuleset, type Ruleset } from "./ruleset";

const DEFAULT_RULESET_ID = "henda-20";

export function resolveDefaultRuleset(
  env: Record<string, string | undefined> = process.env,
): Ruleset {
  const id = env.RULESET_DEFAULT ?? DEFAULT_RULESET_ID;
  try {
    return getRuleset(id);
  } catch (cause) {
    throw new Error(
      `環境変数 RULESET_DEFAULT の値が不正です: ${id}。` +
        `既知の ruleset を指定してください（packages/core/src/ruleset/）。`,
      { cause },
    );
  }
}

/** import 時に評価される。壊れた設定でアプリが起動しない */
export const defaultRuleset: Ruleset = resolveDefaultRuleset();
