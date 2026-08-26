-- P2: 試合まわりの中核テーブルと RLS（DATA_MODEL.md §2・§10・§11 / API_SPEC.md §0・§1・§11）
--
-- ここで入る表は 5 枚。
--   matches / match_access / match_members  … DATA_MODEL.md §2
--   edit_logs                                … DATA_MODEL.md §10（追記のみ）
--   api_idempotency_keys                     … API_SPEC.md §0.4 の記録先（P2 で追加）
--
-- 流すロール: app_migrator（DIRECT_URL / session mode・5432）。テーブル所有者になる。
-- app_server には P0 の ALTER DEFAULT PRIVILEGES 経由で GRANT が付く。
-- ここで GRANT を書かないのは意図的である（DEFAULT PRIVILEGES が効いていることの検査を兼ねる）。
--
-- 冪等: 何度流しても同じ状態になるよう、IF NOT EXISTS / OR REPLACE /
--       DROP ... IF EXISTS → CREATE の順で書く。

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 独自 SQLSTATE
--
-- 'AD' で始まるクラスは Postgres の標準エラークラスに存在しない（付録A・エラーコード表）。
-- defineHandler がこの値を見て HTTP のエラーコードへ写す（packages/core/src/http/errors.ts）。
--   AD001 = CONSENT_REQUIRED   許諾未記録のまま解析へ進もうとした
--   AD002 = APPEND_ONLY        追記専用テーブルを UPDATE / DELETE しようとした
-- ---------------------------------------------------------------------------

