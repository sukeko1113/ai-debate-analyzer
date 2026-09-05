-- P4 追補: 走り出す前のジョブを取り消せるようにする（TRANSCRIPTION.md §6.1）
--
-- 0003 の transcription_jobs_started_at_check が、状態機械が許している辺を 1 つ塞いでいた。
--
--   queued ──> canceled
--
-- この辺は ALLOWED_TRANSITIONS にも transcription_jobs_guard_transition() にもある。
-- BEFORE UPDATE トリガは通るが、そのあと CHECK が落とす。実測:
--
--   PostgresError: new row for relation "transcription_jobs"
--     violates check constraint "transcription_jobs_started_at_check"
--
-- 元の条件は `status = 'queued' OR started_at IS NOT NULL` で、
-- 「走り出したなら開始時刻がある」つもりだった。**まだ走っていないジョブを取り消す**
-- 経路を数えていなかった。queued のジョブは started_at が NULL のまま canceled になる。
--
-- テストだけの問題ではない。API_SPEC.md §3 は cancel を queued / running に認めており、
-- 画面から「まだ始まっていないジョブを取り消す」を撃つと 23514 になる。
-- toApiError に 23514 の変換先は無いので、利用者には 500 INTERNAL が返る。
--
-- 【なぜ started_at を捏造しないか】
-- cancel 時に started_at = now() を書けば CHECK は通る。採らない。
-- 一度も走っていないジョブに開始時刻を入れると、metrics（所要時間・コスト実績）の
-- 突合で「実行していないのに実行時間がある」行になる。
-- **started_at が NULL のまま finished_at が入る形が、「実行せずに終わった」を正しく表す。**
--
-- finished_at 側は触らない。canceled は終端なので finished_at を必ず持つ
-- （判断: 利用者・2026-09-03。「終端なのに finished_at が NULL」の行を作らない。
-- 作ると「いつ終わったか」を引くたびに例外処理が要る）。
-- 0003 の transcription_jobs_finished_at_check がそれを担保しており、cancelJob も書いている。
--
-- 見つけ方: tests/db/job-transitions.test.ts の 25 組（5 状態 × 5 状態）の突き合わせ。
-- 正常系（queued → running → succeeded）だけを流すテストでは最後まで出てこない。
--
-- 流すロール: app_migrator。冪等: DROP ... IF EXISTS → ADD。

--> statement-breakpoint
ALTER TABLE public.transcription_jobs
  DROP CONSTRAINT IF EXISTS transcription_jobs_started_at_check;
--> statement-breakpoint

ALTER TABLE public.transcription_jobs
  ADD CONSTRAINT transcription_jobs_started_at_check
  CHECK (status IN ('queued', 'canceled') OR started_at IS NOT NULL);
--> statement-breakpoint

COMMENT ON COLUMN public.transcription_jobs.started_at IS
  '実際に走り出した時刻。走り出す前に取り消された（queued → canceled）行では NULL のまま。「実行せずに終わった」を表す（drizzle/0004）';
