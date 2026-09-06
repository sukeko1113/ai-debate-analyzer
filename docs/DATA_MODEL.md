# DATA_MODEL.md — DB接続・テーブル定義・制約

DB: Supabase PostgreSQL（東京 ap-northeast-1）

列の型と CHECK の正本。テーブルの一覧と層の割当は `BASIC_DESIGN_v09.md` §12.1、
Zod の形は同 §13 を見ること。本書は v09 §12（テーブル一覧・RLS・ビュー）に追随している（2026-09-06）。
P4 までに実装済みの表は列をそのまま残し、v07〜v09 で足した列は **太字** で示す。
Zod と DB の CHECK が v09 に追随するのは P4.2（スキーマ先行 PR）であり、それまでは
`packages/core/src/schema/` と本書に食い違いがある。食い違ったら本書と v09 を正とする。

---

## 0. DB接続方式（v04で確定）

### 0.1 Data API は無効。DBアクセスは Postgres 接続で行う

v03には矛盾があった。「Data APIを無効にする」と書きながら、
「service role key でDBへアクセスする」とも書いていた。
`supabase-js` からのDBアクセスは PostgREST（＝Data API）経由なので、この二つは両立しない。

**v04の確定：**

| 用途 | 経路 | 認証情報 |
| --- | --- | --- |
| **DB読み書き** | Next.js Server → **Supavisor プーラー（transaction mode / 6543）** → Postgres | `DATABASE_URL`（専用ロール `app_server`） |
| **マイグレーション** | CI → **session mode（5432）または direct connection** | `DIRECT_URL`（`app_migrator`） |
| **Storage** | サーバから署名URL発行・削除 | `SUPABASE_SERVICE_ROLE_KEY` |
| **Auth** | JWT検証、招待などの管理操作 | `SUPABASE_SERVICE_ROLE_KEY` |
| **ブラウザ** | Auth（ログイン）と Storage（TUSアップロード）のみ | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |

- **Data API（PostgREST）はプロジェクト設定で無効のまま。** ブラウザからDBへ到達する経路を持たない。
- `SUPABASE_SERVICE_ROLE_KEY` は **Storage と Auth 専用**。DBアクセスには使わない。

### 0.2 ドライバとORM

| 項目 | 採用 | 理由 |
| --- | --- | --- |
| ドライバ | `postgres`（postgres.js） | 軽量。サーバレス関数と相性がよい |
| クエリ層 | Drizzle ORM | 型がスキーマから出る。Zodと二重定義にならない |
| マイグレーション | `drizzle-kit` | SQLファイルを生成し、リポジトリに残す |

**transaction mode（6543）は prepared statement を使えない。**
`postgres.js` では `prepare: false` を必ず指定する。指定を忘れると本番でだけ落ちる。

```ts
// packages/core/src/db/client.ts
import postgres from "postgres";
export const sql = postgres(process.env.DATABASE_URL!, {
  prepare: false,        // ← Supavisor transaction mode では必須
  max: 1,                // サーバレスでは接続を溜めない
  idle_timeout: 20,
});
```

マイグレーションは session mode / direct（5432）で流す。
transaction mode では `CREATE INDEX CONCURRENTLY` などが通らない。

### 0.3 RLS はサーバ接続でも効かせる

`postgres` スーパーユーザーで接続するとRLSが素通りする。**それをしない。**

- 専用ロール `app_server` を作る（`NOSUPERUSER` / `NOBYPASSRLS`）
- 全テーブルで `ENABLE ROW LEVEL SECURITY`
- ポリシーは `current_setting('app.actor_id', true)::uuid` を参照する
- **各リクエストはトランザクションを開き、最初に `SET LOCAL app.actor_id` を発行する**
  transaction mode でも `SET LOCAL` はトランザクション内に閉じるので安全に使える

```sql
CREATE ROLE app_server LOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO app_server;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_server;

CREATE POLICY match_member_read ON matches FOR SELECT TO app_server
USING (EXISTS (
  SELECT 1 FROM match_access ma
  WHERE ma.match_id = matches.id
    AND ma.actor_id = current_setting('app.actor_id', true)::uuid
));
```

`SET LOCAL` を発行しない経路を作らない。`API_SPEC.md` §11 の `defineHandler` が必ず発行する。

---

## 1. 全体の原則

| 原則 | 内容 |
| --- | --- |
| 不変 | `media_sources`, `align_words` は作成後に更新しない（削除時の伏せ字化と、**削除後の再アップロードによる復活**を除く。§3） |
| 分離 | AI出力（`*_runs`）と人間の確定（`*_decisions`）を別テーブルにする |
| 追記 | `edit_logs` は INSERT のみ。UPDATE / DELETE をトリガで拒否する |
| 二列 | AI出力は `*_ai`、人手は `*_human`。表示は `COALESCE(human, ai)` |
| 楽観ロック | 更新されうる全テーブルに `lock_version int NOT NULL DEFAULT 0` |
| サーバ割当 | Issue key、node id、確定状態はサーバが決める |
| 再現 | `export_runs` から、同じ資料を後から再生成できる |
| 削除可能 | 保持レベルA〜Dを段階的に消せる（`PRIVACY_RETENTION.md`） |

### 1.1 `lock_version` を持つテーブル

`matches`, `match_members`, `stage_segments`, `transcript_segments`, `issues`,
`argument_nodes`, `flow_links`, **`summary_links`**, `rule_flags`, `judge_decisions`,
`match_retention_policies`, `transcription_jobs`（12表。v09 §14.1）

更新は `WHERE id = $1 AND lock_version = $2` の条件付きUPDATE。
0行なら `409 VERSION_CONFLICT`。成功時に `lock_version = lock_version + 1`。

持たない表は理由が3種類ある。`media_sources` / `align_words` は不変（§1「不変」）。
`argument_node_scores` / `clash_events` / `issue_snapshots` / `official_decision_support` /
`hp_ledger` は**版を持って追記する**（v09 §12.4）ので行を更新しない。
`edit_logs` / `retention_events` は追記のみ。

---

## 2. 試合

### `matches`
| 列 | 型 | 制約 |
| --- | --- | --- |
| `id` | uuid | PK |
| `motion` | text | not null |
| `held_on` | date | |
| `round` | text | 予選1〜6 / Q-F / S-F / Final など |
| `aff_team`, `neg_team` | text | レベルC削除時に伏せる |
| `ruleset_id` | text | not null, 既定 `henda-20` |
| `ruleset_version` | text | not null |
| `consent_scope` | text | **5値**：`practice_only` / `training_material` / `research` / `public` / `expert_reference`（`PRIVACY_RETENTION.md` §2 と同じ。`expert_reference` は値域だけ先に入れ、運用は Phase C） |
| `consent_obtained_from` | text[] | `student` / `guardian` / `school` / `organizer` |
| `consent_recorded_at` | timestamptz | **null なら解析ジョブを作成できない** |
| `consent_expires_on` | date | |
| `status` | text | `draft` / `analyzing` / `reviewing` / `decided` / `locked` |
| **`panel_size`** | int | not null, 既定 1。**CHECK `panel_size % 2 = 1`（奇数）**。偶数は API では `400 VALIDATION_FAILED` の `details` に理由を返す。専用コードは作らない（v09 §14.2） |
| `lock_version` | int | |
| `created_by`, `created_at` | | |

