# P0 キックオフ指示文

新しい Claude Code セッション（Web版）を開いて、以下をそのまま貼る。

---

## 貼る内容（ここから）

このリポジトリの `CLAUDE.md` と、次の文書を先に読んでください。

- `docs/BASIC_DESIGN_v04.md` 第4章（システム構成）
- `docs/DATA_MODEL.md` §0（DB接続方式）と §1（全体の原則）
- `docs/DEV_ENVIRONMENTS.md`（実行環境の使い分け）
- `docs/TASKS.md` の P0

**今回やるのは P0 だけです。P1 以降には進まないでください。**

P0 の受け入れ基準は `docs/TASKS.md` に書いてあります。特に次の5点は、
満たしたことを実際に確認できるまで完了としないでください。

1. クラウドセッション内で `service postgresql start` → drizzle マイグレーション →
   RLS テストが通ること
2. **テーブル所有者を接続ロールにすると RLS テストが失敗すること**を確認すること
   （所有者は RLS を素通りします。ここを確かめないとテストが空回りします）
3. `postgres.js` に `prepare: false` が設定され、それを検証するテストがあること
4. `check-no-real-data` が、テスト用に置いたダミーの `.mp3` を検出して失敗すること
5. Playwright で、メディア要素の `currentTime` が意図した位置に来ることを
   アサートできること（音は聞けなくても位置は検証できます）

やってはいけないことも `docs/TASKS.md` の P0 に列挙してあります。
特に **クラウドセッションから実 Supabase へ接続しない**こと。
DB の検証はセッション内の PostgreSQL 16 で行ってください。

**まず実装計画を提示してください。**
何をどの順で作り、各受け入れ基準をどのテストで確認するかを示してから、
承認を得たうえで手を動かしてください。

完了報告は `docs/ACCEPTANCE.md` §2.1 の形式で書いてください。
確認していないものを「確認しました」と書かないでください。

## 貼る内容（ここまで）

---

## 想定される最初のやりとり

エージェントが計画を出してくる。次を見て、抜けていたら指摘する。

- [ ] `packages/core/` と `app/` の分離があるか
- [ ] ロール構成が `app_migrator`（所有者）と `app_server`（`NOBYPASSRLS`）に分かれているか
- [ ] `ENABLE ROW LEVEL SECURITY` に加えて `FORCE ROW LEVEL SECURITY` があるか
- [ ] RLS の **negative test**（所有者で繋ぐと素通りしてしまうことの確認）があるか
- [ ] CI に typecheck / lint / test / `generate-schemas` 差分 / `check-no-real-data` が揃っているか
- [ ] `.env.example` と実際に読む環境変数が一致しているか

## P0 の後

- Vercel をつなぐ（Next.js の雛形ができてから。それ以前は deploy するものがない）
- P-1 が終わっていれば P1 へ。終わっていなければ P-1 を先に片付ける
