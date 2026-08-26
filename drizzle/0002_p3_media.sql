-- P3: メディア取り込み（DATA_MODEL.md §3 / API_SPEC.md §2 / TRANSCRIPTION.md §7）
--
-- ここで入る表は 1 枚。
--   media_sources … DATA_MODEL.md §3
--
-- 流すロール: app_migrator（DIRECT_URL / session mode・5432）。テーブル所有者になる。
-- app_server には P0 の ALTER DEFAULT PRIVILEGES 経由で GRANT が付く（0001 と同じ理由で
-- ここに GRANT を書かない）。
--
-- 冪等: 何度流しても同じ状態になるよう、IF NOT EXISTS / DROP ... IF EXISTS → CREATE で書く。

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- media_sources（DATA_MODEL.md §3）
--
-- 【lock_version を持たない】
-- §0.3 は「lock_version を持つ全エンティティの更新は expectedVersion を必須とする」と
-- 定めるが、この表は lock_version を持たない。漏れではない。
-- 更新経路は次の 2 つだけで、どちらも purged_at の有無で構造的に分岐する。
--   1. retention の purge          … storage_path = null、purged_at を立てる
--   2. purge 後の再アップロード    … storage_path を入れ直し、purged_at を null に戻す
-- 通常の編集経路が無いため、「読んでから書くまでの間に他人が書き換えた」競合が起きない。
-- 同時 restore は UPDATE ... WHERE purged_at IS NOT NULL が後発側で 0 行になることで
-- 吸収され、0 行側は already_exists を返す（API_SPEC.md §2.2）。
--
-- 【URL を保存しない】
-- 署名URLは毎回発行する。列を持たせると、期限切れのURLがDBに残り続ける。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.media_sources (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id       uuid        NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,

  -- A削除時に null になる。行は消さない（PRIVACY_RETENTION.md §4）
  storage_path   text,
  -- 監査のため A削除後も残す。UNIQUE の相手でもある
  source_sha256  text        NOT NULL,

  duration_ms    integer     NOT NULL,
  mime           text        NOT NULL,
  bitrate        integer,
  channels       integer,
  origin         text        NOT NULL,

  -- 保持レベルC（氏名の匿名化）で null になるため NOT NULL にしない。
  -- actor_id は氏名ではないが、match_members を引けば人に辿れる（DATA_MODEL.md §3）
  uploaded_by    uuid,

  purged_at      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),

  -- 同じ音声を二度上げても行は増えない。重複はエラーではなく、
  -- already_exists / restored として扱う（API_SPEC.md §2.2）
  CONSTRAINT media_sources_match_sha_key UNIQUE (match_id, source_sha256),

  CONSTRAINT media_sources_sha256_check
    CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),

  -- 4値のみ。動画の mime を登録する経路は持たない（TRANSCRIPTION.md §7.1）
  CONSTRAINT media_sources_mime_check
    CHECK (mime IN ('audio/mpeg','audio/mp4','audio/wav','audio/x-m4a')),

  CONSTRAINT media_sources_origin_check
    CHECK (origin IN ('upload','extracted_in_browser','imported')),

  CONSTRAINT media_sources_duration_check
    CHECK (duration_ms > 0),

  -- purge した行は storage_path を持たない。逆に、生きている行は必ず持つ。
  -- 「消したのに参照が残っている」「生きているのに実体の場所が分からない」を作らない
  CONSTRAINT media_sources_purge_consistency_check
    CHECK ((purged_at IS NULL) = (storage_path IS NOT NULL))
);
--> statement-breakpoint

COMMENT ON TABLE public.media_sources IS
  '取り込んだ音声の指紋と保管場所。URLは保存しない（DATA_MODEL.md §3 / API_SPEC.md §2）';
--> statement-breakpoint
COMMENT ON COLUMN public.media_sources.storage_path IS
  'バケット media の中のパス {match_id}/{sha256}.{ext}。A削除で null になる';
--> statement-breakpoint
COMMENT ON COLUMN public.media_sources.uploaded_by IS
  '誰が上げたか。許諾の確認と削除の判断で使う。保持レベルCで null になる';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS media_sources_match_idx ON public.media_sources (match_id);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS（DATA_MODEL.md §2.1「再帰させない」・§3）
--
-- match_access を直接参照する。matches を経由すると 2 段になり、
-- ポリシー式の中の副問い合わせにも RLS が効くぶん条件が増えて読みにくい。
--
-- viewer を書けなくするのはアプリ側（auth: 'match:write' → accessDenial）である。
-- ここでは match_access に行があるかどうかまでしか見ない。
-- 役割による読み書き分離は共有段階で入れる（DATA_MODEL.md §11）。
-- ---------------------------------------------------------------------------
ALTER TABLE public.media_sources ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.media_sources FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS media_sources_select_member ON public.media_sources;
--> statement-breakpoint
CREATE POLICY media_sources_select_member ON public.media_sources
  FOR SELECT TO app_server
  USING (
    EXISTS (
      SELECT 1 FROM public.match_access ma
       WHERE ma.match_id = media_sources.match_id
         AND ma.actor_id = public.app_actor_id()
    )
  );
--> statement-breakpoint

DROP POLICY IF EXISTS media_sources_insert_member ON public.media_sources;
--> statement-breakpoint
CREATE POLICY media_sources_insert_member ON public.media_sources
  FOR INSERT TO app_server
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.match_access ma
       WHERE ma.match_id = media_sources.match_id
         AND ma.actor_id = public.app_actor_id()
    )
  );
--> statement-breakpoint

-- UPDATE は restore（purge 後の再アップロード）と、retention の purge で使う。
-- USING と WITH CHECK の両方に同じ条件を置く。片方だけだと、
-- 見えている行を見えない match へ付け替えられる。
DROP POLICY IF EXISTS media_sources_update_member ON public.media_sources;
--> statement-breakpoint
CREATE POLICY media_sources_update_member ON public.media_sources
  FOR UPDATE TO app_server
  USING (
    EXISTS (
      SELECT 1 FROM public.match_access ma
       WHERE ma.match_id = media_sources.match_id
         AND ma.actor_id = public.app_actor_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.match_access ma
       WHERE ma.match_id = media_sources.match_id
         AND ma.actor_id = public.app_actor_id()
    )
  );
--> statement-breakpoint

-- DELETE のポリシーは置かない。
-- A削除は行を消さず storage_path を null にして purged_at を立てる操作であり、
-- 行そのものを消す経路は設計に無い（PRIVACY_RETENTION.md §4）。
-- ポリシーが無ければ RLS が拒否するので、DELETE は 0 行で静かに終わらず、
-- 「消せない」ことがそのまま効く。
