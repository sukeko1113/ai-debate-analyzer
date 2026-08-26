/**
 * 役割と必要権限の対応（API_SPEC.md §0.2 / DATA_MODEL.md §11）。
 *
 * **DB のテストではこの表を埋められない。**
 * P2 の RLS は match_access に owner の行しか作らせない（作成者が自分を
 * owner として登録する経路しか無く、共有機能は後の PR にある）。
 * app_migrator で行を挿し込もうとしても FORCE ROW LEVEL SECURITY に阻まれる
 * （実測: new row violates row-level security policy for table "match_access"）。
 *
 * DB で作れないことを、検証しない理由にはしない。判断は純粋関数に出してある。
 */
import { describe, expect, it } from "vitest";
import { accessDenial } from "../../packages/core/src/db/repo/match-access";
import type { RequiredAccess } from "../../packages/core/src/db/repo/match-access";
import type { MatchRole } from "../../packages/core/src/schema/match";

const ROLES: (MatchRole | null)[] = ["owner", "member", "viewer", null];
const REQUIRED: RequiredAccess[] = ["read", "write", "owner"];

/** 期待表。read / write / owner の列がそれぞれ通るか */
const EXPECTED: Record<string, Record<RequiredAccess, boolean>> = {
  owner: { read: true, write: true, owner: true },
  member: { read: true, write: true, owner: false },
  viewer: { read: true, write: false, owner: false },
  null: { read: false, write: false, owner: false },
};

describe("accessDenial", () => {
  for (const role of ROLES) {
    for (const required of REQUIRED) {
      const key = role ?? "null";
      const allowed = EXPECTED[key]![required];
      it(`role=${key} / 必要=${required} → ${allowed ? "通る" : "拒否"}`, () => {
        const denial = accessDenial(role, required);
        if (allowed) {
          expect(denial).toBeNull();
        } else {
          expect(denial?.code).toBe("FORBIDDEN");
          expect(denial?.status).toBe(403);
        }
      });
    }
  }

  it("viewer は読めるが書けない（DATA_MODEL.md §11 共有段階）", () => {
    expect(accessDenial("viewer", "read")).toBeNull();
    expect(accessDenial("viewer", "write")?.message).toContain("viewer");
  });
});