> `consent_scope` の CHECK（`drizzle/0001`）と `schema/match.ts` の `ConsentScope` は P4 時点で4値であり、
> P4.2 で `expert_reference` を足す。`panel_size` は P12 で入れる（v09 §17.3。後から一意制約と一緒に足すと移行になる）。

> `consent_recorded_at` が null の match に対する転写ジョブ作成は
> **API（`409 CONSENT_REQUIRED`）とDBトリガの両方で拒否する。**

DB側の実体は `public.assert_consent_recorded(match_id)`（`SECURITY INVOKER`）である。
呼び出し元のロールで `matches` を読むのでRLSが効き、**見えない match は
`consent_recorded_at` が null に見える＝拒否側に倒れる**。

- P2: `matches_require_consent_trg`（BEFORE INSERT OR UPDATE ON matches）。
  `status` が `draft` を離れるとき、許諾が無ければ止める。
  P2 に `transcription_jobs` はまだ無いので、「解析を開始しようとする」を
  **`status` が `draft` を離れること**と定義している。
- P4: 同じ `assert_consent_recorded()` を `transcription_jobs` の
  BEFORE INSERT トリガから呼ぶこと。**条件を書き直さない。** 二か所に書くと必ずずれる。

### `match_members`
`id`, `match_id`, `side`(`AFF`/`NEG`), `seat`(`A1`〜`N4`), `display_name`（C削除時 null）,
`team_size`(3 or 4), **`intro_segment_id`**, **`name_source`**, **`seat_binding_status`**, `lock_version`

UNIQUE(`match_id`, `side`, `seat`)

座席と氏名の結び付け（v09 §8.6）。P7.5 で入れる。

| 列 | 型 | 制約 |
| --- | --- | --- |
| `intro_segment_id` | uuid | FK → `transcript_segments`。自己紹介での名乗り区間。保持レベルCの伏せ字対象（`PRIVACY_RETENTION.md` §3） |
| `name_source` | text | `self_introduction` / `registration` / `unknown` |
| `seat_binding_status` | text | `ai_suggested` / `rule_derived` / `human_confirmed`。`human_confirmed` は人の操作を受けた API だけが書ける |

名乗り区間が未特定（`intro_segment_id IS NULL` かつ `name_source <> 'registration'`）のまま
`seat_binding_status` を `human_confirmed` にする要求は `400 VALIDATION_FAILED`（`details` に理由）。
名乗りが聞き取れないスピーカーの `display_name` は空のままにする。推測で埋めない。

### `match_access`
`match_id`, `actor_id`, `role`(`owner`/`member`/`viewer`)

RLSポリシーの参照先。PK(`match_id`, `actor_id`)

> **P2 の時点で作れるのは `owner` の行だけである。**
> 「作成者が自分を owner として登録する」以外の INSERT をポリシーが許していない。
> `member` / `viewer` の行を作る経路（共有機能）は後のPRで入る。
> それまで `role` の3値は、**語彙としては定義済み・データとしては owner のみ**である。

### `api_idempotency_keys`（v05でP2に追加）
`actor_id`, `key`, `endpoint`, `request_hash`, `status_code`, `response` jsonb, `created_at`

PK(`actor_id`, `key`)

`API_SPEC.md` §0.4 の `Idempotency-Key` を記録する場所。
v04ではヘッダを必須と定めながら、記録先を定義していなかった。

- 同じキー＋同じ `request_hash` の再送は、**新規作成せず保存済みの `response` を200で返す**。
- 同じキーで `request_hash` が違えば `400`。
- `transcription_jobs.idempotency_key`（§4）とは別物である。
  §0.4 が言う「DB側でも別途担保する」の**API側**にあたり、両方を持つ。
- 記録と再送判定は、ハンドラ本体と**同じトランザクション内**で行う。
  外に出すと、記録の直前に落ちたときに二重実行できてしまう。

---

## 2.1 試合まわりのRLS（P2で確定）

ポリシーの実体は `drizzle/0001_p2_match_core.sql` にある。設計上の要点は3つ。

### 再帰させない

`matches` のSELECTポリシーは `match_access` を参照する。
**ポリシー式の中で参照した表にもRLSは適用される**ので、`match_access` 側を
「同じmatchの誰かが見えるなら見える」と書くと自己参照になり、
`infinite recursion detected in policy for relation "match_access"` で落ちる。

そのため `match_access` のSELECTは **`actor_id = app_actor_id()`（自分の行だけ）** に限定する。
`matches` 側のEXISTS条件と同じ形なので、絞り込みの結果は変わらない。

一般的な再帰回避である `SECURITY DEFINER` 関数は**使えない**。
全表に `FORCE ROW LEVEL SECURITY` を付けているため、関数の所有者（`app_migrator`）にも
ポリシーが適用され、素通りできないからである。
`BYPASSRLS` を持つ専用ロールを作る案も、本番Supabaseで作れる保証がないため採らない。

### `matches` のSELECTポリシーが `created_by` を見る理由と、その副作用

```sql
USING (created_by = public.app_actor_id()
    OR EXISTS (SELECT 1 FROM match_access ma
                WHERE ma.match_id = matches.id AND ma.actor_id = public.app_actor_id()))
```

**なぜ必要か**: `INSERT ... RETURNING` は、返す行に対してSELECTポリシーを要求する。
match を作った直後は `match_access` の行がまだ存在しない（FKの順序上、`matches` を
先に入れないと `match_access` を入れられない）ため、`match_access` だけを見るポリシーだと
**自分で作った match が自分に見えない**。

**副作用**: 作成者は、あとで `match_access` から外されても（除名されても）この match を読める。
共有段階の権限管理としては抜け穴である。P2の時点では共有も除名も機能として存在しないため
実害はないが、放置してよい性質ではない。

**いつ再検討するか**: 共有機能（他のactorを `match_access` へ招待し、外せるようにするPR）で見直す。
そのときは `created_by` を落とし、「INSERTの直後だけ通す」ための別経路
（作成専用の関数か、`match_access` を先に入れられるようFKを遅延させる）に置き換える。

なお **UPDATEポリシーは `created_by` を見ない**。作成者であることは「更新してよい」を意味しない。
見えるだけの穴を、書き込みまで広げない。

### `match_access` のINSERTを絞る

```sql
WITH CHECK (actor_id = public.app_actor_id() AND role = 'owner'
        AND EXISTS (SELECT 1 FROM matches m
                     WHERE m.id = match_access.match_id AND m.created_by = public.app_actor_id()))
```

`actor_id = app_actor_id()` だけでは足りない。それだけだと、**任意の `match_id` を指定して
自分に権限を生やせる**（権限昇格）。`match_id` の正当性を必ず見る。

---

## 3. メディア

### `media_sources`
`id`, `match_id`, `storage_path`（A削除時 null）, `source_sha256`, `duration_ms`,
`mime`, `bitrate`, `channels`, `origin`, `uploaded_by`, `purged_at`, `created_at`

UNIQUE(`match_id`, `source_sha256`)。**URLは保存しない。**
署名URLは毎回発行する（`API_SPEC.md` §2）。

`mime` は4値のみ（`audio/mpeg` / `audio/mp4` / `audio/wav` / `audio/x-m4a`）。
CHECK で担保する。動画の mime を登録する経路は持たない（`TRANSCRIPTION.md` §7.1）。

