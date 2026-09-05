-- P4: ジョブ基盤（DATA_MODEL.md §4 / API_SPEC.md §0.2・§3 / TRANSCRIPTION.md §6）
--
-- ここで入る表は 1 枚。
--   transcription_jobs … DATA_MODEL.md §4
--
-- あわせて入るもの:
--   public.system_actor_id()                  … DATA_MODEL.md §4.1（内部ランナーの実行主体）
--   transcription_jobs_require_consent_trg    … HANDOFF.md 件17 の続き
--   transcription_jobs_guard_transition_trg   … TRANSCRIPTION.md §6.1
--   edit_logs_insert_member の差し替え         … システム actor が監査を書けるようにする
--
-- align_words（DATA_MODEL.md §4）は**ここでは作らない**。P5 のもの。
-- P4 の stub provider は AlignResult を返すところまでで、行は書かない。
--
-- 流すロール: app_migrator（DIRECT_URL / session mode・5432）。テーブル所有者になる。
-- app_server には P0 の ALTER DEFAULT PRIVILEGES 経由で GRANT が付く。
--
-- 冪等: 何度流しても同じ状態になるよう、IF NOT EXISTS / DROP ... IF EXISTS → CREATE で書く。

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- public.system_actor_id()（DATA_MODEL.md §4.1）
--
-- Vercel Cron から動く /api/v1/internal/jobs/run は match に紐づかず、
-- match_access にも載らない。RLS を素通りさせるのではなく、固定の UUID を 1 つ置く。
--
-- 【定義はこの関数ただ 1 つ】
-- 参照する側は 2 つある（RLSポリシー、サーバの SET LOCAL と sub ガード）が、
-- どちらもこの関数だけを見る。UUID を 2 箇所に書いてはならない。
-- 片方だけ変えたときに、
--   - ポリシーが誰にも一致しない → ランナーが黙って 0 行になる
--   - 古い値が通り続ける         → 塞いだつもりの穴が開いたまま
-- のどちらかになり、どちらもテストが緑のまま起きる。
-- pg_policies の式に system_actor_id() が現れ、UUIDリテラルが直書きされていないことを
-- ACCEPTANCE.md M41 で検査する。
--
-- 【値の選び方】
-- nil UUID（00000000-...-000000000000）は使わない。バグで actor_id が
-- 全ゼロになったとき、それがそのままランナー権限に化ける。
-- 明らかに人工物と分かり、かつ偶然生まれない値にする。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.system_actor_id()
  RETURNS uuid
  LANGUAGE sql
  IMMUTABLE
  SECURITY INVOKER
  SET search_path = pg_catalog
AS $$
  SELECT '70b00000-0000-4000-8000-000000000001'::uuid
