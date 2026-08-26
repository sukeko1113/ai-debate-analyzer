/**
 * matches / match_members の読み書き（DATA_MODEL.md §2）。
 *
 * ここを通るクエリはすべて defineHandler が開いたトランザクション上で走る。
 * つまり SET LOCAL app.actor_id 済みであり、RLS が効いている。
 * tx を受け取らない関数をこのファイルに足さないこと。足した瞬間に
 * 「app.actor_id を発行しないクエリ経路」ができる（CLAUDE.md）。
 */
import type { TransactionSql } from "postgres";
import { ApiError } from "../../http/errors";
import type { Match, MatchMember } from "../../schema/match";
import { toTeamSize } from "../../ruleset/roster";
import type { TeamSize } from "../../ruleset";

/** DB の行（snake_case）。列名は DATA_MODEL.md §2 に合わせる */
interface MatchRow {
  id: string;
  motion: string;
  held_on: string | null;
  round: string | null;
  aff_team: string;
  neg_team: string;
  ruleset_id: string;
  ruleset_version: string;
  consent_scope: string | null;
  consent_obtained_from: string[];
  consent_recorded_at: Date | null;
  consent_expires_on: string | null;
  status: string;
  lock_version: number;
  created_by: string;
  created_at: Date;
}

/** date 型は postgres.js が文字列で返す。timestamptz は Date で返る */
function isoDate(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

export function toMatch(row: MatchRow): Match {
  return {
    id: row.id,
    motion: row.motion,
    heldOn: isoDate(row.held_on),
    round: row.round,
    affTeam: row.aff_team,
    negTeam: row.neg_team,
    rulesetId: row.ruleset_id as Match["rulesetId"],
    rulesetVersion: row.ruleset_version,
    consentScope: row.consent_scope as Match["consentScope"],
    consentObtainedFrom: row.consent_obtained_from as Match["consentObtainedFrom"],
    consentRecordedAt: row.consent_recorded_at?.toISOString() ?? null,
    consentExpiresOn: isoDate(row.consent_expires_on),
    status: row.status as Match["status"],
    lockVersion: row.lock_version,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
  };
}

interface MemberRow {
  id: string;
  match_id: string;
  side: string;
  seat: string;
  display_name: string | null;
  team_size: number;
  lock_version: number;
}

export function toMember(row: MemberRow): MatchMember {
  return {
    id: row.id,
    matchId: row.match_id,
    side: row.side as MatchMember["side"],
    seat: row.seat as MatchMember["seat"],
    displayName: row.display_name,
    teamSize: toTeamSize(row.team_size),
    lockVersion: row.lock_version,
  };
}

export async function insertMatch(
  tx: TransactionSql,
  actorId: string,
  input: {
    motion: string;
    heldOn: string | null;
    round: string | null;
    affTeam: string;
    negTeam: string;
    rulesetId: string;
    rulesetVersion: string;
  },
): Promise<Match> {
  const rows = await tx<MatchRow[]>`
    INSERT INTO matches (motion, held_on, round, aff_team, neg_team,
                         ruleset_id, ruleset_version, created_by)
    VALUES (${input.motion}, ${input.heldOn}, ${input.round}, ${input.affTeam},
            ${input.negTeam}, ${input.rulesetId}, ${input.rulesetVersion}, ${actorId})
    RETURNING *`;
  const row = rows[0];
  if (!row) throw new ApiError("INTERNAL", "match を作成できませんでした");
  return toMatch(row);
}

/** 作成者を owner として登録する。RLS のポリシーはこの表を見る */
export async function insertOwnerAccess(
  tx: TransactionSql,
  matchId: string,
  actorId: string,
): Promise<void> {
  await tx`
    INSERT INTO match_access (match_id, actor_id, role)
    VALUES (${matchId}, ${actorId}, 'owner')
    ON CONFLICT (match_id, actor_id) DO NOTHING`;
}

export async function findMatch(tx: TransactionSql, id: string): Promise<Match | null> {
  const rows = await tx<MatchRow[]>`SELECT * FROM matches WHERE id = ${id}`;
  const row = rows[0];
  return row ? toMatch(row) : null;
}

/** 見えなければ 404。存在の有無を漏らさない */
export async function requireMatch(tx: TransactionSql, id: string): Promise<Match> {
  const match = await findMatch(tx, id);
  if (!match) throw new ApiError("NOT_FOUND", "対象の試合が見つかりません");
  return match;
}

/** 一覧。RLS が自分の見える範囲へ絞る */
export async function listMatches(tx: TransactionSql): Promise<Match[]> {
  const rows = await tx<MatchRow[]>`SELECT * FROM matches ORDER BY created_at DESC`;
  return rows.map(toMatch);
}

export async function listMembers(tx: TransactionSql, matchId: string): Promise<MatchMember[]> {
  const rows = await tx<MemberRow[]>`
    SELECT * FROM match_members WHERE match_id = ${matchId} ORDER BY seat`;
  return rows.map(toMember);
}

/**
 * 出場者の一括置換（API_SPEC.md §1 PUT /members）。
 *
 * team_size は行ごとに持つ（DATA_MODEL.md §2）。1 試合の中で食い違わせないため、
 * 置換は必ず全削除 → 全挿入で行う。部分更新の経路を作らない。
 */
export async function replaceMembers(
  tx: TransactionSql,
  matchId: string,
  teamSize: TeamSize,
  members: readonly { side: string; seat: string; displayName: string }[],
): Promise<MatchMember[]> {
  await tx`DELETE FROM match_members WHERE match_id = ${matchId}`;
  for (const m of members) {
    await tx`
      INSERT INTO match_members (match_id, side, seat, display_name, team_size)
      VALUES (${matchId}, ${m.side}, ${m.seat}, ${m.displayName}, ${teamSize})`;
  }
  return listMembers(tx, matchId);
}
