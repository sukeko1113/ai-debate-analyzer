/**
 * GET   /api/v1/matches/{id} — 試合・出場者・担当者表
 * PATCH /api/v1/matches/{id} — 更新。expectedVersion 必須（API_SPEC.md §0.3）
 */
import { z } from "zod";
import { ApiError, defineHandler } from "@core/http";
import { PatchMatchReq } from "@core/schema";
import { listMembers, requireMatch } from "@core/db/repo/matches";
import { updateWithVersion } from "@core/db/optimistic";
import { rosterFor, toTeamSize } from "@core/ruleset/roster";

export const runtime = "nodejs";

const Params = z.object({ id: z.uuid() });

/** DB の列名。camelCase のまま渡すと存在しない列を更新しようとする */
const COLUMN: Record<string, string> = {
  motion: "motion",
  heldOn: "held_on",
  round: "round",
  affTeam: "aff_team",
  negTeam: "neg_team",
  status: "status",
};

export const GET = defineHandler({
  auth: "match:read",
  params: Params,
  handler: async ({ params, tx, ruleset }) => {
    const match = await requireMatch(tx, params.id);
    const members = await listMembers(tx, params.id);
    // 担当者表は保存しない。ruleset と team_size から毎回導く（条項 2.2 / HANDOFF 件4）。
    // 保存すると ruleset の改定で古い表が残る
    const teamSize = members[0] ? toTeamSize(members[0].teamSize) : 4;
    return { data: { match, members, teamSize, roster: rosterFor(ruleset, teamSize) } };
  },
});

export const PATCH = defineHandler({
  auth: "match:write",
  params: Params,
  body: PatchMatchReq,
  requireExpectedVersion: true,
  handler: async ({ params, body, tx, audit }) => {
    const before = await requireMatch(tx, params.id);

    const { expectedVersion, ...patch } = body;
    const set: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      const column = COLUMN[key];
      if (!column) throw new ApiError("VALIDATION_FAILED", `更新できない項目です: ${key}`);
      set[column] = value;
    }

    // 許諾（API_SPEC.md §0.5 CONSENT_REQUIRED）。
    // draft を離れる＝解析へ進む、と定義する。
    // 同じ検査を DB のトリガ matches_require_consent_trg も行う。
    // ここだけにすると、API を通らない経路が迂回路になる。
    if (patch.status !== undefined && patch.status !== "draft" && !before.consentRecordedAt) {
      throw new ApiError(
        "CONSENT_REQUIRED",
        "許諾が記録されていないため、解析を開始できません（POST /consent を先に行ってください）",
      );
    }

    const after = await updateWithVersion(tx, {
      table: "matches",
      id: params.id,
      expectedVersion,
      set,
    });

    audit.record({
      entity: "matches",
      entityId: params.id,
      matchId: params.id,
      before,
      after: { ...patch, lockVersion: after.lock_version },
    });

    return { data: { id: params.id, version: after.lock_version } };
  },
});
