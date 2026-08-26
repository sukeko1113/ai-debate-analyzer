/**
 * match への認可（API_SPEC.md §0.2）。
 *
 * 【アプリの分岐は二重目の網である】
 * 一重目は RLS である。app.actor_id を見るポリシーが、他人の match を
 * SELECT / UPDATE / DELETE のどれでも 0 行にする（drizzle/0001_p2_match_core.sql）。
 * ここの関数を消しても、他人の match は見えない。
 * TASKS.md P2 の受け入れ基準3はそのことを直接確かめる（tests/db/rls-matches.test.ts）。
 *
 * それでもアプリ側で見るのは、403 と 404 を書き分けるためである。
 */
import type { TransactionSql } from "postgres";
import { ApiError } from "../../http/errors";
import type { MatchRole } from "../../schema/match";

/** 自分の match_access の役割。無ければ null */
export async function matchRoleOf(tx: TransactionSql, matchId: string): Promise<MatchRole | null> {
  const rows = await tx<{ role: MatchRole }[]>`
    SELECT role FROM match_access
     WHERE match_id = ${matchId} AND actor_id = public.app_actor_id()`;
  return rows[0]?.role ?? null;
}

/** RLS 越しに見えるかどうか。見えなければ存在も伏せる */
export async function matchIsVisible(tx: TransactionSql, matchId: string): Promise<boolean> {
  const rows = await tx<{ one: number }[]>`SELECT 1 AS one FROM matches WHERE id = ${matchId}`;
  return rows.length > 0;
}

/**
 * 必要な権限。
 *   read  … match_access の行があればよい（viewer を含む）
 *   write … owner / member。viewer は書けない（DATA_MODEL.md §11 共有段階）
 *   owner … owner だけ
 */
export type RequiredAccess = "read" | "write" | "owner";

/**
 * 役割が要求を満たすか。DB を要らない純粋関数として切り出してある。
 *
 * P2 の RLS では match_access に owner の行しか作れない
 * （作成者が自分を owner として登録する経路しか無い。共有機能は後の PR）。
 * つまり member / viewer の分岐は、DB を使ったテストでは通せない。
 * 判断そのものをここへ出しておき、tests/unit/match-access.test.ts で
 * 全組み合わせを確かめる。DB で作れないことを、検証しない理由にしない。
 */
export function accessDenial(role: MatchRole | null, required: RequiredAccess): ApiError | null {
  if (role === null) return new ApiError("FORBIDDEN", "この試合のメンバーではありません");
  if (required === "owner" && role !== "owner") {
    return new ApiError("FORBIDDEN", "この操作は owner だけが行えます");
  }
  if (required === "write" && role === "viewer") {
    return new ApiError("FORBIDDEN", "viewer はこの試合を変更できません");
  }
  return null;
}

export async function assertMatchAccess(
  tx: TransactionSql,
  matchId: string,
  required: RequiredAccess,
): Promise<MatchRole> {
  const visible = await matchIsVisible(tx, matchId);
  if (!visible) {
    // 他人の match の存在を 403 で漏らさない。RLS が見せない＝無いものとして扱う
    throw new ApiError("NOT_FOUND", "対象の試合が見つかりません");
  }

  const role = await matchRoleOf(tx, matchId);
  const denial = accessDenial(role, required);
  if (denial) throw denial;
  return role!;
}
