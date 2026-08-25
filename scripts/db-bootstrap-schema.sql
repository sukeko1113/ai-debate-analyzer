-- 対象データベース内の初期設定。db-bootstrap.sql のあとに、そのDBへ接続して流す。
--
-- ここでは USAGE と、app_server に CREATE させないことだけを決める。
-- テーブルへの GRANT と DEFAULT PRIVILEGES はマイグレーション
-- （drizzle/0000_p0_rls_foundation.sql）が app_migrator として設定する。
-- 本番の Supabase でも同じ経路になるようにするため、ここには書かない。

\set ON_ERROR_STOP on

GRANT USAGE ON SCHEMA public TO app_server;

-- app_server がテーブルを作れると、そのテーブルの所有者になり RLS を素通りする
REVOKE CREATE ON SCHEMA public FROM app_server;

-- マイグレーションを流すのは app_migrator。public にオブジェクトを作れる必要がある
GRANT CREATE, USAGE ON SCHEMA public TO app_migrator;
