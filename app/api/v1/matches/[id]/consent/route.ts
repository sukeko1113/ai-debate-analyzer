/**
 * POST /api/v1/matches/{id}/consent — 許諾の記録（owner のみ）
 *
 * 許諾は UI の注意書きではなく、API と DB の両方で効かせる（API_SPEC.md §1）。
 * ここは「記録する」側であり、拒否する側は
 *   - API:  PATCH /matches/{id} の status 変更
 *   - DB:   matches_require_consent_trg（drizzle/0001_p2_match_core.sql）
 * である。
 */
import { z } from "zod";
import { defineHandler } from "@core/http";
import { ConsentReq } from "@core/schema";
import { requireMatch } from "@core/db/repo/matches";
import { updateWithVersion } from "@core/db/optimistic";

export const runtime = "nodejs";

export const POST = defineHandler({
  auth: "match:owner",
  params: z.object({ id: z.uuid() }),
  body: ConsentReq,
  requireExpectedVersion: true,
  handler: async ({ params, body, tx, audit }) => {
    const before = await requireMatch(tx, params.id);

    const after = await updateWithVersion<{
      lock_version: number;
      consent_recorded_at: Date;
    }>(tx, {
      table: "matches",
      id: params.id,
      expectedVersion: body.expectedVersion,
      set: {
        consent_scope: body.scope,
        consent_obtained_from: body.obtainedFrom,
        consent_expires_on: body.expiresOn,
        // 記録した時刻はサーバが決める。クライアントから受け取らない
        consent_recorded_at: new Date(),
      },
    });

    audit.record({
      entity: "matches",
      entityId: params.id,
      matchId: params.id,
      before: {
        consentScope: before.consentScope,
        consentObtainedFrom: before.consentObtainedFrom,
        consentRecordedAt: before.consentRecordedAt,
        consentExpiresOn: before.consentExpiresOn,
      },
      after: {
        consentScope: body.scope,
        consentObtainedFrom: body.obtainedFrom,
        consentRecordedAt: after.consent_recorded_at.toISOString(),
        consentExpiresOn: body.expiresOn,
        // note は許諾の経緯。edit_logs にだけ残す（matches には列を持たない）
        note: body.note,
      },
    });

    return {
      data: {
        id: params.id,
        version: after.lock_version,
        consentRecordedAt: after.consent_recorded_at.toISOString(),
      },
      status: 200,
    };
  },
});
