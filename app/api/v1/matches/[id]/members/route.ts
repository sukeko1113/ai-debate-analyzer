/**
 * PUT /api/v1/matches/{id}/members — 出場者の一括置換
 *
 * team_size（3 or 4）に応じて担当者表が切り替わる（TASKS.md P2 受け入れ基準5）。
 * 担当者表そのものは保存せず、ruleset から導いて応答に載せる。
 */
import { z } from "zod";
import { defineHandler } from "@core/http";
import { PutMembersReq } from "@core/schema";
import { listMembers, replaceMembers, requireMatch } from "@core/db/repo/matches";
import { bumpVersion } from "@core/db/optimistic";
import { rosterFor } from "@core/ruleset/roster";

export const runtime = "nodejs";

export const PUT = defineHandler({
  auth: "match:write",
  params: z.object({ id: z.uuid() }),
  body: PutMembersReq,
  requireExpectedVersion: true,
  handler: async ({ params, body, tx, audit, ruleset }) => {
    await requireMatch(tx, params.id);
    const before = await listMembers(tx, params.id);

    // 一括置換は matches の版で守る。match_members は行ごとに増減するため、
    // 行の lock_version では「置換全体」の競合を表せない
    const version = await bumpVersion(tx, "matches", params.id, body.expectedVersion);

    const after = await replaceMembers(tx, params.id, body.teamSize, body.members);

    audit.record({
      entity: "match_members",
      entityId: null,
      matchId: params.id,
      before,
      after,
    });

    return {
      data: {
        version,
        teamSize: body.teamSize,
        members: after,
        roster: rosterFor(ruleset, body.teamSize),
      },
    };
  },
});
