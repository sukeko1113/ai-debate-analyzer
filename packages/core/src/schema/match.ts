/**
 * 試合のドメインスキーマ（DATA_MODEL.md §2 / API_SPEC.md §1）。
 *
 * HANDOFF.md 件6 の判断に従い、リクエスト用スキーマは「保存済みの形」から導出する。
 * 別々に書くと必ずずれる。サーバが決める列（id / lockVersion / createdBy /
 * createdAt / consent* / status）はリクエスト側に現れない。
 */
import { z } from "zod";
import { Uuid } from "./ids";
import { Side } from "./flow";
// 座席の語彙は担当者表（条項 2.2）と同じものである。ruleset 側の定義を借りる。
// ここで別に z.enum を書くと、片方だけ直したときに静かにずれる。
import { SeatLabel } from "../ruleset/schema";

export const MatchStatus = z.enum(["draft", "analyzing", "reviewing", "decided", "locked"]);
export type MatchStatus = z.infer<typeof MatchStatus>;

/** draft 以外は「解析へ進んだ」状態であり、許諾の記録を要求する（API_SPEC.md §0.5） */
export const ANALYSIS_STARTED_STATUSES = MatchStatus.options.filter(
  (s) => s !== "draft",
) as readonly MatchStatus[];

export const ConsentScope = z.enum(["practice_only", "training_material", "research", "public"]);
export type ConsentScope = z.infer<typeof ConsentScope>;

export const ConsentSource = z.enum(["student", "guardian", "school", "organizer"]);
export type ConsentSource = z.infer<typeof ConsentSource>;

export const MatchRole = z.enum(["owner", "member", "viewer"]);
export type MatchRole = z.infer<typeof MatchRole>;

/** 3人登録は病欠等の例外。既定は4人（条項 2.2） */
export const TeamSize = z.union([z.literal(3), z.literal(4)]);
export type TeamSize = z.infer<typeof TeamSize>;

/** 保存済みの形。API のレスポンスもこの形で返す */
export const Match = z.object({
  id: Uuid,
  motion: z.string().min(1).max(300),
  heldOn: z.iso.date().nullable(),
  round: z.string().max(20).nullable(),
  affTeam: z.string().max(100),
  negTeam: z.string().max(100),
  rulesetId: z.literal("henda-20"),
  rulesetVersion: z.string().min(1),
  consentScope: ConsentScope.nullable(),
  consentObtainedFrom: z.array(ConsentSource),
  consentRecordedAt: z.iso.datetime().nullable(),
  consentExpiresOn: z.iso.date().nullable(),
  status: MatchStatus,
  lockVersion: z.number().int(),
  createdBy: Uuid,
  createdAt: z.iso.datetime(),
});
export type Match = z.infer<typeof Match>;

export const MatchMember = z.object({
  id: Uuid,
  matchId: Uuid,
  side: Side,
  seat: SeatLabel,
  displayName: z.string().max(60).nullable(),
  teamSize: TeamSize,
  lockVersion: z.number().int(),
});
export type MatchMember = z.infer<typeof MatchMember>;

// ---------------------------------------------------------------------------
// リクエスト（API_SPEC.md §1）
// ---------------------------------------------------------------------------

/**
 * 作成。consent と status はここに無い。
 * 許諾は POST /consent、status は PATCH でしか動かない。
 */
export const CreateMatchReq = Match.pick({
  motion: true,
  heldOn: true,
  round: true,
  affTeam: true,
  negTeam: true,
  rulesetId: true,
  rulesetVersion: true,
});
export type CreateMatchReq = z.infer<typeof CreateMatchReq>;

/**
 * 更新。expectedVersion は必須（API_SPEC.md §0.3）。
 * 省略した更新は受け付けない。「最後に書いた人が勝つ」を作らない。
 */
export const PatchMatchReq = Match.pick({
  motion: true,
  heldOn: true,
  round: true,
  affTeam: true,
  negTeam: true,
  status: true,
})
  .partial()
  .extend({ expectedVersion: z.number().int() })
  .refine((o) => Object.keys(o).length > 1, {
    message: "更新対象がありません（expectedVersion だけでは更新できません）",
  });
export type PatchMatchReq = z.infer<typeof PatchMatchReq>;

/**
 * 許諾の記録。
 *
 * API_SPEC.md §1 のスニペットに expectedVersion は無いが、§0.3 が
 * 「lock_version を持つ全エンティティの更新は expectedVersion を必須とする」と定めており、
 * consent の記録は matches の更新である。§1 の書き漏らしとして扱い、ここでは要求する
 * （2026-08-26 に利用者が承認。HANDOFF.md「P2 から P3 への申し送り」に記録）。
 */
export const ConsentReq = z.object({
  expectedVersion: z.number().int(),
  scope: ConsentScope,
  obtainedFrom: z.array(ConsentSource).min(1),
  expiresOn: z.iso.date().nullable(),
  note: z.string().max(1000),
});
export type ConsentReq = z.infer<typeof ConsentReq>;

/**
 * 出場者の一括置換。
 *
 * side は seat から一意に決まる（A* は AFF、N* は NEG）。
 * HANDOFF.md 件2 と同じ理屈で二重入力にしたくないが、API_SPEC.md §1 の
 * PutMembersReq は side を明示的に持つため、受け取ったうえで
 * seat と食い違う場合は検証で落とす。無視するのではなく、矛盾を不可能にする。
 */
export const PutMembersReq = z
  .object({
    expectedVersion: z.number().int(),
    teamSize: TeamSize,
    members: z
      .array(
        z
          .object({
            side: Side,
            seat: SeatLabel,
            displayName: z.string().max(60),
          })
          .refine((m) => m.side === (m.seat.startsWith("A") ? "AFF" : "NEG"), {
            message: "seat の接頭辞と side が一致しません（A* は AFF、N* は NEG。条項 2.2）",
            path: ["side"],
          }),
      )
      .max(8),
  })
  .refine((o) => new Set(o.members.map((m) => m.seat)).size === o.members.length, {
    message: "seat が重複しています",
    path: ["members"],
  })
  .refine((o) => o.members.every((m) => Number(m.seat.slice(1)) <= o.teamSize), {
    message: "teamSize を超える座席が含まれています（3人チームに A4 / N4 は無い。条項 2.2）",
    path: ["members"],
  });
export type PutMembersReq = z.infer<typeof PutMembersReq>;
