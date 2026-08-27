# DATA_MODEL.md — DB接続・テーブル定義・制約

DB: Supabase PostgreSQL（東京 ap-northeast-1）

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
`argument_nodes`, `flow_links`, `rule_flags`, `judge_decisions`,
`match_retention_policies`, `transcription_jobs`

更新は `WHERE id = $1 AND lock_version = $2` の条件付きUPDATE。
0行なら `409 VERSION_CONFLICT`。成功時に `lock_version = lock_version + 1`。

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
| `consent_scope` | text | `practice_only` / `training_material` / `research` / `public` |
| `consent_obtained_from` | text[] | `student` / `guardian` / `school` / `organizer` |
| `consent_recorded_at` | timestamptz | **null なら解析ジョブを作成できない** |
| `consent_expires_on` | date | |
| `status` | text | `draft` / `analyzing` / `reviewing` / `decided` / `locked` |
| `lock_version` | int | |
| `created_by`, `created_at` | | |

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
`team_size`(3 or 4), `lock_version`

UNIQUE(`match_id`, `side`, `seat`)

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

UNIQUE(`match_id`, `kind`, `target_stage_no`, `params_hash`)

### `align_words`（不変・Pass A出力）
`media_source_id`, `idx`, `word`, `start_ms`, `end_ms`, `confidence`

PK(`media_source_id`, `idx`)、`start_ms` にindex。**レベルB削除時に物理削除。**

---

## 5. ステージと逐語

### `stage_segments`
`id`, `match_id`, `stage_no`(1〜12), `type`, `side`, `seat`,
`start_ms`, `end_ms`, `role_status`, `confidence`, `name_announced`, `lock_version`

UNIQUE(`match_id`, `stage_no`)
CHECK: 同一matchで `start_ms` 単調増加、区間が重ならない

`seat` は担当者表からサーバが導出する。**APIで受け取らない。**

### `prep_segments`
`id`, `match_id`, `kind`(`prep`/`chair_announcement`/`silence`), `after_stage_no`, `start_ms`, `end_ms`

準備時間とチェアパーソンのアナウンスを捨てない。

### `transcript_segments`
| 列 | 型 | 制約 |
| --- | --- | --- |
| `id` | uuid | PK |
| `match_id`, `stage_no`, `idx` | | UNIQUE(`match_id`,`stage_no`,`idx`) |
| `start_ms`, `end_ms` | int | 表示・再生に使う確定時刻 |
| `ai_start_ms`, `ai_end_ms` | int | AIが出した元の時刻 |
| `text_ai`, `text_human` | text | B削除時に両方 null |
| `text_status` | text | `ai_draft` / `human_edited` |
| `time_status` | text | `unverified` / `derived` / `human_verified` |
| `audibility` | text | `unknown` / `clear` / `partial` / `unheard` |
| `audibility_set_by` | uuid | **null なら人が設定していない** |
| `coverage` | real | Pass Cの被覆率 |
| `is_silence` | bool | 沈黙区間も保持する |
| `is_self_introduction` | bool | 名乗り区間の印（匿名化に使う） |
| `text_purged_at` | timestamptz | |
| `lock_version` | int | |

```sql
CHECK (audibility = 'unknown' OR audibility_set_by IS NOT NULL)
```
**AIが `audibility` を書けないことをDBで担保する。**

意味論は `REVIEW_SEMANTICS.md` を読むこと。

---

## 6. フロー

### `issues`
`id`（**サーバ割当**）, `match_id`, `label`(`AD1`/`AD2`/`DA1`/`DA2`), `side`,
`title`(120字以内), `review_status`, `lock_version`

UNIQUE(`match_id`, `label`)
片側最大2件は、`label` のUNIQUEと `side` の対応で担保する（`AD*`=AFF / `DA*`=NEG）。

### `argument_nodes`
`id`（**サーバ割当**）, `match_id`, `issue_id`(null可), `kind`, `role`,
`stage_no`, `text`, `review_status`, `lock_version`

`role` は議論の4構成要素（v05で確定）:
`present` / `effect` / `importance` / `evidence` / `other`

`role='evidence'`（「なぜそう言えるか」の言明・**攻撃対象になる**）と
`evidence_refs`（引用の記録・出典要件の充足判定に使う）は別物。
詳細は `ARGUMENT_MODEL.md` §1。

### `node_segments`
`node_id`, `segment_id`。PK(`node_id`, `segment_id`)

**`argument_nodes` は最低1件の `node_segments` を持たなければならない。**
API側で必須にし、DB側は遅延制約トリガ（`CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED`）で担保する。

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
| **`effect_kind`** | やりとりの種別（`no_link` / `re_evidence` 等。`ARGUMENT_MODEL.md` §2） |
| **`rationale_ai`** | AIの説明文 |
| **`effectiveness_ai`** | `strong` / `partial` / `none`。**AIのみ** |
| **`effectiveness_human`** | 同上・null可。**人のみ・任意入力** |
| **`effectiveness_set_by`** | uuid。人が入れたときだけ埋まる |
| **`comparison`** | jsonb。`relation='COMPARES'` のときのみ。`ComparisonAxis[]`（`ARGUMENT_MODEL.md` §5） |
| `lock_version` | |

relationごとに許される from/to の kind をトリガで検証する（`JUDGE_LOGIC.md` §4）。

```sql
CHECK (effectiveness_ai IS NULL OR effectiveness_set_by IS NULL
       OR effectiveness_human IS NOT NULL)
CHECK (effectiveness_human IS NULL OR effectiveness_set_by IS NOT NULL)
CHECK (comparison IS NULL OR relation = 'COMPARES')
```