#### `uploaded_by` を持つ理由

`edit_logs` にも actor は残るが、**行そのものに残す**。
誰が上げた音声かは、許諾の確認や削除の判断で効く。ログを掘らずに引けることに価値がある。

`uploaded_by` は **保持レベルC（氏名の匿名化）の対象である**。
`actor_id` は氏名ではないが、`match_members` を引けば人に辿れる
（`PRIVACY_RETENTION.md` §4）。

#### `lock_version` を持たない理由

§0.3 は「`lock_version` を持つ全エンティティの更新は `expectedVersion` を必須とする」と定めるが、
**`media_sources` は `lock_version` を持たない**（§1.1 の一覧にも入っていない）。漏れではない。

更新経路は次の2つだけである。

1. retention の purge（`storage_path = null`、`purged_at` を立てる）
2. purge 後の再アップロードによる復活（`storage_path` を入れ直し、`purged_at` を null に戻す）

**どちらも `purged_at` の有無で構造的に分岐する。** 通常の編集経路が無いため、
「読んでから書くまでの間に他人が書き換えた」という競合が起きない。楽観ロックの出番がない。

同時 restore（同じ purged 行に対する二つの `POST /media`）は、
`UPDATE ... WHERE purged_at IS NOT NULL` が**後発側で0行になる**ことで吸収される。
0行になった側は `already_exists` を返す（`API_SPEC.md` §2.2）。
先に SELECT してから UPDATE する形にすると、この競合を防げない。

#### RLS

`match_access` を**直接参照する**。`matches` を経由すると2段になり、読みにくいうえに
ポリシー式の中の副問い合わせにも RLS が効くため、条件が増える（§2.1「再帰させない」）。

```sql
ALTER TABLE media_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_sources FORCE ROW LEVEL SECURITY;

CREATE POLICY media_sources_select_member ON media_sources FOR SELECT TO app_server
USING (EXISTS (
  SELECT 1 FROM match_access ma
  WHERE ma.match_id = media_sources.match_id
    AND ma.actor_id = public.app_actor_id()
));
```

INSERT / UPDATE も同じ `EXISTS` 条件で書く。**`viewer` を書けなくするのはアプリ側**
（`auth: 'match:write'` → `accessDenial`）である。DB のポリシーは
`match_access` に行があるかどうかまでしか見ない。役割による読み書き分離は共有段階で入れる（§11）。

### `imports`
`id`, `match_id`, `kind`(`whosaid_json`), `schema_version`（**5以外は拒否**）,
`payload_hash`, `import_meta` jsonb, `imported_by`, `imported_at`

---

## 4. ジョブ

### `transcription_jobs`
| 列 | 型 | 制約 |
| --- | --- | --- |
| `id` | uuid | PK |
| `match_id` | uuid | FK |
| `kind` | text | `align` / `stage_detect` / `stage_transcribe` / `anchor` |
| `target_stage_no` | int | `stage_transcribe` のときのみ 1〜12 |
| `status` | text | `queued` / `running` / `succeeded` / `failed` / `canceled` |
| `attempt`, `max_attempt` | int | 既定 0 / 3 |
| `provider_id`, `model` | text | |
| `params_hash` | text | 冪等キーの一部 |
| `idempotency_key` | text | APIの `Idempotency-Key` |
| `lock_version` | int | 楽観ロック |
| `started_at`, `finished_at` | timestamptz | |
| `metrics` | jsonb | 所要時間・実トークン量・コスト実績 |
| `error` | text | |
| `created_at` | timestamptz | **次に進める1件を決める順序**（下記） |

`created_at` は v05 の列一覧には無かった。「1回の呼び出しで最大1件進める」（`API_SPEC.md` §3.1）には
`queued` の中から次の1件を決める順序が要り、`id`（`gen_random_uuid()`）は順序を持たない。
順序が無いと、同じジョブが選ばれ続けるか、永遠に選ばれないジョブができる。

`created_by` は**足していない**。誰が作ったかは `edit_logs` が持つ。

**UNIQUE NULLS NOT DISTINCT (`match_id`, `kind`, `target_stage_no`, `params_hash`)**

`NULLS NOT DISTINCT` を省略してはならない。`target_stage_no` は `stage_transcribe`
以外では NULL であり、**Postgres の既定では NULL 同士が重複とみなされない**。
素の `UNIQUE` にすると `align` / `stage_detect` / `anchor` は何度でも作れてしまい、
「同じ冪等キーで二度実行しても結果が変わらない」（`ACCEPTANCE.md` M3）が
**通ったように見えて何も守っていない**状態になる。ジョブの3/4がこれに当たる。

（`NULLS NOT DISTINCT` は PostgreSQL 15 以降。本件のローカル・CI・Supabase はいずれも 16 以上。）

INSERT を先に撃ち、UNIQUE違反（23505）を捕まえて既存を返す。
**`tx.savepoint()` で囲むこと**（`HANDOFF.md` 件26。囲まないと捕捉しても後続が動かない）。

許諾（`PRIVACY_RETENTION.md`）は BEFORE INSERT トリガから
`public.assert_consent_recorded(NEW.match_id)` を呼んで拒否する。
**条件を書き直さない。** §2 の `matches` 側と同じ関数を使う。

### 4.1 `public.system_actor_id()` — 内部ランナーの実行主体

Vercel Cron から動く `/api/v1/internal/jobs/run` は match に紐づかず、
`match_access` にも載らない。RLS を素通りさせるのではなく、**固定の UUID を1つ置く**。

```sql
CREATE OR REPLACE FUNCTION public.system_actor_id()
  RETURNS uuid LANGUAGE sql IMMUTABLE SECURITY INVOKER
  SET search_path = pg_catalog
AS $$ SELECT '<uuid>'::uuid $$;
```

**定義はこの関数ただ1つ。** 参照する側は2つあるが、どちらも関数だけを見る。

| 参照元 | 形 |
| --- | --- |
| RLSポリシー | `... OR public.app_actor_id() = public.system_actor_id()` |
| サーバ（`SET LOCAL` する値、`sub` ガード） | `SELECT public.system_actor_id()` を引く。**TS側に UUID リテラルを置かない** |

**UUID を2箇所に書かない。** 片方だけ変えたときに、ポリシーが誰にも一致しない
（＝ランナーが黙って0行になる）か、逆に古い値が通り続ける穴が開く。
`pg_policies` の式に `system_actor_id()` が現れ、UUIDリテラルが直書きされていないことを
テストで検査する（`ACCEPTANCE.md` M41）。

節を足すのは **`transcription_jobs` と `edit_logs` の2表だけ**である。
`matches` / `media_sources` / `match_members` には足さない。
したがってシステム actor から `assert_consent_recorded()` を呼んでも `matches` が見えず
**拒否側に倒れる**が、ランナーは INSERT をしない（UPDATE だけ）ので当たらない。
この非対称は意図である。

**`sub` がこの値の JWT は 401 で弾く**（`API_SPEC.md` §0.2）。
弾かないと、この UUID の JWT を作れる者が全 match のジョブと編集履歴を読める。

### `align_words`（不変・Pass A出力）
`media_source_id`, `idx`, `word`, `start_ms`, `end_ms`, `confidence`