$$;
--> statement-breakpoint
COMMENT ON FUNCTION public.system_actor_id() IS
  '内部ジョブランナーの実行主体。この UUID の定義はここ 1 箇所だけ。RLSポリシーとサーバのガードが両方ここを見る（DATA_MODEL.md §4.1 / API_SPEC.md §0.2）';
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'app_server') THEN
    -- 関数の EXECUTE は既定で PUBLIC に付くが、明示しておく（app_actor_id() と同じ）。
    -- 将来 REVOKE ... FROM PUBLIC したときに、ここだけ落ちる状態を作らない。
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.system_actor_id() TO app_server';
  ELSE
    RAISE NOTICE 'ロール app_server が無いため GRANT を飛ばしました。作成後に再度流してください。';
  END IF;
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- transcription_jobs（DATA_MODEL.md §4）
--
-- 【created_at を足した】
-- §4 の列一覧には無いが、「1回の呼び出しで最大1件進める」（API_SPEC.md §3.1）には
-- queued の中から次の 1 件を決める順序が要る。id は gen_random_uuid() で順序を持たない。
-- 順序を持たせないと、同じジョブが選ばれ続ける／永遠に選ばれないジョブができる。
-- DATA_MODEL.md §4 にも追記した。
--
-- 【created_by を足していない】
-- 誰が作ったかは edit_logs が持つ。§4 に無い列を足さない。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transcription_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id        uuid        NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,

  kind            text        NOT NULL,
  target_stage_no integer,

  status          text        NOT NULL DEFAULT 'queued',
  attempt         integer     NOT NULL DEFAULT 0,
  max_attempt     integer     NOT NULL DEFAULT 3,

  provider_id     text,
  model           text,

  -- サーバが決める。リクエストからは受け取らない（API_SPEC.md §3）。
  -- 受け取ると、クライアントが冪等キーを選べる＝二重実行を自分で作れる
  params_hash     text        NOT NULL,
  idempotency_key text,

  lock_version    integer     NOT NULL DEFAULT 0,

  started_at      timestamptz,
  finished_at     timestamptz,

  -- 所要時間・実トークン量・コスト実績。**行に残す**。
  -- メモリ上だけに持つと、関数インスタンスが再利用されたときに消える
  -- （TRANSCRIPTION.md §6.3）
  metrics         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  error           text,

  created_at      timestamptz NOT NULL DEFAULT now(),

  -- 冪等キー（TRANSCRIPTION.md §6.2）。
  --
  -- **NULLS NOT DISTINCT を外さないこと。**
  -- target_stage_no は stage_transcribe 以外では NULL であり、Postgres の既定では
  -- NULL 同士が重複とみなされない。素の UNIQUE にすると align / stage_detect / anchor は
  -- 何度でも作れてしまう。ジョブの 3/4 がこれに当たり、
  -- 「同じ冪等キーで二度実行しても結果が変わらない」（ACCEPTANCE.md M3・M38）が
  -- 通ったように見えて何も守っていない状態になる。
  CONSTRAINT transcription_jobs_idem_key
    UNIQUE NULLS NOT DISTINCT (match_id, kind, target_stage_no, params_hash),

  CONSTRAINT transcription_jobs_kind_check
    CHECK (kind IN ('align', 'stage_detect', 'stage_transcribe', 'anchor')),

  CONSTRAINT transcription_jobs_status_check
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'canceled')),

  -- target_stage_no を持つのは stage_transcribe だけ。両方向で縛る。
  -- 片側だけだと「align なのにステージ番号がある」行ができ、冪等キーが割れる
  CONSTRAINT transcription_jobs_target_stage_check
    CHECK (
      (kind = 'stage_transcribe' AND target_stage_no BETWEEN 1 AND 12)
      OR (kind <> 'stage_transcribe' AND target_stage_no IS NULL)
    ),

  CONSTRAINT transcription_jobs_attempt_check
    CHECK (attempt >= 0 AND max_attempt >= 1 AND attempt <= max_attempt),

  CONSTRAINT transcription_jobs_params_hash_check
    CHECK (params_hash ~ '^[0-9a-f]{64}$'),

  -- 走り出したなら開始時刻がある。終わったなら終了時刻がある。
  -- 「進捗をメモリ上だけで持つ」を構造で防ぐ（TRANSCRIPTION.md §6.3）
  CONSTRAINT transcription_jobs_started_at_check
    CHECK (status = 'queued' OR started_at IS NOT NULL),

  CONSTRAINT transcription_jobs_finished_at_check
    CHECK (status NOT IN ('succeeded', 'failed', 'canceled') OR finished_at IS NOT NULL),

  -- 成功したジョブは、何がどれだけ掛かったかを必ず持つ（ACCEPTANCE.md M43）。
  -- コスト実績の突合ができない成功を作らない（TRANSCRIPTION.md §6.2）
  CONSTRAINT transcription_jobs_success_metrics_check
    CHECK (
      status <> 'succeeded'
      OR (provider_id IS NOT NULL AND model IS NOT NULL AND metrics ? 'durationMs')
    )
);
--> statement-breakpoint

COMMENT ON TABLE public.transcription_jobs IS
  '転写・解析ジョブ。状態と実績を行に持つ（DATA_MODEL.md §4 / TRANSCRIPTION.md §6）';
--> statement-breakpoint
COMMENT ON COLUMN public.transcription_jobs.params_hash IS
  'kind / target_stage_no / ruleset_version / provider_id / model を正規化した SHA-256。サーバが決める';