> **`effectiveness` は判定に入らない。** 勝敗を決めるのは
> `judge_decisions` の Probability / Value / Strength だけである。
> 集計コードが `effectiveness` を参照していないことをCIで静的に検査する。

### `debate_evolution`（ビュー・v05で追加）

「AD1が試合中にどう変化したか」は**新テーブルを作らず導出する**。
`stage_no` の順序と `flow_links` から再構成できる。定義は `ARGUMENT_MODEL.md` §4。

新テーブルを作ると `flow_links` とログの二重管理になり、
片方だけ更新される事故が起きる。

### `rule_flags`（Phase B）
`id`, `match_id`, `type`, `target_ref`, `rationale`,
`status`(`candidate`/`confirmed`/`rejected`), `decided_by`, `decided_at`, `lock_version`

**`candidate` のままのフラグは判定に影響しない。**

---

## 7. Run と 確定

### `flow_runs`
`id`, `match_id`, `model`, `prompt_version`, `ruleset_version`, `created_at`

### `judge_runs`（AI案）
`id`, `match_id`, `flow_run_id`, `ruleset_version`, `model`,
`voting_issue_draft`, `winner_draft`, `created_at`

### `judge_issue_assessments`（AI案）
`judge_run_id`, `issue_id`, `probability`(`Hi`/`Lo`), `value`(`Large`/`Small`),
`strength`(`Strong`/`Weak`/`None`)

PK(`judge_run_id`, `issue_id`)。1 runにつき最大4件。

### `judge_decisions`（人間の確定）
| 列 | 型 | 制約 |
| --- | --- | --- |
| `id`, `match_id` | | |
| `winner` | text | **`AFF` / `NEG` のみ。引き分けを表現できない** |
| `voting_issue` | text | `AD1`/`AD2`/`DA1`/`DA2` |
| `comm_aff`, `comm_neg` | int | CHECK 1〜5 |
| `best_debater` | text | C削除時に座席ラベルへ置換 |
| `reason` | text | not null |
| `decided_by`, `decided_at` | | |
| `locked_at` | timestamptz | **not null になったら以後変更不可** |
| `lock_version` | int | |

### `judge_decision_assessments`（人間の確定したDecision Chart）
`judge_decision_id`, `issue_id`, `probability`, `value`, `strength`

**`judge_issue_assessments`（AI案）を上書きしない。別テーブルに保存する。**

### `export_runs`
`id`, `match_id`, `flow_run_id`, `judge_decision_id`, `template_version`,
`output_paths` jsonb, `created_at`

---

## 8. ロック不変条件（v04で追加）

`judge_decisions.locked_at` を立てられるのは、次をすべて満たすときだけ。
**API（`POST /judge/decision/lock`）とDBトリガの両方で検査する。**

1. `winner` / `voting_issue` / `comm_aff` / `comm_neg` / `reason` が埋まっている
2. `voting_issue` に対応する `issues.review_status = 'confirmed'`
3. **判定根拠として引用された全 segment の `audibility <> 'unknown'`**
4. `rule_flags` に `status = 'candidate'` が残っていない（Phase B）

```sql
-- 3 の判定に使うビュー
CREATE VIEW judge_cited_segments AS
SELECT DISTINCT jd.id AS judge_decision_id, ns.segment_id
FROM judge_decisions jd
JOIN issues i         ON i.match_id  = jd.match_id AND i.review_status = 'confirmed'
JOIN argument_nodes n ON n.issue_id  = i.id        AND n.review_status = 'confirmed'
JOIN node_segments ns ON ns.node_id  = n.id;
```

`unknown` が残る場合は `409 AUDIBILITY_UNRESOLVED` を返し、
`details.pendingSegmentIds` に該当idを返す（`API_SPEC.md` §7.2〜7.3）。

> **なぜこれが要るのか。**
> `audibility = unknown` は「まだ人が聞いていない」を意味する。
> これを許すと、AIの文字起こしを人間が聞いたものとして判定に使ってしまう。
> 本設計が最も避けたい事故が、ちょうどここで起きる。

---

## 9. 保持と削除

保持レベルA〜Eと、レベルごとの削除操作は `PRIVACY_RETENTION.md` を正本とする。
DB側に必要なもの:

- `match_retention_policies`（`match_id` PK, `scope`, `purge_a_on`〜`purge_d_on`, `anonymize_c_immediately`, `lock_version`）
- `retention_events`（追記のみ）
- `media_sources.purged_at` / `transcript_segments.text_purged_at`
- **削除は A → B → C → D の順にしか進めない**（トリガで順序を強制）
- 削除はトランザクション内で完結させる。半分だけ消えた状態を作らない

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

| 段階 | 方針 |
| --- | --- |
| MVP | `app_server` ロール＋`SET LOCAL app.actor_id`＋`match_access` 参照ポリシー |
| 共有段階 | `match_access.role` による読み書き分離（viewerは書けない） |
| 学校運用 | 学校テナントを導入し、テナント境界でポリシーを追加 |

**MVPの段階からRLSを有効にする。** 後から有効化すると、既存の全クエリを見直すことになる。

P2で入った試合まわりのポリシーは §2.1 に書いてある。
共有段階へ進むPRでは、次の2点を必ず扱うこと。

1. `match_access` に `member` / `viewer` の行を作る経路と、それを許すINSERTポリシー
   （現状は「作成者が自分をownerとして登録する」しか通らない）
2. `matches` のSELECTポリシーから `created_by` を落とすこと（§2.1 の副作用）