PK(`media_source_id`, `idx`)、`start_ms` にindex。**レベルB削除時に物理削除。**

**`speaker` 列は作らない**（v09 §6.4）。provider が話者ラベルを返しても取り込まない。
座席は担当者表と自己紹介の名乗りから決める（`match_members.seat_binding_status`）。
取り込みコードに話者ラベルへの参照があれば CI で失敗させる（`ACCEPTANCE.md` M53）。

この表を作るのは **P5**（`TASKS.md`）。P4 のジョブ基盤は stub provider が
`AlignResult` を返すところまでで、**行は書かない**。

---

## 5. ステージと逐語

### `stage_segments`
`id`, `match_id`, `stage_no`(1〜12), `type`, `side`, `seat`,
`start_ms`, `end_ms`, `role_status`, `confidence`, `name_announced`,
**`coverage_status`**, **`coverage_note`**, `lock_version`

UNIQUE(`match_id`, `stage_no`)
CHECK: 同一matchで `start_ms` 単調増加、区間が重ならない

`seat` は担当者表からサーバが導出する。**APIで受け取らない。**

| 列 | 型 | 制約 |
| --- | --- | --- |
| `coverage_status` | text | `complete` / `partial` / `missing`。既定 `complete`。**`missing` にできるのは人だけ**（P7.6） |
| `coverage_note` | text | 欠損の理由（録音停止・ファイル破損など） |

`coverage_status <> 'complete'` のステージは、(a) そのステージを `to` とする `DROPS` を導出しない
（代わりに `rule_flags` に `stage_coverage_gap` を立てる。`JUDGE_LOGIC.md` §4.1）、
(b) その区間の segment を判定根拠に引いたままロックできない（`409 GAPPED_STAGE_CITED`。§8）。
ステージ長の妥当性検査（v09 §8.5。規定時間の2倍超・1/3未満・合計差3分超）は
`rule_flags` の `stage_duration_anomaly` / `segment_duration_anomaly` に立てる。列は持たない。

### `prep_segments`
`id`, `match_id`, `kind`(`prep`/`chair_announcement`/`silence`), `after_stage_no`, `start_ms`, `end_ms`

準備時間とチェアパーソンのアナウンスを捨てない。

### `match_events`（12ステージの外側。v09 §3.5）
`id`, `match_id`, `kind`(`self_introduction` / `announcement` / `prep`), `start_ms`, `end_ms`, `note`

開会・自己紹介ラウンド、チェアパーソンのアナウンス、準備時間の区間。P7.5 で入れる。
`stage_no` を持たない `transcript_segments` は必ずこの表の行を `event_id` で指す。
**判定材料にしない。判定根拠として引用できない**（`422 NON_STAGE_SEGMENT_CITED`。§8）。

`prep_segments` との関係：`prep_segments` は P6 のステージ推定が出す「ステージ間の隙間」で、
`match_events` は「12ステージの外側にある人の発話区間」である。準備時間は両方に現れうるが、
`transcript_segments` が指すのは `match_events` だけ。

### `transcript_segments`
| 列 | 型 | 制約 |
| --- | --- | --- |
| `id` | uuid | PK |
| `match_id`, `stage_no`, `idx` | | `stage_no` は **NULL 可**（12ステージの外側）。UNIQUE(`match_id`,`stage_no`,`idx`) |
| **`event_id`** | uuid | FK → `match_events`。**`CHECK (stage_no IS NOT NULL OR event_id IS NOT NULL)`**。両方 NULL も両方非 NULL も拒否する（`ACCEPTANCE.md` M48） |
| `start_ms`, `end_ms` | int | 表示・再生に使う確定時刻 |
| `ai_start_ms`, `ai_end_ms` | int | AIが出した元の時刻 |
| `text_ai`, `text_human` | text | B削除時に両方 null |
| `text_status` | text | `ai_draft` / `human_edited` |
| `time_status` | text | `unverified` / `derived` / `human_verified` |
| `audibility` | text | `unknown` / `clear` / `partial` / `unheard` |
| `audibility_set_by` | uuid | **null なら人が設定していない** |
| `coverage` | real | Pass Cの被覆率 |
| `is_silence` | bool | 沈黙区間も保持する |
| `is_self_introduction` | bool | 名乗り区間の印（匿名化に使う）。**この列名に統一する。** v08 の `is_self_naming` は同じ列を指す（v09 改訂履歴 2）。開会の自己紹介（`event_id` 側）と各スピーチ冒頭の名乗り（`stage_no` 側）の両方に立つ |
| `text_purged_at` | timestamptz | |
| `lock_version` | int | |

```sql
CHECK (audibility = 'unknown' OR audibility_set_by IS NOT NULL)
CHECK (stage_no IS NOT NULL OR event_id IS NOT NULL)
CHECK (stage_no IS NULL OR event_id IS NULL)
```
**AIが `audibility` を書けないことをDBで担保する。**

`stage_no` が NULL の区間の一意性は v09 に記載が無い。`UNIQUE(match_id, stage_no, idx)` は
Postgres の既定では NULL 同士を重複とみなさないため、`stage_no` NULL の行は `idx` が衝突しても通る。
`UNIQUE NULLS NOT DISTINCT` にする案と、12ステージ外の区間は
`(match_id, event_id, idx)` で一意にする案がある。**P7.5 で比較して確定する**（`HANDOFF.md` 件41）。

意味論は `REVIEW_SEMANTICS.md` を読むこと。

---

## 6. フロー

### `issues`
`id`（**サーバ割当**）, `match_id`, `label`(`AD1`/`AD2`/`DA1`/`DA2`), `side`,
`title`(120字以内), `review_status`, `lock_version`

UNIQUE(`match_id`, `label`)
片側最大2件は、`label` のUNIQUEと `side` の対応で担保する（`AD*`=AFF / `DA*`=NEG）。

### `argument_nodes`
`id`（**サーバ割当**）, `match_id`, `issue_id`(null可), `kind`, **`node_type`**, **`link_order`**,
`stage_no`, `text`, `review_status`, `lock_version`

**内容の正本であり、スコアを直接持たない**（v09 §12.2）。時点別の評価は `argument_node_scores`。

| 列 | 型 | 制約 |
| --- | --- | --- |
| `kind` | text | `CLAIM` / `ATTACK` / `DEFENSE` / `QUESTION` / `ANSWER` / `SUMMARY_POINT` |
| `node_type` | text | `A_OBSERVATION` / `B_LINK` / `C_IMPACT` / `OTHER`。`CLAIM` 以外は null 可（v09 §9.5） |
| `link_order` | int | B_LINK の順序（1..n）。**`CHECK ((node_type = 'B_LINK') = (link_order IS NOT NULL))`** |

`node_type` は v09 で `role`（v05 の4構成要素 `present` / `effect` / `importance` / `evidence` ＋ `other`）を
置き換えた列である。**`legacy_role` は作らない**（flow テーブルはまだ無く、移行対象データが無い。v09 §9.5）。
`packages/core/src/schema/flow.ts` の `ArgumentRole` は P4.2 で `NodeType` へ一括で書き換える。