--> statement-breakpoint
COMMENT ON COLUMN public.transcription_jobs.idempotency_key IS
  'API の Idempotency-Key。api_idempotency_keys とは別物で、両方持つ（API_SPEC.md §0.4）';
--> statement-breakpoint
COMMENT ON COLUMN public.transcription_jobs.created_at IS
  '次に進める 1 件を決める順序。id は順序を持たないため、これが無いと同じジョブが選ばれ続ける';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS transcription_jobs_match_idx
  ON public.transcription_jobs (match_id, created_at);
--> statement-breakpoint

-- ランナーが「次の 1 件」を引くための部分index。
-- 終わったジョブが積み上がっても、queued だけを見る
CREATE INDEX IF NOT EXISTS transcription_jobs_queued_idx
  ON public.transcription_jobs (created_at)
  WHERE status = 'queued';
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 許諾（HANDOFF.md 件17 の続き）
--
-- API 側は POST /matches/{id}/jobs が 409 CONSENT_REQUIRED で止める。
-- ここは二重目である。**条件を書き直さない。** 0001 の assert_consent_recorded() を呼ぶ。
-- 条件を書き写すと、片方だけ直したときに DB と API がずれる。
--
-- assert_consent_recorded() は SECURITY INVOKER なので、呼び出し元のロールで
-- matches を読む。RLS が効くため、**見えない match は「許諾なし」に見える＝拒否側に倒れる**
-- （件17 で実測済み）。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transcription_jobs_require_consent()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.assert_consent_recorded(NEW.match_id);
  RETURN NEW;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS transcription_jobs_require_consent_trg ON public.transcription_jobs;
--> statement-breakpoint
CREATE TRIGGER transcription_jobs_require_consent_trg
  BEFORE INSERT ON public.transcription_jobs
  FOR EACH ROW EXECUTE FUNCTION public.transcription_jobs_require_consent();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 状態遷移（TRANSCRIPTION.md §6.1）
--
--   queued ──> running ──> succeeded
--                 │
--                 ├──> failed     (attempt < max なら queued へ戻す)
--                 └──> canceled
--
-- 許す辺だけを列挙する。終了状態（succeeded / canceled）からは動かない。
-- failed からは retry で queued へ戻る。これが「部分再実行」（ACCEPTANCE.md M42）。
--
-- アプリ側の分岐を外しても通らないことを M36 の negative test で確かめる。
-- アプリだけで守ると、経路が増えたときに一つ書き忘れて素通りする。
--
-- 独自 SQLSTATE AD003 を足した（AD で始まるクラスは Postgres の標準に無い）。
-- errors.ts で 409 VERSION_CONFLICT へ写す。行が期待した状態から動いていた、の意味である。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transcription_jobs_guard_transition()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
BEGIN
  -- 状態を変えない更新（metrics の追記など）は素通しする
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF NOT (
       (OLD.status = 'queued'  AND NEW.status IN ('running', 'canceled'))
    OR (OLD.status = 'running' AND NEW.status IN ('succeeded', 'failed', 'canceled'))
    OR (OLD.status = 'failed'  AND NEW.status = 'queued')
  ) THEN
    RAISE EXCEPTION
      'ジョブの状態を % から % へは変えられません（job_id=%）', OLD.status, NEW.status, OLD.id
      USING ERRCODE = 'AD003';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS transcription_jobs_guard_transition_trg ON public.transcription_jobs;
--> statement-breakpoint
CREATE TRIGGER transcription_jobs_guard_transition_trg
  BEFORE UPDATE ON public.transcription_jobs
  FOR EACH ROW EXECUTE FUNCTION public.transcription_jobs_guard_transition();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS（DATA_MODEL.md §2.1「再帰させない」・§4.1）
