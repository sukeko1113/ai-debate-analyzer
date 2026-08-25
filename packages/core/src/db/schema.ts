/**
 * Drizzle スキーマ（DATA_MODEL.md）。
 *
 * P0 の時点でドメインのテーブルは 1 枚も定義しない。
 * `matches` / `match_members` / `match_access` は P2、以降も TASKS.md の PR 単位で入る。
 * CLAUDE.md「スキーマの破壊的変更は一括で行う。散発的にフィールドを足さない」に従い、
 * P0 で先取りしない。
 *
 * P0 のマイグレーションが作るのは、全テーブルに共通する土台だけである。
 *   - app.actor_id を読むヘルパ関数 public.app_actor_id()
 *   - app_server への GRANT と DEFAULT PRIVILEGES
 * これらはテーブル定義を持たないため、drizzle-kit の custom マイグレーションとして
 * drizzle/0000_p0_rls_foundation.sql に手書きしてある。
 *
 * RLS の検証に使うプローブ表は、マイグレーションではなくテストの中で作って落とす
 * （tests/db/helpers/probe.ts）。本番に残さないためである。
 */
export {};