Evidence はノードではない。「なぜそう言えるか」の質は Support Quality タグ
（`EVIDENCE` / `WARRANT` / `RELEVANCE` / `BURDEN`。`argument_node_scores.support_tags`）として
A/B/C ノードの level の理由に保存し、引用の記録は `evidence_refs` に置く。詳細は `ARGUMENT_MODEL.md` §1。

### `node_segments`
`node_id`, `segment_id`。PK(`node_id`, `segment_id`)

**`argument_nodes` は最低1件の `node_segments` を持たなければならない。**
API側で必須にし、DB側は遅延制約トリガ（`CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED`）で担保する。
判定ロック時の「引用された segment」（§8 の `judge_cited_segments`）はこの表から辿る。

### `evidence_refs`
`id`, `node_id`, `source_type`(`fact_data`/`expert`/`news`),
`cited_elements` jsonb, `completeness`, `segment_id`

### `flow_links`
| 列 | 内容 |
| --- | --- |
| `id`, `match_id` | |
| `from_node`, `to_node` | uuid FK |
| `relation` | `ATTACKS` / `DEFENDS` / `EXTENDS` / `COMPARES` / `QUESTIONS` / `ANSWERS` / `CITES` / `DROPS` |
| `confidence` | real |
| `review_status` | **そのリンクが存在するか**（`suggested`/`reviewed`/`confirmed`/`excluded`） |
| **`effect_kind`** | やりとりの種別（**20値**。下記。`ARGUMENT_MODEL.md` §2） |
| **`rationale_ai`** | AIの説明文 |
| **`effectiveness_ai`** | `strong` / `partial` / `none`。**AIのみ**。人の説明用であり、判定式には使わない |
| **`effectiveness_human`** | 同上・null可。**人のみ・任意入力** |
| **`effectiveness_set_by`** | uuid。人が入れたときだけ埋まる |
| `lock_version` | |

**`comparison` は持たない。** v05 の `flow_links.comparison`（jsonb）は `summary_links` へ分離した（v09 §12.1）。
`schema/flow.ts` の `FlowLink.comparison` は P4.2 で `SummaryLink` へ書き換える。

relationごとに許される from/to の kind をトリガで検証する（`JUDGE_LOGIC.md` §4）。

`effect_kind` の値域は relation ごとに閉じる（v09 §13.2 の refine を CHECK でも持つ）。

| relation | 許される `effect_kind` | 必須か |
| --- | --- | --- |
| `ATTACKS` | `not_true` / `not_unique` / `not_necessary` / `no_link` / `no_solvency` / `alternative_solves` / `not_solvent` / `not_important` / `value_turn` / `evidence_weak` / `logic_jump`（11値） | 必須 |
| `DEFENDS` | `re_evidence` / `re_explain` / `counter_example` / `mitigate` / `re_link` / `concede` / `alt_limited`（7値） | 必須 |
| `ANSWERS` | `admits` / `declines_to_answer`（2値） | **任意**（v09 改訂履歴 5） |
| それ以外 | — | NULL |

```sql
CHECK (effectiveness_ai IS NULL OR effectiveness_set_by IS NULL
       OR effectiveness_human IS NOT NULL)
CHECK (effectiveness_human IS NULL OR effectiveness_set_by IS NOT NULL)
CHECK (CASE relation
         WHEN 'ATTACKS' THEN effect_kind IN (<11値>)
         WHEN 'DEFENDS' THEN effect_kind IN (<7値>)
         WHEN 'ANSWERS' THEN effect_kind IS NULL OR effect_kind IN ('admits','declines_to_answer')
         ELSE effect_kind IS NULL END)
```

> **`effectiveness` と `effect_kind` は AI 参考判定の計算にも人間 Ballot にも入らない。**
> Flow 上の「何と何がつながるか」の正本はこの表、AI 参考判定の攻防計算の正本は `clash_events`
> であり、同じものとして統合しない（v09 §9.6・§12.2）。
> 勝敗を決めるのは `judge_decisions` の Probability / Value / Strength だけである。
> 判定の集計コードは `judge_flow_links` ビュー（下記）しか読めない。`flow_links` / `summary_links`
> への直接参照と `SELECT *` を CI で静的に検査する（`ACCEPTANCE.md` M22）。

### `summary_links`（Summary の比較。v06 で `flow_links.comparison` から分離）
| 列 | 内容 |
| --- | --- |
| `id`, `match_id` | |
| `link_id` | uuid FK → `flow_links`。`relation='COMPARES'` のリンク |
| `own_issue_id`, `opponent_issue_id` | uuid FK → `issues` |
| `source` | `debater` / `judge`。誰が持ち出した比較か（`ARGUMENT_MODEL.md` §5.2） |
| `axes` | jsonb。`ComparisonAxis[]`（`axis` 4値 / `favors` / `rationale` / `source` / `segment_ids`）。1件以上 |
| `review_status` | `suggested` / `reviewed` / `confirmed` / `excluded` |
| `lock_version` | |

CHECK：`axes[].source` はすべて `source` と一致する。`source='debater'` の軸は `segment_ids` が1件以上。
P11 で列を入れ、機能は P14（AD2/DA2 と全 relation）。

### `debate_evolution`（ビュー・v05で追加、v09 で導出元を変更）

「AD1が試合中にどう変化したか」は**新テーブルを作らず導出する**。
導出元は **`clash_events` と `argument_node_scores`（`snapshot_kind = 'event'`）** である（v09 §9.7）。
v05 は `stage_no` の順序と `flow_links` から再構成するとしていたが、各イベント前後の P / V / HP を
追うには時点別の評価が要る。定義は `ARGUMENT_MODEL.md` §4。

### `rule_flags`
`id`, `match_id`, `type`, `target_ref`, `rationale`,
`status`(`candidate`/`confirmed`/`rejected`), `decided_by`, `decided_at`, `lock_version`

`type` は **15値**（v09 §13.2 `RuleFlagType`。`HENDA_RULESET.md` §3）:
P1 の9値 `new_argument` / `extra_issue` / `over_time` / `over_word_limit` / `over_speech_rate` /
`speaker_role_mismatch` / `evidence_incomplete` / `own_calculation` / `premature_rebuttal`、
v07 の5値 `audibility_gap` / `stage_coverage_gap` / `stage_duration_anomaly` / `segment_duration_anomaly` /
`communication_in_content`、v09 の `dropped`（相手ステージにノードが1つも無く `DROPS` リンクを作れないとき）。

`status` の3値は `review_status` とは**別語彙**（`HANDOFF.md` 件5）。
列は P11 で入れ、機能（検出）は P15。**`candidate` のままのフラグは判定に影響しない。**
Rule State（`clash_events.rule_state`）との関係は `JUDGE_LOGIC.md` §3。

---

## 6.5 評価エンジン（L2 Internal Analysis）

v09 §3.6 の三層のうち L2。AI 参考判定（§7 の `official_decision_support`）の根拠であり、監査用。
**人間 Ballot（`judge_decisions` / `judge_issue_assessments_human`）はこの層を読まない。**
いずれも版を持って追記し、AI 再解析で過去行を上書きしない（v09 §12.2・§12.4）。列の Zod は v09 §13.4。
P1.5 で列を入れ、機能は P11.5（node score / snapshot）と P11.6（clash / Rule State）。

### `criteria_catalog`
`code`（PK）, `kind`(`NODE_TYPE`/`SUPPORT_QUALITY`/`ATTACK_TYPE`/`RULE_STATE`), `definition`, `rule_ref`

