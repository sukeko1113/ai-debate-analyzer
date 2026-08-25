-- P0: RLS の土台（DATA_MODEL.md §0.3 / DEV_ENVIRONMENTS.md §5）
--
-- ここで作るのは「恒久的に残るもの」だけである。
--   1. app.actor_id を読むヘルパ関数
--   2. 接続ロール app_server への GRANT
--   3. app_migrator が今後作るテーブルに自動で GRANT を付ける DEFAULT PRIVILEGES
--
-- テーブルは 1 枚も作らない。ドメインのテーブルは P2 以降で一括して入る。
-- RLS の検証に使うプローブ表は、マイグレーションではなくテスト内で作って落とす。
-- マイグレーションに入れると、削除が「覚えていれば消せる」に依存し、本番に残る。
--
-- 流すロール: app_migrator（DIRECT_URL / session mode・5432）
-- 冪等: 何度流しても同じ状態になるよう書く。

--> statement-breakpoint
-- 1. app.actor_id を読むヘルパ関数
--
-- RLS ポリシーはこの関数（または current_setting 自体）を参照する。
-- 未設定・空文字は NULL を返す。NULL は「誰でもない」であり、
-- `actor_id = app_actor_id()` は決して真にならない（＝1 行も見えない）。
-- SET LOCAL を発行しない経路が生まれても、それは「全部見える」ではなく
-- 「何も見えない」側に倒れる。
CREATE OR REPLACE FUNCTION public.app_actor_id()
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  SET search_path = pg_catalog
AS $$
  SELECT nullif(current_setting('app.actor_id', true), '')::uuid
$$;
--> statement-breakpoint
COMMENT ON FUNCTION public.app_actor_id() IS
  'RLS ポリシーが参照する実行主体。defineHandler がトランザクション冒頭で SET LOCAL する（API_SPEC.md §11）';
--> statement-breakpoint

-- 2〜3. app_server への権限
--
-- ロールが存在しない環境（新規 Supabase プロジェクトの初回など）でも
-- マイグレーションが止まらないよう、存在確認してから流す。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'app_server') THEN
    RAISE NOTICE 'ロール app_server が無いため GRANT を飛ばしました。作成後に再度流してください。';
    RETURN;
  END IF;

  -- スキーマと既存テーブル
  EXECUTE 'GRANT USAGE ON SCHEMA public TO app_server';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_server';
  EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_server';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.app_actor_id() TO app_server';

  -- 今後 app_migrator が作るテーブルにも自動で付ける。
  -- これが無いと、テーブルを足すたびに GRANT を書き忘れて本番でだけ落ちる。
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public '
       || 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_server';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public '
       || 'GRANT USAGE, SELECT ON SEQUENCES TO app_server';

  -- app_server にテーブルを作らせない。所有者は RLS を素通りするため、
  -- app_server が所有するテーブルができると RLS の前提が崩れる。
  EXECUTE 'REVOKE CREATE ON SCHEMA public FROM app_server';
END
$$;
