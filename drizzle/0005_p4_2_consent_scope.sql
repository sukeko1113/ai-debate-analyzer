-- P4.2: consent_scope の値域を5値にする（v09 §13.3・PRIVACY_RETENTION.md §2）
--
-- 0001 は4値で作った。
--
--   practice_only / training_material / research / public
--
-- v09 が確定した値域は5値で、expert_reference が足りない
-- （v08 の practice は practice_only の書き損じ。HANDOFF.md 件39 B・件41 c）。
--
-- expert_reference は熟練ジャッジ参照DB（Phase C・v09 §17.7）専用の scope である。
-- 通常の録画許諾に「AIの参照データにする」は含まれない。だから既存のどれかを
-- 流用せず、別の値として取る。P21 はこの scope の試合以外を取り込まない。
--
-- 【なぜ 0001 を書き換えないか】
-- 既に流したマイグレーションを書き換えると、適用済みの環境と新規環境で
-- 到達する状態が変わる。drizzle は内容のハッシュで適用済みを判定するので、
-- 書き換えた 0001 は既存環境で二度と流れず、CHECK は4値のまま残る。
-- 手元だけ直って CI と本番が直らない、という形の事故になる。
--
-- 【運用は Phase C。値域だけ先に入れる】
-- CLAUDE.md「スキーマの破壊的変更は一括で行う」。P21 の直前に CHECK を
-- 差し替えると、そのときには matches に行があり、制約の追加が既存行の検査を伴う。
-- 行が無いいまのうちに入れておく。画面（app/matches/new）の選択肢には出さない。
--
-- 【行は消えない】
-- DROP CONSTRAINT は制約の定義を落とすだけで、matches の行には触らない。
-- 新しい CHECK は旧4値をすべて含む上位集合なので、既存行が弾かれることもない。
--
-- 流すロール: app_migrator（テーブル所有者）。冪等: DROP ... IF EXISTS → ADD。

--> statement-breakpoint
ALTER TABLE public.matches
  DROP CONSTRAINT IF EXISTS matches_consent_scope_check;
--> statement-breakpoint

ALTER TABLE public.matches
  ADD CONSTRAINT matches_consent_scope_check
  CHECK (consent_scope IS NULL
      OR consent_scope IN ('practice_only','training_material','research','public','expert_reference'));
--> statement-breakpoint

COMMENT ON COLUMN public.matches.consent_scope IS
  '許諾の範囲。5値（PRIVACY_RETENTION.md §2）。expert_reference は Phase C の熟練ジャッジ参照DB専用で、値域だけ先に入れてある（drizzle/0005）';