AI に渡すルーブリックの定義。プロンプトに埋め込まず、ここから引く。

### `argument_node_scores`（append-only）
| 列 | 型 | 制約 |
| --- | --- | --- |
| `id` | uuid | PK |
| `node_id` | uuid | FK → `argument_nodes` |
| `flow_run_id` | uuid | FK → `flow_runs` |
| `snapshot_kind` | text | `constructive_end` / `final` / `event` |
| `event_id` | uuid | FK → `clash_events`。**`CHECK ((snapshot_kind = 'event') = (event_id IS NOT NULL))`** |
| `level` | int | 0〜4。**AI が出すのはこれだけ** |
| `value` | real | 0〜1。サーバが `scoring_config.node_map` で `level` から写す |
| `support_tags` | text[] | `EVIDENCE` / `WARRANT` / `RELEVANCE` / `BURDEN` の部分集合 |
| `rationale` | text | not null |
| `segment_ids` | uuid[] | 1件以上 |
| `confidence` | real | 0〜1 |
| `evidence_status` | text | `verified` / `unverifiable` / `not_cited`（3値。v09 改訂履歴 7） |
| `impact_direction` | smallint | `+1` / `-1`。**`C_IMPACT` のノードだけ**が持つ |
| `scoring_config_version` | text | FK → `scoring_config.version` |

`constructive_end`（③終了時点）の snapshot は counterfactual（v09 §10.6）のため必須。
ASR や欠損で証拠を確認できないときは `level` を下げず `evidence_status = 'unverifiable'` にする。

### `clash_events`（攻防イベント台帳。AI 参考判定の攻防計算の正本）
| 列 | 型 | 制約 |
| --- | --- | --- |
| `id`, `match_id`, `flow_run_id` | | |
| `type` | text | `attack` / `defense` / `concession` / `clarification` / `comparison` / `value_turn` / `extension` |
| `speech_no` | int | 1〜12 |
| `speaker_seat` | text | `A1`〜`N4` |
| `target_argument_ids` | uuid[] | 論点全体攻撃のときだけ。人間確認を促す |
| `target_node_id` | uuid | FK → `argument_nodes`。原則必須。**`CHECK (target_node_id IS NOT NULL OR cardinality(target_argument_ids) > 0)`** |
| `link_id` | uuid | FK → `flow_links`。対応するリンクがあれば |
| `attack_type` | text | **8値** `NOT_NECESSARY` / `NOT_UNIQUE` / `NO_EFFECT` / `NOT_IMPORTANT` / `VALUE_TURN` / `EVIDENCE` / `RELEVANCE` / `BURDEN`。`type='attack'` で必須。`flow_links.effect_kind` からの対応は `ARGUMENT_MODEL.md` §2（多対一） |
| `attack_subtype` | text | `alternative_solves` / `not_solvent`。**`CHECK (attack_subtype IS NULL OR attack_type = 'NO_EFFECT')`** |
| `claimed_effect_cat` | text | `none` / `minor` / `moderate` / `major` / `decisive`。`type='attack'` で必須 |
| `support_cat` | text | `unsupported` / `weak` / `adequate` / `strong`。`type='attack'` で必須 |
| `recovery_cat` | text | `none` / `minor` / `partial` / `substantial` / `full`。`type='defense'` で必須 |
| `r_or_g` | real | 0〜1。**サーバ計算。AI は書かない**（`r = claimed_effect × support`、`g` は recovery） |
| `parent_event_id` | uuid | FK → `clash_events`。`type='defense'` で必須（親 Attack） |
| `rule_state` | text | **16値**（`JUDGE_LOGIC.md` §3.3）。サーバが `rule_state_table` から決める |
| `rule_state_ruleset_version` | text | 判定時の ruleset 版。後のルール更新で過去試合が変わらない |
| `status` | text | `suggested` / `reviewed` / `confirmed` / `excluded`。**書けるのは `POST /clash-events/{id}/review` だけ** |
| `rationale`, `confidence`, `segment_ids` | | `segment_ids` は1件以上 |

CHECK：`type='attack'` なら `attack_type` / `claimed_effect_cat` / `support_cat` が非 NULL。
`type='defense'` なら `parent_event_id` / `recovery_cat` が非 NULL。

`flow_links` は「何と何が関係するか」、`clash_events` は「いつ誰がどう攻撃・防御したか」。同じものとして統合しない。

### `rule_state_table`
`id`, `ruleset_version`, `speech_no`, `event_type`, `condition`, `rule_state`, `rule_ref`

サーバが `speech_no × event_type × condition → rule_state` を決める規則表。
例：`speech_no=7, event_type='attack', condition='target.stage_no = 3', rule_state='ADMISSIBLE', rule_ref='4.2.2'`。

### `issue_snapshots`
`id`, `issue_id`, `flow_run_id`, `snapshot_kind`, `a_value`, `b_values`（jsonb。`link_order` 順）, `c_value`,
`impact_direction`, `captured_after_stage`（`constructive_end` は 3）, `scoring_config_version`

---

## 7. Run と 確定

### `flow_runs`
`id`, `match_id`, `model`, `prompt_version`, `ruleset_version`, `created_at`

### `scoring_config`（L1 AI。カテゴリ→数値の写像）
`version`（PK）, `node_map`, `claimed_effect_map`, `support_map`, `recovery_map`（いずれも jsonb）,
`probability_hi_threshold`, `value_large_threshold`, `strength_strong_threshold`, `strength_none_threshold`,
`chain_rule`(`weakest_link`/`product`), `qa_effect_mode`(`cited_only`/`always`),
`value_turn_mode`(`review_gate`/`signed_net`), `summary_evidence_mode`（`comparison_only` 固定）, `created_at`

版を持って追記する。行を更新しない。P1.5。

### `official_decision_support`（L1 AI 参考判定）

**名前に official を含むが AI 側の表である**（v09 §12.3）。画面では常に「AI参考判定」と表示する。
P1.5 で列、P12.1 で機能。

| 列 | 型 | 制約 |
| --- | --- | --- |
| `id`, `match_id`, `flow_run_id` | | |
| `scoring_config_version` | text | FK → `scoring_config` |
| `issues` | jsonb | Issue ごとの `p` / `p_cat` / `v` / `v_cat` / `strength` / `strength_cat` / `impact_direction` / `decisive_event_ids`（1件以上）。最大4件 |
| `aff_sum`, `neg_sum`, `margin` | real | |
| `winner_suggestion` | text | `AFF` / `NEG` / `REVIEW_REQUIRED`。**`REVIEW_REQUIRED` は正常な状態** |
| `ai_confidence` | real | 0〜1 |
| `voting_issue_candidates` | jsonb | `survival_candidate` / `clash_candidate` / `clash_leverage` / `winner_flip_issues` / `selected` / `confidence`(`high`/`medium`/`low`) |
| `counterfactuals` | jsonb | **表ではなく列**。Issue ごとの `margin_final` / `margin_without_clash` / `clash_leverage` / `winner_flip` / `removed_event_ids` |
| `value_turn_gate` | jsonb | `present` / `issues` / `winner_with_turn` / `winner_without_turn` / `flips` |
| `new_argument_check` | bool | 採用可能イベントだけが寄与しているか |
| `comm_points_suggested` | jsonb | `{aff, neg}` 1〜5。音声由来の暫定案。null 可 |
| `review_reasons` | jsonb | `ReviewReason[]`。`code` は **6値** `UNVERIFIABLE_AFFECTS_MARGIN` / `COVERAGE_GAP_AFFECTS_MARGIN` / `VALUE_TURN_FLIPS_WINNER` / `VOTING_CANDIDATES_CONFLICT` / `SUMMARY_EVIDENCE_BOUNDARY` / `UNRESOLVED_RULE_STATE` |
| `flags` | text[] | 例 `communication_in_content` |
| `explanation` | text | not null |
| `created_at` | | 版を持って追記 |