-- 許諾の検査を 1 か所に置く。P2 では matches のトリガから、
-- P4 では transcription_jobs のトリガから、同じ関数を呼ぶ。
-- 二か所に同じ条件を書くと必ずずれる（API_SPEC.md §0.5 CONSENT_REQUIRED）。
--
-- SECURITY INVOKER である。呼び出し元のロールで matches を読むので RLS が効き、
-- 見えない match は consent_recorded_at が NULL に見える＝拒否側に倒れる。
CREATE OR REPLACE FUNCTION public.assert_consent_recorded(p_match_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  STABLE
  SECURITY INVOKER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  v_recorded_at timestamptz;
BEGIN
  SELECT m.consent_recorded_at INTO v_recorded_at
    FROM public.matches m WHERE m.id = p_match_id;

  IF v_recorded_at IS NULL THEN
    RAISE EXCEPTION '許諾が記録されていないため解析へ進めません（match_id=%）', p_match_id
      USING ERRCODE = 'AD001';
  END IF;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION public.assert_consent_recorded(uuid) IS
  '許諾未記録の match で解析を始めさせない。P2 は matches のトリガ、P4 は transcription_jobs のトリガから呼ぶ（API_SPEC.md §0.5 CONSENT_REQUIRED）';
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- matches（DATA_MODEL.md §2）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.matches (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  motion                text        NOT NULL,
  held_on               date,
  round                 text,
  aff_team              text        NOT NULL,
  neg_team              text        NOT NULL,
  ruleset_id            text        NOT NULL DEFAULT 'henda-20',
  ruleset_version       text        NOT NULL,

  -- 許諾（PRIVACY_RETENTION.md）。consent_recorded_at が null なら解析を始められない
  consent_scope         text,
  consent_obtained_from text[]      NOT NULL DEFAULT '{}',
  consent_recorded_at   timestamptz,
  consent_expires_on    date,

  status                text        NOT NULL DEFAULT 'draft',
  lock_version          integer     NOT NULL DEFAULT 0,
  created_by            uuid        NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT matches_status_check
    CHECK (status IN ('draft','analyzing','reviewing','decided','locked')),
  CONSTRAINT matches_consent_scope_check
    CHECK (consent_scope IS NULL
        OR consent_scope IN ('practice_only','training_material','research','public')),
  -- 記録済みと言うなら、範囲と取得元が埋まっていること。
  -- 「consent_recorded_at だけ入っていて中身が空」を作らない
  CONSTRAINT matches_consent_complete_check
    CHECK (consent_recorded_at IS NULL
        OR (consent_scope IS NOT NULL AND cardinality(consent_obtained_from) > 0))
);
--> statement-breakpoint
COMMENT ON COLUMN public.matches.created_by IS
  '作成者。RLS の SELECT ポリシーがこれを見る。理由と副作用は同ポリシーのコメントを参照';
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- match_access（DATA_MODEL.md §2）— RLS ポリシーの参照先
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.match_access (
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL,
  role     text NOT NULL,
  PRIMARY KEY (match_id, actor_id),
  CONSTRAINT match_access_role_check CHECK (role IN ('owner','member','viewer'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS match_access_actor_idx ON public.match_access (actor_id);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- match_members（DATA_MODEL.md §2）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.match_members (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id     uuid    NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  side         text    NOT NULL,
  seat         text    NOT NULL,
  -- 保持レベルC（氏名）の削除時に null にする。
  -- 解析・観戦画面はこの列を参照しない（CLAUDE.md / BASIC_DESIGN_v05 §9.9）
  display_name text,
  team_size    integer NOT NULL,
  lock_version integer NOT NULL DEFAULT 0,

  CONSTRAINT match_members_side_check CHECK (side IN ('AFF','NEG')),
  CONSTRAINT match_members_seat_check
    CHECK (seat IN ('A1','A2','A3','A4','N1','N2','N3','N4')),
  CONSTRAINT match_members_team_size_check CHECK (team_size IN (3,4)),
  -- A* は AFF、N* は NEG。side と seat の食い違いを DB でも作れなくする
  CONSTRAINT match_members_seat_side_check
    CHECK (left(seat, 1) = CASE side WHEN 'AFF' THEN 'A' ELSE 'N' END),
  -- 3人チームに A4 / N4 は存在しない（条項 2.2 の担当者表）
  CONSTRAINT match_members_seat_within_team_check
    CHECK (right(seat, 1)::integer BETWEEN 1 AND team_size),

  CONSTRAINT match_members_unique_seat UNIQUE (match_id, side, seat)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS match_members_match_idx ON public.match_members (match_id);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- edit_logs（DATA_MODEL.md §10）— 追記のみ
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.edit_logs (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id  uuid        NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  entity    text        NOT NULL,
  entity_id uuid,
  before    jsonb,
  after     jsonb,
  actor     uuid        NOT NULL,
  at        timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS edit_logs_match_at_idx ON public.edit_logs (match_id, at);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api_idempotency_keys（API_SPEC.md §0.4）
--
-- DATA_MODEL.md v04 には無かった表である。§0.4 は Idempotency-Key を必須と定めながら
-- 記録先を定義していなかったため、P2 で追加した（DATA_MODEL.md §2.1 に追記済み）。
-- transcription_jobs.idempotency_key（§4）とは別物であり、§0.4 が言う
-- 「DB側でも別途担保する」の API 側にあたる。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.api_idempotency_keys (
  actor_id     uuid        NOT NULL,
  key          text        NOT NULL,
  endpoint     text        NOT NULL,
  request_hash text        NOT NULL,
  status_code  integer     NOT NULL,
  response     jsonb       NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, key)
);
--> statement-breakpoint

-- ===========================================================================
-- RLS
--
-- 全表 ENABLE ＋ FORCE。FORCE を付けるのは、テーブル所有者（app_migrator）にも
-- ポリシーを適用させるためである。付けないと所有者接続で素通りし、
-- 「テストが通ったように見えて何も検証していない」状態になる（DEV_ENVIRONMENTS.md §5）。
--
-- 【再帰を作らないこと】
-- matches のポリシーは match_access を参照する。ポリシー式の中で参照した表にも
-- RLS は適用されるので、match_access 側のポリシーを
-- 「同じ match の誰かが見えるなら見える」と書くと自己参照になり、
-- Postgres が infinite recursion detected in policy for relation "match_access" で落ちる。
-- そのため match_access の SELECT は「自分の行だけ」に限定してある。
-- matches 側の EXISTS 条件と完全に同じ形なので、絞り込みの結果は変わらない。
--
-- 【SECURITY DEFINER のヘルパを使っていないこと】
-- 一般的な再帰回避は SECURITY DEFINER 関数だが、この設計では使えない。
-- FORCE ROW LEVEL SECURITY を全表に付けているため、関数の所有者（app_migrator）にも
-- ポリシーが適用され、素通りできないからである。
-- BYPASSRLS を持つ専用ロールを作る案も、本番 Supabase で作れる保証がないため採らない。
-- ===========================================================================

ALTER TABLE public.matches              ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.matches              FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.match_access         ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.match_access         FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.match_members        ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.match_members        FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.edit_logs            ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.edit_logs            FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.api_idempotency_keys ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.api_idempotency_keys FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- match_access のポリシー
-- ---------------------------------------------------------------------------

-- 自分の行だけ。上の「再帰を作らないこと」を参照。
DROP POLICY IF EXISTS match_access_select_self ON public.match_access;
--> statement-breakpoint
CREATE POLICY match_access_select_self ON public.match_access
  FOR SELECT TO app_server
  USING (actor_id = public.app_actor_id());
--> statement-breakpoint

-- INSERT は「自分を、自分が作った match の owner として登録する」場合だけ。
--
-- これが無いと、任意の match_id を指定して自分に権限を生やせる（権限昇格）。
-- actor_id = app_actor_id() だけでは塞げない。match_id の正当性を必ず見る。
--
-- 参照している matches は、この時点では match_access の行がまだ無いので
-- created_by 側のポリシーで見えている（matches のポリシーのコメントを参照）。
DROP POLICY IF EXISTS match_access_insert_owner_self ON public.match_access;
--> statement-breakpoint
CREATE POLICY match_access_insert_owner_self ON public.match_access
  FOR INSERT TO app_server
  WITH CHECK (
    actor_id = public.app_actor_id()
    AND role = 'owner'
    AND EXISTS (
      SELECT 1 FROM public.matches m
       WHERE m.id = match_access.match_id
         AND m.created_by = public.app_actor_id()
    )
  );
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- matches のポリシー
-- ---------------------------------------------------------------------------

-- 【created_by を条件に含めている理由】
--
-- INSERT ... RETURNING は、返す行に対して SELECT ポリシーを要求する。
-- match を作った直後は match_access の行がまだ存在しない（FK の順序上、
-- matches を先に入れないと match_access を入れられない）ため、
-- match_access だけを見るポリシーだと「自分で作った match が自分に見えない」。
-- created_by を入れて、その一瞬を通す。
--
-- 【副作用】
-- 作成者は、あとで match_access から外されても（除名されても）この match を読める。
-- 共有段階の権限管理としては抜け穴である。P2 の時点では
-- 共有も除名も機能として存在しないため実害は無い。
--
-- 【いつ再検討するか】
-- 共有機能（他の actor を match_access へ招待し、外せるようにする PR）で見直す。
-- そのときは created_by を落とし、代わりに
--   「INSERT の直後だけ通す」ための別経路（作成専用の関数か、
--    match_access を先に入れられるよう FK を遅延させる）に置き換える。
-- DATA_MODEL.md §11 と HANDOFF.md「P2 から P3 への申し送り」にも同じ内容を残してある。
DROP POLICY IF EXISTS matches_select_member ON public.matches;
--> statement-breakpoint
CREATE POLICY matches_select_member ON public.matches
  FOR SELECT TO app_server
  USING (
    created_by = public.app_actor_id()
    OR EXISTS (
      SELECT 1 FROM public.match_access ma
       WHERE ma.match_id = matches.id
         AND ma.actor_id = public.app_actor_id()
    )
  );
--> statement-breakpoint

-- 作成できるのは「自分を created_by にした行」だけ。
-- 他人名義の match を作れると、そのまま他人の領域に行を置ける。
DROP POLICY IF EXISTS matches_insert_self ON public.matches;
--> statement-breakpoint
CREATE POLICY matches_insert_self ON public.matches
  FOR INSERT TO app_server
  WITH CHECK (created_by = public.app_actor_id());
--> statement-breakpoint

-- 更新できるのは match_access を持つ actor だけ。
-- ここでは created_by を見ない。作成者であることは「更新してよい」を意味しない。
-- 見えるだけの穴（上記の副作用）を、書き込みまで広げない。
DROP POLICY IF EXISTS matches_update_member ON public.matches;
--> statement-breakpoint
CREATE POLICY matches_update_member ON public.matches
  FOR UPDATE TO app_server
  USING (
    EXISTS (SELECT 1 FROM public.match_access ma
             WHERE ma.match_id = matches.id
               AND ma.actor_id = public.app_actor_id()
               AND ma.role IN ('owner','member'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.match_access ma
             WHERE ma.match_id = matches.id
               AND ma.actor_id = public.app_actor_id()
               AND ma.role IN ('owner','member'))
  );
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- match_members のポリシー（PUT /members は DELETE → INSERT の一括置換）
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS match_members_select_member ON public.match_members;
--> statement-breakpoint
CREATE POLICY match_members_select_member ON public.match_members
  FOR SELECT TO app_server
  USING (
    EXISTS (SELECT 1 FROM public.match_access ma
             WHERE ma.match_id = match_members.match_id
               AND ma.actor_id = public.app_actor_id())
  );
--> statement-breakpoint
DROP POLICY IF EXISTS match_members_write_member ON public.match_members;
--> statement-breakpoint
CREATE POLICY match_members_write_member ON public.match_members
  FOR ALL TO app_server
  USING (
    EXISTS (SELECT 1 FROM public.match_access ma
             WHERE ma.match_id = match_members.match_id
               AND ma.actor_id = public.app_actor_id()
               AND ma.role IN ('owner','member'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.match_access ma
             WHERE ma.match_id = match_members.match_id
               AND ma.actor_id = public.app_actor_id()
               AND ma.role IN ('owner','member'))
  );
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- edit_logs のポリシー
--
-- UPDATE / DELETE にもポリシーを置いてある。置かないと RLS が先に効いて
-- 「0 行更新」で静かに成功してしまい、呼び出し側は消えたと誤解する。
-- ポリシーで通し、トリガ（AD002）で明示的に落とす。
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS edit_logs_select_member ON public.edit_logs;
--> statement-breakpoint
CREATE POLICY edit_logs_select_member ON public.edit_logs
  FOR SELECT TO app_server
  USING (
    EXISTS (SELECT 1 FROM public.match_access ma
             WHERE ma.match_id = edit_logs.match_id
               AND ma.actor_id = public.app_actor_id())
  );
--> statement-breakpoint
DROP POLICY IF EXISTS edit_logs_insert_member ON public.edit_logs;
--> statement-breakpoint
CREATE POLICY edit_logs_insert_member ON public.edit_logs
  FOR INSERT TO app_server
  WITH CHECK (
    actor = public.app_actor_id()
    AND EXISTS (SELECT 1 FROM public.match_access ma
                 WHERE ma.match_id = edit_logs.match_id
                   AND ma.actor_id = public.app_actor_id())
  );
--> statement-breakpoint
DROP POLICY IF EXISTS edit_logs_update_blocked_by_trigger ON public.edit_logs;
--> statement-breakpoint
CREATE POLICY edit_logs_update_blocked_by_trigger ON public.edit_logs
  FOR UPDATE TO app_server
  USING (
    EXISTS (SELECT 1 FROM public.match_access ma
             WHERE ma.match_id = edit_logs.match_id
               AND ma.actor_id = public.app_actor_id())
  );
--> statement-breakpoint
DROP POLICY IF EXISTS edit_logs_delete_blocked_by_trigger ON public.edit_logs;
--> statement-breakpoint
CREATE POLICY edit_logs_delete_blocked_by_trigger ON public.edit_logs
  FOR DELETE TO app_server
  USING (
    EXISTS (SELECT 1 FROM public.match_access ma
             WHERE ma.match_id = edit_logs.match_id
               AND ma.actor_id = public.app_actor_id())
  );
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api_idempotency_keys のポリシー（自分のキーだけ）
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS api_idempotency_keys_own ON public.api_idempotency_keys;
--> statement-breakpoint
CREATE POLICY api_idempotency_keys_own ON public.api_idempotency_keys
  FOR ALL TO app_server
  USING (actor_id = public.app_actor_id())
  WITH CHECK (actor_id = public.app_actor_id());
--> statement-breakpoint

-- ===========================================================================
-- トリガ
-- ===========================================================================

-- edit_logs は追記のみ（DATA_MODEL.md §10）。
-- 例外は保持レベル削除時の伏せ字化だけであり、それは P17 で
-- SECURITY DEFINER 関数 redact_edit_logs() として別途入る。
CREATE OR REPLACE FUNCTION public.edit_logs_append_only()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'edit_logs は追記専用です（%）', TG_OP
    USING ERRCODE = 'AD002';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS edit_logs_no_update ON public.edit_logs;
--> statement-breakpoint
CREATE TRIGGER edit_logs_no_update BEFORE UPDATE ON public.edit_logs
  FOR EACH ROW EXECUTE FUNCTION public.edit_logs_append_only();
--> statement-breakpoint
DROP TRIGGER IF EXISTS edit_logs_no_delete ON public.edit_logs;
--> statement-breakpoint
CREATE TRIGGER edit_logs_no_delete BEFORE DELETE ON public.edit_logs
  FOR EACH ROW EXECUTE FUNCTION public.edit_logs_append_only();
--> statement-breakpoint

-- 許諾。API（409 CONSENT_REQUIRED）と DB の両方で拒否する。
-- 片方だけにすると迂回経路ができる（CLAUDE.md / TASKS.md P2）。
--
-- P2 に transcription_jobs は無い（P4）。P2 における「解析を開始しようとする」は
-- matches.status が draft を離れることと定義する。
-- P4 でジョブ表が入ったら、同じ assert_consent_recorded() を
-- transcription_jobs の BEFORE INSERT トリガから呼ぶこと。
CREATE OR REPLACE FUNCTION public.matches_require_consent()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status <> 'draft' AND NEW.consent_recorded_at IS NULL THEN
    RAISE EXCEPTION
      '許諾が記録されていないため status を % にできません（match_id=%）', NEW.status, NEW.id
      USING ERRCODE = 'AD001';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS matches_require_consent_trg ON public.matches;
--> statement-breakpoint
CREATE TRIGGER matches_require_consent_trg
  BEFORE INSERT OR UPDATE ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.matches_require_consent();
--> statement-breakpoint

-- ===========================================================================
-- 権限
--
-- テーブルへの GRANT は書かない。P0 の ALTER DEFAULT PRIVILEGES が付ける。
-- ここで書くと、DEFAULT PRIVILEGES が壊れていても気づけなくなる
-- （tests/db/rls-matches.test.ts が has_table_privilege で確認する）。
-- 関数は PUBLIC に EXECUTE が付くが、意図を明示するため app_server にも書く。
-- ===========================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'app_server') THEN
    RAISE NOTICE 'ロール app_server が無いため GRANT を飛ばしました。';
    RETURN;
  END IF;
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.assert_consent_recorded(uuid) TO app_server';
END
$$;