--
-- match_access を直接参照する。0002 と同じ形。
--
-- ここにだけ、システム actor の節を足す（もう 1 箇所は edit_logs）。
-- matches / media_sources / match_members には足さない。
-- したがってシステム actor から assert_consent_recorded() を呼んでも matches が見えず
-- 拒否側に倒れるが、ランナーは INSERT をしない（UPDATE だけ）ので当たらない。
-- **この非対称は意図である。**
-- ---------------------------------------------------------------------------
ALTER TABLE public.transcription_jobs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.transcription_jobs FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS transcription_jobs_select_member ON public.transcription_jobs;
--> statement-breakpoint
CREATE POLICY transcription_jobs_select_member ON public.transcription_jobs
  FOR SELECT TO app_server
  USING (
    public.app_actor_id() = public.system_actor_id()
    OR EXISTS (
      SELECT 1 FROM public.match_access ma
       WHERE ma.match_id = transcription_jobs.match_id
         AND ma.actor_id = public.app_actor_id()
    )
  );
--> statement-breakpoint

-- INSERT にシステム actor の節を置かない。**ランナーはジョブを作らない。**
-- 作れるようにすると、許諾トリガが matches を読めない実行主体から INSERT され、
-- 「許諾なし＝拒否」に倒れる経路がランナーの中で静かに失敗し続ける。
DROP POLICY IF EXISTS transcription_jobs_insert_member ON public.transcription_jobs;
--> statement-breakpoint
CREATE POLICY transcription_jobs_insert_member ON public.transcription_jobs
  FOR INSERT TO app_server
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.match_access ma
       WHERE ma.match_id = transcription_jobs.match_id
         AND ma.actor_id = public.app_actor_id()
    )
  );
--> statement-breakpoint

-- USING と WITH CHECK の両方に同じ条件を置く。片方だけだと、
-- 見えている行を見えない match へ付け替えられる（0002 と同じ理由）。
DROP POLICY IF EXISTS transcription_jobs_update_member ON public.transcription_jobs;
--> statement-breakpoint
CREATE POLICY transcription_jobs_update_member ON public.transcription_jobs
  FOR UPDATE TO app_server
  USING (
    public.app_actor_id() = public.system_actor_id()
    OR EXISTS (
      SELECT 1 FROM public.match_access ma
       WHERE ma.match_id = transcription_jobs.match_id
         AND ma.actor_id = public.app_actor_id()
    )
  )
  WITH CHECK (
    public.app_actor_id() = public.system_actor_id()
    OR EXISTS (
      SELECT 1 FROM public.match_access ma
       WHERE ma.match_id = transcription_jobs.match_id
         AND ma.actor_id = public.app_actor_id()
    )
  );
--> statement-breakpoint

-- DELETE のポリシーは置かない。
-- retry は行を作り直さず status を queued へ戻す操作であり、ジョブを消す経路は
-- 設計に無い。実行履歴（attempt / metrics / error）はコスト実績の突合に使う。
-- ポリシーが無ければ RLS が拒否するので、DELETE は 0 行で静かに終わる。

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- edit_logs のINSERTポリシーを差し替える（0001 の edit_logs_insert_member）
--
-- ランナーがジョブの状態を変えたことも edit_logs に残す。残さないと、
-- 「誰がいつそのジョブを走らせたか」がどこにも無くなる。
-- defineHandler は変更系で audit.record() が 0 件だと 500 で落とす（HANDOFF.md 件14）。
-- **規則を緩めるのではなく、記録できる側に倒す**（件29 と同じ判断）。
--
-- actor = app_actor_id() の縛りは残す。他人の名前で記録を書けてはならない。
-- 足すのは「システム actor は match_access に居なくてよい」だけである。
-- SELECT には足さない。ランナーは edit_logs を読まない。
-- 読む必要が出たときに、そのとき足す。
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS edit_logs_insert_member ON public.edit_logs;
--> statement-breakpoint
CREATE POLICY edit_logs_insert_member ON public.edit_logs
  FOR INSERT TO app_server
  WITH CHECK (
    actor = public.app_actor_id()
    AND (
      public.app_actor_id() = public.system_actor_id()
      OR EXISTS (
        SELECT 1 FROM public.match_access ma
         WHERE ma.match_id = edit_logs.match_id
           AND ma.actor_id = public.app_actor_id()
      )
    )
  );