CHECK：`(winner_suggestion = 'REVIEW_REQUIRED') = (jsonb_array_length(review_reasons) > 0)`。

### `judge_runs`（AI案）
`id`, `match_id`, `flow_run_id`, `ruleset_version`, `model`,
`voting_issue_draft`, `winner_draft`, `created_at`

### `judge_issue_assessments`（AI案）
`judge_run_id`, `issue_id`, `probability`(`Hi`/`Lo`), `value`(`Large`/`Small`),
`strength`(`Strong`/`Weak`/`None`), **`residual_note`**

PK(`judge_run_id`, `issue_id`)。1 runにつき最大4件。`JudgeRun.assessments` の保存先（v09 §12.1）。

### `judge_decisions`（人間の確定。1ジャッジ1票）
| 列 | 型 | 制約 |
| --- | --- | --- |
| `id`, `match_id` | | |
| `winner` | text | **`AFF` / `NEG` のみ。引き分けを表現できない** |
| `voting_issue` | text | `AD1`/`AD2`/`DA1`/`DA2` |
| `comm_aff`, `comm_neg` | int | CHECK 1〜5 |
| `best_debater` | text | C削除時に座席ラベルへ置換 |
| `reason` | text | not null |
| **`reason_grounds`** | jsonb | `ReasonParagraph[]`（`text` / `ground` / `segment_ids` 1件以上）。1件以上。`ground` は `content` / `comparison` / `procedure` / `delivery` / `advice`（`JUDGE_LOGIC.md` §6） |
| **`compare_note`** | text | 残ったもの／削られたもの（v09 §11.2） |
| **`is_chief`** | bool | 審査委員長のバロットか |
| `decided_by`, `decided_at` | | |
| `locked_at` | timestamptz | **not null になったら以後変更不可** |
| `lock_version` | int | |

**UNIQUE(`match_id`, `decided_by`)**。同一ジャッジの2票目は `409 BALLOT_DUPLICATE`。
パネル結果は行として保存せず、ビュー `panel_result`（下記）で導出する。少数意見の行を消さない。
一意制約と `matches.panel_size` は P12 で入れる（後から張ると既存行の掃除になる）。パネル UI は P22。

**AI はこの表と `judge_issue_assessments_human` を書かない。** DB ロールで拒否する（§11 の `app_ai_worker`）。
AI 値を人間 Ballot へ自動コピーする機能は作らない（v09 §12.3）。

### `judge_issue_assessments_human`（人間の確定したDecision Chart）
`judge_decision_id`, `issue_id`, `probability`, `value`, `strength`, **`residual_note`**, **`segment_ids`** uuid[]

PK(`judge_decision_id`, `issue_id`)。v05 の `judge_decision_assessments` をこの名前に改めた（v09 §12.1）。

**`CHECK (strength <> 'None' OR (residual_note IS NOT NULL AND btrim(residual_note) <> ''))`**。
Strength=None には残存リスクの記述が要る（v09 §10.11）。
`segment_ids` は判定根拠として引用された segment に含める（§8 の `judge_cited_segments` が UNION する）。

**`judge_issue_assessments`（AI案）を上書きしない。別テーブルに保存する。**

### `export_runs`
`id`, `match_id`, `flow_run_id`, `judge_decision_id`, **`decision_support_id`**, `template_version`,
`output_paths` jsonb, `created_at`

どの human ballot / decision support / template version から作ったかを保持する（v09 §12.4）。

## 7.5 学習・観戦（L3 Learning）

判定側から import しない（`ACCEPTANCE.md` M25）。`ai_scoring_inputs` にも含めない。

### `hp_ledger`（append-only）
`id`, `match_id`, `issue_id`, `event_id`, `seq`, `hp_before`, `hp_after`（0〜10）, `delta`, `p`, `v`, `reason`, `scoring_config_version`

`HP = 10 × Strength`。human winner から逆算しない。P17.6。

### `delivery_scores`
`id`, `match_id`, `speech_no`, `speaker_seat`, `fluency`, `intelligibility`, `clarity`, `delivery_persuasiveness`（各 1〜5）,
`wpm`, `word_count`, `rationale`

L1 の P / V / Strength に入れない。P16 / P17.6。

## 7.6 ビュー

いずれも行として保存しない（v09 §12.1）。

| ビュー | 導出元 | 用途 |
| --- | --- | --- |
| `judge_cited_segments` | `judge_decisions` → `issues`(confirmed) → `argument_nodes`(confirmed) → `node_segments` ∪ `judge_issue_assessments_human.segment_ids` | ロック不変条件（§8） |
| `judge_flow_links` | `flow_links` から `effect_kind` / `effectiveness_*` / `rationale_ai` を除いた列 | 人間 Ballot 集計と判定ロック検査が読める唯一の `flow_links` |
| `ai_scoring_inputs` | confirmed な A/B/C（`argument_nodes`）、`rule_state` が `ADMISSIBLE*` の `clash_events`、`argument_node_scores`、`issue_snapshots`、`scoring_config` | AI Decision Support 計算が読める唯一の入力。`delivery_scores` と `hp_ledger` と `flow_links.effectiveness_*` は含めない |
| `panel_result` | `judge_decisions` の多数決 | `match_id` / `panel_size` / `ballots_cast` / `aff_votes` / `neg_votes` / `winner`（`ballots_cast < panel_size` なら NULL）/ `dissenting`（少数意見の id。消さない） |
| `debate_evolution` | `clash_events` ＋ `argument_node_scores`（`snapshot_kind='event'`） | Debate Evolution View（§6） |

---

## 8. ロック不変条件（v04で追加）

`judge_decisions.locked_at` を立てられるのは、次をすべて満たすときだけ（v09 §10.11 の8条件）。
**API（`POST /judge/ballots/{id}/lock`）とDBトリガの両方で検査する。**

1. `winner` / `voting_issue` / `comm_aff` / `comm_neg` / `reason` / `reason_grounds` が埋まっている
2. `voting_issue` に対応する `issues.review_status = 'confirmed'`
3. 判定根拠として引用された全 segment の `audibility` が **`clear` または `partial`** に人間確定している。`unknown`（まだ聞いていない）も `unheard`（聞き取れなかった）も不可
4. 引用された segment が属するステージの `stage_segments.coverage_status = 'complete'`（欠損ステージの引用不可）
5. 引用された segment の `stage_no IS NOT NULL`（自己紹介・アナウンスを根拠にしない）
6. `rule_flags` に `status = 'candidate'` が残っていない
7. `rule_state` が `INADMISSIBLE_*` の `clash_events` を `reason_grounds[].segment_ids` が根拠参照していない（明示的 override を作る場合は理由必須。P15）
8. `judge_issue_assessments_human` の `strength = 'None'` の行に `residual_note` がある（CHECK でも担保。§7）

