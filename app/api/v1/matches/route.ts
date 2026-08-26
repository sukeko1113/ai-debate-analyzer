/**
 * POST /api/v1/matches — 作成（作成者が owner になる）
 * GET  /api/v1/matches — 自分に見える試合の一覧
 *
 * API_SPEC.md §1。素の route.ts を書かない（§11）。
 * scripts/check-handler-routes.ts が defineHandler 由来でない export を落とす。
 */
import { ApiError, defineHandler } from "@core/http";
import { CreateMatchReq } from "@core/schema";
import { insertMatch, insertOwnerAccess, listMatches } from "@core/db/repo/matches";

export const runtime = "nodejs";

export const POST = defineHandler({
  auth: "authenticated",
  body: CreateMatchReq,
  // 副作用のある POST（API_SPEC.md §0.4）。
  // 画面Aの二重送信で試合が二つできるのを防ぐ
  idempotency: "required",
  handler: async ({ body, actor, tx, audit, ruleset }) => {
    // ruleset の版はサーバが持っているものと一致していなければならない。
    // 知らない版を記録すると、あとから「どのルールで解析したか」が辿れなくなる
    if (body.rulesetId !== ruleset.id || body.rulesetVersion !== ruleset.version) {
      throw new ApiError(
        "VALIDATION_FAILED",
        `未知の ruleset です（サーバが持っているのは ${ruleset.id} / ${ruleset.version}）`,
      );
    }

    const match = await insertMatch(tx, actor.id, body);
    await insertOwnerAccess(tx, match.id, actor.id);

    audit.record({
      entity: "matches",
      entityId: match.id,
      matchId: match.id,
      before: null,
      after: match,
    });
    audit.record({
      entity: "match_access",
      entityId: null,
      matchId: match.id,
      before: null,
      after: { actorId: actor.id, role: "owner" },
    });

    return { data: match, status: 201 };
  },
});

export const GET = defineHandler({
  auth: "authenticated",
  handler: async ({ tx }) => ({ data: { matches: await listMatches(tx) } }),
});