```sql
-- 3〜5 の判定に使うビュー。API と DB トリガが同じビューを参照する
CREATE VIEW judge_cited_segments AS
SELECT DISTINCT jd.id AS judge_decision_id, ns.segment_id
FROM judge_decisions jd
JOIN issues i         ON i.match_id  = jd.match_id AND i.review_status = 'confirmed'
JOIN argument_nodes n ON n.issue_id  = i.id        AND n.review_status = 'confirmed'
JOIN node_segments ns ON ns.node_id  = n.id
UNION
SELECT a.judge_decision_id, unnest(a.segment_ids)
FROM judge_issue_assessments_human a;
```

v07 で人の Decision Chart（`judge_issue_assessments_human.segment_ids`）が根拠 segment を持つようになったため、
ビューはこの列も UNION する（v09 改訂履歴 6）。

違反時の応答。いずれも該当 id を `details` に返し、UI はそこへ直接ジャンプする（`API_SPEC.md` §7.2〜7.3）。

| 条件 | 応答 |
| --- | --- |
| `audibility = 'unknown'` が残る | `409 AUDIBILITY_UNRESOLVED`、`details.pendingSegmentIds` |
| `audibility = 'unheard'` を含む | `409 UNHEARD_CITED`、`details.unheardSegmentIds` |
| 属するステージの `coverage_status <> 'complete'` | `409 GAPPED_STAGE_CITED`、`details.gappedStageNos` と `segmentIds` |
| `stage_no IS NULL` | `422 NON_STAGE_SEGMENT_CITED`、`details.segmentIds` |

AI 参考判定の `winner_suggestion = 'REVIEW_REQUIRED'` は人間 Ballot のロックを**機械的には止めない**。
人が内容を確認し独立に判定できるためである。UI は Review Gate の未確認を目立たせる（v09 §10.11）。

> **なぜこれが要るのか。**
> `audibility = unknown` は「まだ人が聞いていない」を意味する。
> これを許すと、AIの文字起こしを人間が聞いたものとして判定に使ってしまう。
> 本設計が最も避けたい事故が、ちょうどここで起きる。
> `unheard` と `coverage_status` と `stage_no IS NULL` も同じ理屈で、
> 「ジャッジが実際に得た情報」の外にあるものを判定材料にしないための線である。

---

## 9. 保持と削除

保持レベルA〜Eと、レベルごとの削除操作は `PRIVACY_RETENTION.md` を正本とする。
DB側に必要なもの:

- `match_retention_policies`（`match_id` PK, `scope`, `purge_a_on`〜`purge_d_on`, `anonymize_c_immediately`, `lock_version`）
- `retention_events`（追記のみ。`level` は `A_media` / `B_transcript` / `C_identity` / `D_flow_judge`）
- `media_sources.purged_at` / `transcript_segments.text_purged_at`
- **削除は A → B → C → D の順にしか進めない**（トリガで順序を強制）
- 削除はトランザクション内で完結させる。半分だけ消えた状態を作らない
- `anonymize_c_immediately` は「C だけを先に消す」ではなく**即時匿名化プロファイル**（A → B → C を1トランザクションで実行。
  v09 §16.3）を選ぶ印である。順序トリガはこの一括遷移を通す。順序違反は `400 VALIDATION_FAILED` の `details` に理由を返す

---

## 10. 監査

### `edit_logs`（追記のみ）
`id`, `match_id`, `entity`, `entity_id`, `before` jsonb, `after` jsonb, `actor`, `at`

```sql
CREATE OR REPLACE FUNCTION edit_logs_append_only()
RETURNS trigger AS $$ BEGIN
  RAISE EXCEPTION 'edit_logs is append-only';
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER edit_logs_no_update BEFORE UPDATE ON edit_logs
  FOR EACH ROW EXECUTE FUNCTION edit_logs_append_only();
CREATE TRIGGER edit_logs_no_delete BEFORE DELETE ON edit_logs
  FOR EACH ROW EXECUTE FUNCTION edit_logs_append_only();
```

**例外は削除時の伏せ字化のみ。**
`SECURITY DEFINER` 関数 `redact_edit_logs(match_id, level)` だけが
`before` / `after` の該当キーを `null` にできる。その操作も `retention_events` に記録する。

> **UPDATE / DELETE にもRLSポリシーを置いてある。**
> 置かないとRLSが先に効いて「0行更新」で静かに成功してしまい、
> 呼び出し側は消えたと誤解する。ポリシーで通し、トリガで明示的に落とす。

### 独自SQLSTATE

トリガが投げる例外は、`defineHandler` がHTTPのエラーコードへ写す
（`packages/core/src/http/errors.ts`）。`AD` で始まるクラスはPostgresの標準に無い。

| SQLSTATE | 意味 | HTTP |
| --- | --- | --- |
| `AD001` | 許諾未記録のまま解析へ進もうとした | `409 CONSENT_REQUIRED` |
| `AD002` | 追記専用テーブルを UPDATE / DELETE しようとした | `500 INTERNAL`（呼び出し側のバグ） |

> `edit_logs` を忘れると、本文や氏名がここに残り続け、
> 「消したつもりで残っている」状態になる。

---

## 11. RLSの段階

| 段階 | 方針 | 状態 |
| --- | --- | --- |
| MVP | `app_server` ロール＋`SET LOCAL app.actor_id`＋`match_access` 参照ポリシー。全テーブルで `ENABLE`＋`FORCE ROW LEVEL SECURITY`。所有者は `app_migrator`（§0.3） | 実装済み（P2〜P4） |
| 内部ランナー | 固定 UUID を `public.system_actor_id()` で1つ置き、`transcription_jobs` と `edit_logs` のポリシーにだけ節を足す。`sub` がこの値の JWT は 401（§4.1） | 実装済み（P4） |
| AI worker | 3つ目のロール **`app_ai_worker`**（**仮置き**。P12.4 で確定）を作り、L2（§6.5）・L3（§7.5）・`official_decision_support` に GRANT し、**`judge_decisions` / `judge_issue_assessments_human` には GRANT しない**。`drizzle/0000_p0_rls_foundation.sql` の `ALTER DEFAULT PRIVILEGES` が新テーブルへ自動で `app_server` の全権を付けるため、そのままでは分離できない。P12.4 で DEFAULT PRIVILEGES を見直す | P12.4 |
| 共有段階 | `match_access.role` による読み書き分離（viewerは書けない） | 後続 |
| 学校運用 | 学校テナントを導入し、テナント境界でポリシーを追加 | 後続 |

**MVPの段階からRLSを有効にする。** 後から有効化すると、既存の全クエリを見直すことになる。

P2で入った試合まわりのポリシーは §2.1 に書いてある。
共有段階へ進むPRでは、次の2点を必ず扱うこと。

1. `match_access` に `member` / `viewer` の行を作る経路と、それを許すINSERTポリシー
   （現状は「作成者が自分をownerとして登録する」しか通らない）
2. `matches` のSELECTポリシーから `created_by` を落とすこと（§2.1 の副作用）
