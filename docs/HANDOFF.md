# HANDOFF.md — PR間の申し送り

**各PRの完了時に、次のPRへの申し送りをこのファイルへ追記する。**
チャットの履歴にしか無い知見は、次のセッションから読めない。
実装中に「実際にこうだった」と分かったことを、実測値・エラーメッセージごと残す。

書き方の規則:

- **要約しない。** 実測値、実際に出たエラーメッセージ、確認したコマンドを含めて残す。
- **「こうすべき」ではなく「実測でこうだった」と書く。** 判断が要る項目は、
  判断が下りた時点でその内容を追記する（誰がいつ決めたかも書く）。
- 各項目に **「P◯ で判断が要る」／「参考情報」** の区別を付ける。
  判断が要る項目は、次のPRの実装計画で必ず触れる。
- 古い節は消さない。P2 完了後も P1→P2 の節は残す。以降のPRで参照される。

---

## P1 から P2 への申し送り

P1（ruleset と Zodスキーマ）の作業中に、実際にコード・生成物・CI を触って確認した事項。
推測は含まない。確認した環境は Web版クラウドセッション（zod 4.4.3 / vitest 4.1.11 /
TypeScript 5.9 / PostgreSQL 16）。

### 件1 `npm run test:db` はセッション開始直後に失敗する — **P2 で対応する**

`scripts/install_pkgs.sh` がマイグレーション適用まで面倒を見ないため、
新しいクラウドセッションで最初に `npm run test:db` を叩くと落ちる。

```
PostgresError: function public.app_actor_id() does not exist
 Test Files  2 failed (2)
      Tests  12 skipped (12)
```

`public.app_actor_id()` は `drizzle/0000_p0_rls_foundation.sql` で定義される。
`npm run db:migrate` を先に流せば **12件すべて合格**する（実測）。

CI は `database` ジョブが migrate してから `test:db` を流す構成なので、CI では問題にならない。
手動になるのはローカル（クラウドセッション）だけである。

**P2 の対応**: `install_pkgs.sh` に migrate を足す。

---

### 件2 `Issue.side` は `label` から一意に決まる — **判断済み**

P1 で `Issue` に refine を入れたため、`label` と `side` の食い違いは検証で落ちる（実測）。

```
Issue.safeParse({ id, label: "AD1", side: "NEG", ... }).success  → false
Issue.safeParse({ id, label: "DA1", side: "AFF", ... }).success  → false
```

`AD*` は肯定側、`DA*` は否定側（条項 2.1.1 / 2.1.2）なので、`label` が決まれば `side` は決まる。

**判断（承認済み）**: **API で `side` を受け取らない。サーバが `label` から導出する。**
`seat` を受け取らない方針（`API_SPEC.md` §5・§200行目付近）と同じ理屈であり、二重入力を作らない。
`label` 自体もサーバが割り当てる（`JUDGE_LOGIC.md` §2）。

---

### 件3 `getRuleset(id)` は起動時ではなく**呼び出し時**に throw する — **判断済み**

`packages/core/src/ruleset/index.ts` の `getRuleset` は未知の id で例外を投げる（実測）。

```
getRuleset("henda-19")  → Error: 未知の ruleset です: henda-19
```

一方 `RULESET_DEFAULT` は値の妥当性を検証していない。

```ts
// packages/core/src/env.ts:60
RULESET_DEFAULT: z.string().default("henda-20"),
```

したがって環境変数に不正な ruleset id を入れると、**起動は成功し、リクエストを受けた時点で落ちる**。
`defineHandler` のエラー変換で素通しすると 500 になる。

**判断（承認済み）**: **起動時に一度引いて確かめる。エラー変換に載せる案は採らない。**
設定ミスはリクエストを受けた後ではなく、起動時に落ちるべきである。

---

### 件4 `seatFor()` が P2 の受け入れ基準を直接満たす — 参考情報

`packages/core/src/ruleset/index.ts` に用意してある。

```ts
seatFor(ruleset: Ruleset, stageNo: number, teamSize: TeamSize): SeatLabel
```

実測: ⑪肯定総括は 4人チームで `A4`、3人チームで `A1`。
4人と3人で担当が変わるのは **②④⑪⑫の4ステージだけ**（`ruleset.test.ts` で検証済み）。

`TASKS.md` P2 の受け入れ基準「`team_size`（3 or 4）に応じて担当者表が切り替わる」は、
この関数で満たせる。

注意点: `TeamSize` は `3 | 4` のリテラル型である。DB の `team_size`（number）から渡すときは
絞り込みが要る。

---

### 件5 `RuleFlag.status` と `ReviewStatus` は別語彙である — 参考情報

| 型 | 値 | 定義場所 |
| --- | --- | --- |
| `ReviewStatus` | `suggested` / `reviewed` / `confirmed` / `excluded` | `packages/core/src/schema/review.ts` |
| `RuleFlag.status` | `candidate` / `confirmed` / `rejected` | `packages/core/src/schema/flow.ts` |

**共通するのは `confirmed` だけで、他はすべて違う。**
P1 の実装中に実際に取り違えかけた。`flow.test.ts` に
`RuleFlag.safeParse({ ...flag, status: "excluded" }).success → false` の検査を置いてある。

P11 で DB の enum を Zod 定義から導出するとき、**同じ enum にまとめないこと。**

---

### 件6 `Issue` / `ArgumentNode` は「保存済みの形」であってリクエスト用スキーマではない — **判断済み**

どちらも `id` と `reviewStatus` を必須で持つ。一方 `API_SPEC.md` §5 の `CreateNodeReq` は
どちらも持たない（サーバが割り当てるため）。

```ts
// packages/core/src/schema/flow.ts — 保存済みの形
export const ArgumentNode = z.object({
  id: Uuid, issueId: Uuid.nullable(), kind: NodeKind, role: ArgumentRole.nullable(),
  stageNo: ..., text: z.string(), segmentIds: z.array(Uuid).min(1), reviewStatus: ReviewStatus,
});

// docs/API_SPEC.md §5 — リクエストの形（id も reviewStatus も無い）
export const CreateNodeReq = z.object({
  issueId: z.uuid().nullable(), kind: ..., role: ArgumentRole.nullable(),
  stageNo: ..., text: z.string().min(1), segmentIds: z.array(z.uuid()).min(1),
});
```

**判断（承認済み）**: **`ArgumentNode.omit({ id: true, reviewStatus: true })` のように導出する。**
別々に書くとずれる。`ACCEPTANCE.md` M12（LLM応答スキーマに `id` / `label` / `reviewStatus` が
無いこと）の静的検査も、この導出があると書きやすい。

---

### 件7 `FlowLink` の `.default()` で `z.input` と `z.output` が食い違う — 参考情報

`effectKind` と `comparison` に `.default()` を付けたため、**入力では省略でき、出力では必ず埋まる**。
実測:

```
FlowLink.safeParse({ id, from, to, relation: "CITES", confidence: 0.5, reviewStatus: "suggested" })
  → success: true
  → output: { effectKind: null, comparison: [] }
```

`defineHandler` がリクエスト検証に使うのは `z.input`、レスポンスの型は `z.output` である。

あわせて: **`schemas/*.json` は `io: "input"` 固定で生成している**
（`scripts/generate-schemas.ts`）。API 契約を JSON Schema で公開するなら、
レスポンス側は別途 output 版が要る。P2 で決める話。

---

### そのほか（参考情報）

- **`check-dev-routes` は build 成果物を必要とする。** 単体で叩くと
  `ビルド成果物が見つかりません。先に npm run build を実行してください。` で落ちる。
  CI は `npm run build` の後に流す構成なので問題ないが、ローカルで `/dev/*` を検証するときは
  build → check の順。
- **`schemas/flow-link.schema.json` は `ComparisonAxis` を `$ref` ではなくインライン展開している**
  （実測。`$ref` はゼロ件）。今は害がないが、スキーマが増えて重複が気になるなら
  `z.toJSONSchema` の参照戦略を検討する余地がある。P2 の必須事項ではない。
- **`.refine()` の不変条件は JSON Schema に現れない。** 42分・担当者表の整合・M26 は
  すべて refine にあり、`schemas/*.json` には落ちていない。`schemas/` は M2 の差分検出のための
  生成物であり検証器ではない。検証は Zod が担う（`scripts/generate-schemas.ts` にコメント済み）。
- **JSON の import attribute（`import x from "./x.json" with { type: "json" }`）は、
  vitest・tsc・`next build` のいずれでも通る**ことを確認済み。Edge runtime では未確認。

---

## P2 から P3 への申し送り

P2（`defineHandler`・matches・RLS・画面A）の作業中に、実際にコード・DB・CI を触って確認した事項。
推測は含まない。確認した環境は Web版クラウドセッション
（PostgreSQL 16.11 / zod 4.4.3 / vitest 4.1.11 / Next.js 16.3.2 / TypeScript 5.9）。

### 件8 `install_pkgs.sh` が migrate まで見るようになった — 参考情報（件1 は解決）

`npm ci` → `npm run db:migrate` の順に変えた（migrate は tsx で走るので依存が先に要る）。
DB とロールを両方落としてから、セッション開始をそのまま再現した実測:

```
$ su postgres -c "psql -q -c 'DROP DATABASE IF EXISTS debate_dev'"
$ su postgres -c "psql -q -c 'DROP ROLE IF EXISTS app_server'"
$ su postgres -c "psql -q -c 'DROP ROLE IF EXISTS app_migrator'"
$ rm -f .env.local
$ CLAUDE_CODE_REMOTE=true bash scripts/install_pkgs.sh   → exit=0
$ npm run test:db
   Test Files  6 passed (6)
        Tests  74 passed (74)
```

冪等性も実測。`install_pkgs.sh` を続けて3回走らせ、そのあと `test:db` が 74件合格。
`npm run db:migrate` を2回続けて流しても
`[notice] schema "drizzle" already exists, skipping` が出るだけで結果は変わらない。

**マイグレーション失敗時も `exit 0` にしてある。** ここで止めると、
マイグレーションを直したくても Claude Code が起動してこない。ログに `warning:` を出す。

CI にも `npm run db:migrate` を `test:db` の後にもう一度流す step を足した（冪等性の検査）。

---

### 件9 `matches` の SELECT ポリシーに `created_by` が入っている — **P3 以降で意識が要る**

理由・副作用・再検討の時期は `DATA_MODEL.md` §2.1 と
`drizzle/0001_p2_match_core.sql` のポリシー直上のコメントに書いた。要点だけ再掲する。

- **なぜ**: `INSERT ... RETURNING` は返す行に SELECT ポリシーを要求する。
  match 作成直後は `match_access` の行がまだ無い（FK の順序上 `matches` が先）ため、
  `match_access` だけを見るポリシーでは**自分で作った match が自分に見えない**。
- **副作用**: 作成者は `match_access` から外されても（除名されても）その match を読める。
- **いつ**: 共有機能（他の actor を招待し、外せるようにする PR）で見直す。

**UPDATE ポリシーには `created_by` を入れていない。** 作成者であることは
「更新してよい」を意味しない。見えるだけの穴を書き込みまで広げない。

---

### 件10 P2 の `match_access` には `owner` の行しか作れない — **P3 以降で判断が要る**

INSERT ポリシーが「自分を、自分が作った match の owner として登録する」に限定されている。
これを緩めないと権限昇格の穴になる（実測: 他人の match に自分を owner として足そうとすると
`ERROR: new row violates row-level security policy for table "match_access"`）。

結果として `member` / `viewer` の分岐は **DB を使ったテストでは通せない**。
テーブル所有者（`app_migrator`）で行を挿し込もうとしても `FORCE ROW LEVEL SECURITY` に阻まれる。

```
$ migrator`INSERT INTO match_access (match_id, actor_id, role) VALUES (..., 'viewer')`
  → code: 42501 / new row violates row-level security policy for table "match_access"
```

**そこで役割の判断を純粋関数 `accessDenial(role, required)` に切り出した**
（`packages/core/src/db/repo/match-access.ts`）。
`tests/unit/match-access.test.ts` が owner/member/viewer/null × read/write/owner の
12通りすべてを確かめている。DB で作れないことを、検証しない理由にしない。

**P3 以降の判断**: 共有機能を入れる PR で、招待用のエンドポイントと INSERT ポリシーを
同時に足すこと。片方だけ入れると、ポリシーが通らずエンドポイントが 403 を返し続ける。

---

### 件11 RLS ポリシーの中で参照した表にも RLS が効く — 参考情報（P3 以降の全テーブルに効く）

`matches` のポリシーが `match_access` を参照している。ポリシー式の中の副問い合わせにも
RLS は適用されるので、`match_access` 側を「同じ match の誰かが見えるなら見える」と書くと
自己参照になり `infinite recursion detected in policy for relation "match_access"` で落ちる。

**`match_access` の SELECT は `actor_id = app_actor_id()`（自分の行だけ）に固定してある。**
`matches` 側の EXISTS 条件と同じ形なので、絞り込み結果は変わらない。

**`SECURITY DEFINER` 関数による再帰回避は、この設計では使えない。**
全表に `FORCE ROW LEVEL SECURITY` を付けているため、関数の所有者（`app_migrator`）にも
ポリシーが適用され素通りできない。`BYPASSRLS` を持つ専用ロールを作る案も、
本番 Supabase で作れる保証がないため採らなかった。

P3 以降で `media_sources` / `transcription_jobs` などのポリシーを書くときも、
**`match_access` を直接参照する形（`EXISTS (SELECT 1 FROM match_access ma WHERE ...)`）**
にすれば再帰しない。`matches` を経由すると 2 段になるので避けたほうが読みやすい。

---

### 件12 テーブル所有者では DB テストが書けない — 参考情報（実際に 1 回踏んだ）

`FORCE ROW LEVEL SECURITY` があり、ポリシーはすべて `TO app_server` である。
つまり **`app_migrator`（所有者）で SELECT すると 0 行しか返らない。**

最初 `edit_logs` の件数を `migratorClient()` で数えるテストを書いたところ、

```
AssertionError: expected [] to have a length of 5 but got +0
```

で落ちた。さらに悪いことに、「変更前と変更後の件数が同じ」を確かめる形だと
**0 と 0 を比べて通ってしまう**（実際に一度通った）。

対策として `tests/db/helpers/api.ts` に `readAsActor(actorId, fn)` を置いた。
**DB の中身を確かめるときは、必ず `app_server` 接続 ＋ `withActor` で読むこと。**
所有者接続でよいのは `TRUNCATE` や `pg_class` / `pg_policies` の参照など、
行レベルの操作でないものだけである。

---

### 件13 postgres.js のトランザクションは、1 つ失敗すると全体が巻き戻る — 参考情報

「例外が出ること」を確かめるテストを 1 つの `withActor` の中に複数書くと、
最初の例外でトランザクションが中断し、**`withActor` 自身が reject する**ので
`await expect(...).rejects` で受けたはずのものが外へ抜けてテストが落ちる。

検査ごとに `withActor` を開き直すか、`tx.savepoint()` を使うこと。
P4 でジョブの状態遷移を検査するときに同じ形を書くはずなので、先に書いておく。

---

### 件14 `defineHandler` の使い方 — P3 以降のすべてのエンドポイントが通る

```ts
export const POST = defineHandler({
  auth: "match:write",              // authenticated / match:read / match:write / match:owner
  params: z.object({ id: z.uuid() }),
  body: SomeReq,
  requireExpectedVersion: true,     // 更新系は必ず付ける
  idempotency: "required",          // 副作用のある POST
  handler: async ({ params, body, actor, tx, audit, ruleset }) => {
    audit.record({ entity: "...", entityId, matchId, before, after });
    return { data: ..., status: 200 };
  },
});
```

守るべき点を実装したうえで気づいたこと。

- **`audit.record()` を呼ばない変更系ハンドラは 500 で落ちる。**
  警告ではなく例外にしてある。警告にすると、記録の無い変更がいつか必ず本番へ出る。
  実測: `round` を UPDATE して `audit.record()` を忘れたハンドラは 500 になり、
  トランザクションごと巻き戻って `round` は null のまま残った。
- **`updateWithVersion()` / `bumpVersion()` を使うこと**（`packages/core/src/db/optimistic.ts`）。
  条件付き UPDATE が 0 行のとき、RLS で見えていないのか版がずれているのかを切り分け、
  それぞれ `404` と `409 VERSION_CONFLICT`（`details.currentVersion` 付き）にする。
  route ごとに書くと必ず片方を忘れる。
- **`auth: "match:*"` は既定で `params.id` を match id とみなす。**
  `/segments/{id}` のように id が match でないエンドポイント（P4 以降で出てくる）では
  `matchIdFrom` を渡すこと。渡し忘れると「match id を特定できません」の 500 になる。
- **他人の match は 403 ではなく 404 を返す。** 403 だと存在が漏れる。
- **`internal`（`X-Job-Secret`）の認証は入れていない。** P2 に該当エンドポイントが無いため。
  P4 で `/api/v1/internal/jobs/run` を作るときに `AuthMode` へ足すこと。
  「常に 500 を返す分岐」を先に置くと、実装済みに見えて動かない経路が残る。

新しい route を足したら `npm run check-handler-routes` が守る（CI に入れてある）。
`defineHandler({...})` 以外を export した `app/api/**/route.ts` は落ちる。

---

### 件15 JWT は HS256 実装。実 Supabase での疎通は未確認 — **P3 以降で判断が要る**

`packages/core/src/auth/jwt.ts` は **HS256（Supabase の legacy JWT secret 方式）だけ**を扱う。
`node:crypto` で検証しているので依存は増えていない。

**クラウドセッションに実 Supabase の鍵を置けないため
（`DEV_ENVIRONMENTS.md` §3）、実 Supabase が発行したトークンでの疎通は検証していない。**
`tests/unit/jwt.test.ts` が確かめているのは、自前で署名したトークンに対する検証器の挙動である
（署名不一致・`alg: none`・`alg` すり替え・`exp` 欠落・期限切れ・`nbf`・`sub` が uuid でない、の7通り）。

**判断が要る点**: 実 Supabase のプロジェクトが非対称鍵（JWKS / ES256・RS256）方式なら、
`verifySupabaseJwt` の署名検証部分を差し替える必要がある。
Supabase のプロジェクト設定を確認できる人が、P3 以降のどこかで確かめること。
差し替え箇所は `verifySupabaseJwt` 1 関数に閉じている。

あわせて:

- **秘密鍵が未設定のときに検証を飛ばす分岐は作っていない。** 設定エラーとして 500 で落ちる。
  作った瞬間、設定漏れの本番が無認証になる。
- `SUPABASE_JWT_SECRET` を env に足した（`.env.example` も更新済み）。
  クラウドセッションでは `install_pkgs.sh` が `devonly-jwt-secret` を `.env.local` に書く。
  **これはセッション内だけの値であり、実 Supabase の鍵ではない。**
- `sub` が uuid でないトークンは 401 で弾いている。弾かないと `app.actor_id` の
  型変換で RLS が落ち、原因の分かりにくい 500 になる。

---

### 件16 承認済みの仕様変更（3件）— 判断済み

2026-08-26 に利用者が承認。`API_SPEC.md` のスニペットと実装が食い違う箇所なので記録する。

1. **`ConsentReq` に `expectedVersion` を足した。**
   §1 のスニペットには無いが、§0.3 が「`lock_version` を持つ全エンティティの更新は
   `expectedVersion` を必須とする」と定めており、consent の記録は `matches` の更新である。
   §1 の書き漏らしとして扱う（利用者が「私の書き漏らしでした」と明言）。
2. **`POST /api/v1/matches` の `Idempotency-Key` を必須にした。**
   §0.4 の「ジョブ作成・エクスポート作成**など**、副作用のあるPOST」に含める読み。
   画面Aの二重送信で試合が二つできるのは実際に起きる事故である。
3. **P2 における「解析を開始しようとする」を `matches.status` の `draft` 離脱と定義した。**
   P2 に `transcription_jobs` が無いため。P4 は同じ `assert_consent_recorded()` を
   ジョブ表のトリガから呼ぶこと（件17）。

`API_SPEC.md` 本体はまだ直していない。直すなら 1 と 2 を §1 / §0.4 に反映すること。

---

### 件17 許諾は API と DB の両方で拒否している — 参考情報（P4 で続きがある）

- API: `PATCH /matches/{id}` が `status` を `draft` から動かすとき、
  `consent_recorded_at` が null なら `409 CONSENT_REQUIRED`。
- DB: `matches_require_consent_trg`（BEFORE INSERT OR UPDATE ON matches）が
  `SQLSTATE AD001` で落とす。実測メッセージ:

```
ERROR:  許諾が記録されていないため status を analyzing にできません（match_id=68ecdd93-...）
CONTEXT:  PL/pgSQL function matches_require_consent() line 4 at RAISE
```

**P4 でやること**: `transcription_jobs` の BEFORE INSERT トリガから
`public.assert_consent_recorded(match_id)` を呼ぶ。**条件を書き直さない。**
この関数は `SECURITY INVOKER` なので、呼び出し元のロールで `matches` を読む。
RLS が効くため、**見えない match は「許諾なし」に見える＝拒否側に倒れる**（実測済み）。

独自 SQLSTATE を 2 つ定義した（`AD` で始まるクラスは Postgres の標準に無い）。

| SQLSTATE | 意味 | `defineHandler` の変換先 |
| --- | --- | --- |
| `AD001` | 許諾未記録のまま解析へ進もうとした | `409 CONSENT_REQUIRED` |
| `AD002` | 追記専用テーブルを UPDATE / DELETE しようとした | `500 INTERNAL` |

`edit_logs` の UPDATE / DELETE には**あえてポリシーを置いてある**。
置かないと RLS が先に効いて「0行更新」で静かに成功し、呼び出し側は消えたと誤解する。
ポリシーで通し、トリガで明示的に落とす。

---

### 件18 `api_idempotency_keys` を足した — 参考情報

`API_SPEC.md` §0.4 は `Idempotency-Key` を必須と定めながら、記録先を定義していなかった。
`DATA_MODEL.md` §2 に追記済み（同じ PR で反映した）。

- PK(`actor_id`, `key`)。RLS は自分のキーだけ。
- 同じキー＋同じ `request_hash` の再送は、**新規作成せず保存済みの応答を 200 で返す**
  （作成時が 201 でも再送は 200。`Idempotent-Replay: true` ヘッダを付けている）。
- 同じキーで内容が違えば 400。
- **記録と再送判定はハンドラ本体と同じトランザクション内で行っている。**
  外に出すと、記録の直前に落ちたときに二重実行できてしまう。
- `transcription_jobs.idempotency_key`（§4）とは別物。P4 は DB 側の冪等キー
  （`match_id + kind + target_stage_no + params_hash`）も持つので、**両方**になる。

---

### 件19 担当者表は保存していない — 参考情報

`rosterFor(ruleset, teamSize)` を足した（`packages/core/src/ruleset/roster.ts`）。
件4 の `seatFor()` を 12 ステージ分まとめただけの薄いものである。

**API のレスポンスにも画面Aにも、同じ関数の結果を載せている。** 保存しない。
保存すると ruleset の改定で古い表が残る。

実測（件4 の値が表になっても保たれていること）:

- `rosterFor(henda20, 4)` の ⑪ は `A4`、`rosterFor(henda20, 3)` の ⑪ は `A1`
- 4人と3人で担当が変わるのは **②④⑪⑫ の4ステージだけ**
- 3人チームの表に `A4` / `N4` は現れない

`GET /api/v1/matches/{id}` は、出場者がまだ 1 人も登録されていないとき **teamSize を 4 とみなす**
（条項 2.2 の既定。3人登録は病欠等の例外）。`matches` に `team_size` 列は無く、
`match_members` の行が持っている（`DATA_MODEL.md` §2 のまま）。
1 試合の中で食い違わせないため、`PUT /members` は**必ず全削除 → 全挿入**で置換する。
部分更新の経路は作っていない。

---

### 件20 画面Aは認証導線を持っていない — **P3 以降で判断が要る**

`app/matches/new/` は JWT を**手で貼り付ける**入力欄を持っている。
Supabase Auth のログイン画面は P2 の範囲外だったためである。

**判断が要る点**: ログイン導線をどの PR で入れるか。
画面B（メディア取り込み・P3）も同じトークンが要るので、P3 の着手時に決めるのが自然である。
`supabase-js` を使うのは Auth と Storage だけであり、**DB アクセスには使わない**
（eslint の `no-restricted-imports` が `packages/core/src/storage/**` と
`packages/core/src/auth/**` 以外での import を落とす。現状 `auth/jwt.ts` は
`node:crypto` しか使っていない）。

e2e（`e2e/match-register.spec.ts`）が確かめているのは**担当者表の切り替えと入力欄の増減だけ**である。
CI の e2e ジョブに Postgres が無いので、送信までは e2e に含めていない。
送信の検証は `tests/db/api-matches.test.ts` が実際の route を叩いて行っている。

**画面の見た目（レイアウトが崩れないか）は当方では確認していない。**

---

### 件21 route を Next のサーバ無しでテストできる — 参考情報

`defineHandler` が返すのは素の `(request, context) => Promise<Response>` である。
そのため **出荷する `route.ts` をそのまま import して呼べる**。

```ts
import { POST as createMatchRoute } from "../../app/api/v1/matches/route";
const res = await call(createMatchRoute, "POST", "/matches", { actorId, body, idempotencyKey });
```

`vitest.config.ts` に `@core` の alias を足してある（`tsconfig.json` の `paths` と同じ対応）。
**`projects` の各要素にも書くこと。** ルートの `resolve` だけでは効かない。

DB も RLS も本物なので、「ハンドラを模したもの」ではなく実際の経路を検証している。
P3 以降のエンドポイントも同じ形で書けば、Next を起動せずに契約を検査できる。

---

### 件22 negative test が空回りしていないことを、壊して確かめた — 参考情報

「拒否されること」を確かめるテストは、**拒否の仕組みを外したときに落ちなければ意味がない**。
P2 では実際に一つずつ壊して確認した。以下すべて実測値である。

**① アプリの認可分岐を外す（受け入れ基準3）**

`assertMatchAccess` の `matchIsVisible` と `accessDenial` を無効化した状態で `rls-matches.test.ts`:

```
Tests  12 passed (12)
```

**分岐を外しても他人の match は見えない。** RLS だけで守れている。
`GET` が 404 のままなのは、`requireMatch` が RLS で 0 行を受け取って `NOT_FOUND` を投げるため。

**② RLS ポリシーを緩める（テストが空回りしていないことの確認）**

`matches_select_member` を `USING (true)` に差し替えると:

```
× 生の SELECT でも、他人の match は 0 行
× リポジトリ関数を直接呼んでも見えない（assertMatchAccess を経由しない）
× app.actor_id を設定しない経路では 1 行も見えない
× GET は 404（403 で存在を漏らさない）
× PATCH も 404
Tests  5 failed | 7 passed (12)
```

**①と②の対比が受け入れ基準3の証拠である。** アプリを外しても守られ、RLS を外すと守られない。

**③ `edit_logs` 書き忘れの検出を外す（受け入れ基準6）**

`if (mutates && audit.size === 0)` を無効化すると:

```
× 変更系なのに何も記録しないハンドラは 500 で落ちる
Tests  1 failed | 13 passed (14)
```

**④ `requireExpectedVersion` を外す（受け入れ基準1）**

```
× body スキーマが expectedVersion を要求し忘れても 400 で止まる
× 整数でない expectedVersion も通さない
Tests  2 failed | 12 passed (14)
```

**⑤ DB トリガを外す（受け入れ基準4の DB 側）**

`DROP TRIGGER matches_require_consent_trg ON matches` のあと:

```
× consent_recorded_at が null のまま status を draft から動かすと SQLSTATE AD001 で拒否される
× INSERT の時点で draft 以外にしようとしても拒否される（トリガの抜け道を作らない）
Tests  2 failed | 13 passed (15)
```

**⑥ API 側の許諾チェックだけを外す（受け入れ基準4の二重化）**

`app/api/v1/matches/[id]/route.ts` の consent 分岐を無効化しても:

```
Tests  21 passed (21)
```

**API の分岐を外しても 409 CONSENT_REQUIRED が返る。**
DB トリガが `AD001` を投げ、`toApiError` が `CONSENT_REQUIRED` へ写すためである。
⑤と⑥で、API と DB の**どちらか一方だけを外しても止まる**ことが確かめられている。

> **注意**: ②と⑤で DB を直接いじったあと、`npm run db:migrate` では元に戻らない。
> drizzle は `__drizzle_migrations` を見て適用済みを飛ばすためである。
> `DROP DATABASE debate_dev` してから `install_pkgs.sh` を流し直すこと（実測でこれが要った）。

---

### そのほか（参考情報）

- **`z.iso.date()` / `z.iso.datetime()` を使っている。** API_SPEC.md のスニペットは
  `z.string().date()` と書いているが、zod 4 では `z.iso.date()` が対応する。
- `postgres.js` の `date` 型は文字列で、`timestamptz` は `Date` で返る。
  `packages/core/src/db/repo/matches.ts` の `isoDate()` がその差を吸収している。
- **`schemas/` に Match 系 5 件を足した**（`match` / `create-match-req` / `patch-match-req` /
  `consent-req` / `put-members-req`）。件7 のとおり `io: "input"` 固定なので、
  これらは「クライアントが送ってよい形」である。レスポンス側の output 版は**まだ無い**。
  必要になったら P3 以降で決めること。
- `env.schema.json` は `SUPABASE_JWT_SECRET` の追加で差分が出る。再生成済み。
- **`packages/core/src/db/pool.ts` の `getSql()` は遅延生成である。**
  モジュール読み込み時に接続を作ると、`DATABASE_URL` の無い CI の `next build` が落ちる。
  同じ理由で `startup.ts` は `parseEnv()` 全体を呼ばず、`RULESET_DEFAULT` だけを見ている（件3）。
- CI に `check-handler-routes`（quality ジョブ）と、`test:db` 後の `db:migrate` 再実行
  （database ジョブ・冪等性の検査）を足した。

---

## P3 から P4 への申し送り

P3（メディア取り込み）の作業中に、実際にコード・DB・CI を触って確認した事項。
推測は含まない。確認した環境は Web版クラウドセッション
（PostgreSQL 16.11 / zod 4.4.3 / vitest 4.1.11 / Next.js 16.3.2 / TypeScript 5.9 /
@supabase/supabase-js 2.112.4 / tus-js-client 4.3.1）。

### 件23 Supabase の resumable(TUS) は署名トークンを受け付ける — 判断済み（一次情報で確認）

着手前、私は「TUS は `Authorization: Bearer` でしか認可できず、
`createSignedUploadUrl` のトークンは非 resumable 専用ではないか」と申告した。**これは誤りだった。**
公式ドキュメントの原文を当たって確認した実測は次のとおり。

- エンドポイント: `https://{ref}.storage.supabase.co/storage/v1/upload/resumable`
  **`{ref}.supabase.co` ではなく `{ref}.storage.supabase.co`**（直結ホスト）
- 認可は2方式。`authorization: Bearer <access_token>` ヘッダ、
  または **`x-signature` ヘッダに `createSignedUploadUrl` の token**
  （docs「Presigned uploads」節。公式例 `examples/storage/resumable-upload-signed-uppy` もある）
- チャンクは 6MB 固定。原文 `chunkSize: 6 * 1024 * 1024, // NOTE: it must be set to 6MB (for now) do not change it`
- 署名トークンの有効期間は **2時間固定**。指定する引数が無い
  （storage-js のコメント `They are valid for 2 hours.`。options は `{ upsert: boolean }` のみ）
- TUS が払い出すアップロード固有URLの有効期間は最大24時間（トークンの2時間とは別の時計）
- 標準アップロード側の原文は「6MB超は TUS を推奨」。**つまり TASKS.md の元の記述は誤りではなかった。**
  本件が常に TUS を使うのは設計判断であり、事実の訂正ではない（TRANSCRIPTION.md §7.3 に理由を残した）

**このセッションの egress は `supabase.com` と `api.github.com` を遮断する。**
`raw.githubusercontent.com` は通ったので、原文はそこから取得した。P5・P8 で外部の仕様を
確かめるときも同じ経路が使える。

### 件24 署名トークンがバケットのポリシーを迂回するかは未確認 — **P3 の H9 で人が確かめる**

docs の "Signed upload URLs can be used to upload files to the bucket
**without further authentication**" と、認可をトークン発行時に行う設計からは迂回する読みである。
**迂回する前提で実装した。** バケット側のポリシーは「誰も直接書けない」で作る。

**もし 403 になったら、ポリシーを緩めず報告すること**（ACCEPTANCE.md H9 の注記）。
`x-signature` 方式のときオブジェクトの `owner` に何が記録されるかも未確認である。

### 件25 `matchIdFrom` を `(params, tx)` に広げた — P4 以降のすべてで使える

`/media/{id}` は id から表を引かないと match が分からない。
`matchIdFrom?: (params: P, tx: TransactionSql) => string | Promise<string>` にした。

このクエリは**認可より前**に走る。`SET LOCAL app.actor_id` 済みなので RLS は効く。
したがって「見えない行は引けない → 404」に倒せる。403 にすると存在が漏れる。

P4 の `/jobs/{id}/retry`・`/jobs/{id}/cancel` も同じ形が要る（API_SPEC.md §3 に注記済み）。
**外すと持ち主でも 404 になる**ことを実測で確かめた（既定の `params.id` を match id とみなすため）。
黙って通ることはないので、回帰で気づける。

### 件26 postgres.js の savepoint が無いと 23505 の捕捉が成立しない — 参考情報（件13 の続き）

`POST /media` は INSERT を先に撃ち UNIQUE 違反（23505）を捕まえて SELECT し直す。
**`tx.savepoint()` で囲まないと、捕捉しても後続が動かない。** 実測（savepoint だけ外した状態）:

```
[defineHandler] 未処理の例外 PostgresError: duplicate key value violates unique constraint "media_sources_match_sha_key"
 × 同じ指紋を二度登録しても行は増えず already_exists / 200
 × purge 済みの行は再利用され restored / 200 になる（行は増えない）
```

例外を握りつぶしてもトランザクション自体が中断するためである（件13）。
P4 でジョブの冪等キー（`match_id + kind + target_stage_no + params_hash`）が
UNIQUE 違反を返す設計にするなら、同じ形が要る。

### 件27 A削除を模す UPDATE は所有者接続では効かない — 参考情報（件12 を実際に踏んだ）

テストで `migratorClient()` を使って `purged_at` を立てたところ、
FORCE ROW LEVEL SECURITY のため **0 行で静かに成功**し、3 件が落ちた。

```
 × M29 purge 済みなら ready を返し、署名は upsert: true で発行される
   AssertionError: expected 'already_exists' to be 'ready'
 × purge 済みの行は再利用され restored / 200 になる（行は増えない）
 × A削除済みは 410 RETENTION_PURGED（404 にしない）
```

`readAsActor` ＋ `RETURNING` の件数検査に直して解決した。
**書き込みも `app_server` ＋ `withActor` で行うこと。** 件12 は読みの話として書いてあるが、
書きでも同じである（むしろ書きの方が「消したつもりで消えていない」になるぶん危ない）。

### 件28 `media_sources` の DELETE ポリシーは意図的に置いていない — 参考情報

A削除は行を消さず `storage_path` を null にして `purged_at` を立てる操作であり、
行を消す経路は設計に無い（PRIVACY_RETENTION.md §4）。
ポリシーが無ければ RLS が拒否するので、**持ち主でも DELETE は 0 行**になる（実測済み）。

P19（保持と削除）で物理削除を入れたくなったときは、この判断を読んでからにすること。
`source_sha256` は監査のために残す前提である。

### 件29 `upload-intent` も `edit_logs` に記録している — 参考情報

**ファイル本体が API を通らない**ため、サーバ側にこの記録が無いと
「誰がその音声を置いたか」を後から追えない。署名の発行は
「誰に、どのパスへの書き込み権を、上書き可否つきで渡したか」の記録である。

`defineHandler` は変更系メソッドで `audit.record()` が 0 件だと 500 で落とす（件14）。
`upload-intent` は DB を変更しないが POST なので、この規則に当たる。
**規則を緩めるのではなく、記録する側に倒した。**

### 件30 認証導線はまだ無い — **P4 以降で判断が要る（件20 の続き）**

画面B（`app/matches/[id]/media/page.tsx`）も画面Aと同じく、JWT を手で貼り付ける。
件20 の「ログイン導線をどの PR で入れるか」は**未決のままである**。
P3 の着手時に決めるのが自然と書いたが、決まらなかった。

Supabase Auth を実際に触る PR で入れること。`supabase-js` は Auth と Storage 専用であり、
`packages/core/src/storage/**` と `packages/core/src/auth/**` 以外からの import は
静的検査で落ちる（ACCEPTANCE.md M35。`scripts/lib/supabase-imports.ts`）。

### 件31 SHA-256 は「ストリーミング計算」ではない — 参考情報

TASKS.md P3 は「Web Crypto で SHA-256 をストリーミング計算」と書いているが、
**Web Crypto に逐次更新の API は無い**（`crypto.subtle.digest` は入力全体を受け取る）。
自前実装は「暗号処理を手書きしない」より優先する理由が無いので採らなかった。

入力が 50MB 以下と決まっているため全体を読む（`packages/core/src/media/sha256.ts`）。
**上限を上げるときは、ここも見直すこと。** 上限が無ければこの判断は成り立たない。

### そのほか（参考情報）

- `UploadIntentRes` の `ready` に **`bucket` を足した**。TUS の metadata（`bucketName`）に要り、
  クライアントは `SUPABASE_STORAGE_BUCKET`（`NEXT_PUBLIC_` が付かない）を読めないためである。
  秘密ではない（署名トークンの適用範囲がそのバケットに閉じている）。
- **Storage の設定が無いときに stub へ落ちる分岐は作っていない。**
  作ると、設定漏れの本番が「上がったように見えてどこにも保存されていない」状態になる。
  テストは `setStorageSignerForTests()` で明示的に差し替える（本番では例外）。
- `viewer` の 403 は **DB を通しては検証できていない**。件10 の INSERT ポリシーにより
  `match_access` に `viewer` の行を作れないためである。純粋関数 `accessDenial` の 12 通りで
  確認済みであり、DB を通した 403 は共有機能の PR で検証する。
- **バケットはまだ存在しない。** 作成は人手（TRANSCRIPTION.md §7.3 の表）。
  P4 のジョブは音声の実体を必要としないが、G1 と ★G0 は必要とする。
- `check-no-real-data` の上限は **5MB のまま**変えていない。CI で使う音声は実行時に生成する
  （`app/dev/media-probe/silent-wav.ts` と同じ考え方）。
  Gold Dataset の `gold-01.mp3`（約20MB）を置くときに、上限の扱いを別途決めること。

---

## ローカル環境への移行で分かったこと（P3 完了後・P4 着手前）

開発環境をクラウドセッションから **ローカル（WSL2 上の Ubuntu）** へ移したときに、
実際に踏んだことと、それに対して本ブランチ（`chore/local-dev-environment`）で直したこと。推測は含まない。
確認した環境: Linux 6.18 (microsoft-standard-WSL2) / Node v22.23.2 / Docker の `postgres:16`
（PostgreSQL 16.15 Debian）/ vitest 4.1.11。ホストに `psql` と `pg_isready` は**無い**。

移行の結果、**主たる実行場所はローカル、クラウドセッションは補助**になった
（判断: 2026-09-03、ユーザー。`DEV_ENVIRONMENTS.md` §0、`TASKS.md` の実行場所の語彙も差し替え済み）。

### 件32 `scripts/db-migrate.ts` は `.env.local` を読まない — 参考情報（対応済み）

`process.env.DIRECT_URL` を直接見るだけなので、`.env.local` があっても素の `npm run db:migrate` は落ちる。

```
$ npm run db:migrate
DIRECT_URL が未設定です。クラウドセッションでは scripts/install_pkgs.sh が .env.local を生成します。
exit=1
```

クラウドでは `install_pkgs.sh` が値を渡していたため表面化しなかった。
`tests/db/setup.ts` は `process.loadEnvFile(".env.local")` で読んでいるので `test:db` は通る。**migrate だけが違う。**

**判断（2026-09-03・ユーザー）: `db-migrate.ts` に `.env.local` を読ませない。** 読ませると、
ローカルの `.env.local` に本番の `DIRECT_URL` を置いた瞬間、素の `npm run db:migrate` が本番へ流れる
（`assertNotRealDatabaseFromCloudSession` は `CLAUDE_CODE_REMOTE=true` のときしか止めない）。

対応:
- 手で叩くときの前置き `set -a && . ./.env.local && set +a && npm run db:migrate` を
  `DEV_ENVIRONMENTS.md` §1.4 と `CLAUDE.md` に明記した
- `install_pkgs.sh` が `.env.local` を読んで migrate を流すので、普段は人が打たない

**罠（実際にこのセッションで起きた）**: 起動前のシェルで `set -a && . ./.env.local` をしていると、
Claude Code のシェルがそれを継承して**素の `db:migrate` が通ってしまう**。
`env -i PATH="$PATH" HOME="$HOME" bash -lc 'npm run db:migrate'` で素の環境を作ると、上のとおり exit 1 だった。
「通った」と報告する前に、環境変数の継承を疑うこと。

### 件33 手順書を読まずに手で `CREATE ROLE` した結果ハマった — 参考情報（`db-bootstrap.sql` で対応済み）

**失敗の経緯。** `scripts/db-bootstrap.sql` と `scripts/db-bootstrap-schema.sql` が既にあり、
クラウドセッション（`install_pkgs.sh`）と CI（`ci.yml` の database ジョブ）はどちらもこれを流している
（二か所に SQL を書かないための1ファイル）。ローカルではこれを流さず、次を手で打った。

```
docker run -d --name ada-pg -e POSTGRES_PASSWORD=devonly -e POSTGRES_DB=debate_dev -p 5432:5432 postgres:16
CREATE ROLE app_migrator / app_server（LOGIN PASSWORD 'devonly'）
ALTER SCHEMA public OWNER TO app_migrator
GRANT ALL ON SCHEMA public TO app_migrator
GRANT USAGE ON SCHEMA public TO app_server
```

そのうえで `db:migrate` を流すと落ちた。

```
PostgresError: permission denied for database debate_dev
  code: '42501'
  routine: 'aclcheck_error'
```

`GRANT CREATE ON DATABASE debate_dev TO app_migrator` を足して通った。

**原因は権限設計ではなく手順の迂回である。** マイグレーションの `CREATE SCHEMA IF NOT EXISTS "drizzle"` は
DB への CREATE 権限を要る。`db-bootstrap.sql` は DB を `OWNER app_migrator` で作るので、
その経路（クラウド・CI）では所有者権限で通る。`docker run -e POSTGRES_DB=debate_dev` は
**postgres 所有の DB を先に作る**ため、`CREATE DATABASE ... WHERE NOT EXISTS` が飛び、所有者にならない。

対応と実測（使い捨てコンテナ `ada-pg-verify`、ポート 55432）:

- `POSTGRES_DB=debate_dev` 付きで作り、HEAD の `db-bootstrap.sql` → `db-bootstrap-schema.sql` → migrate:
  **`42501` を再現**（`permission denied for database debate_dev`）
- `db-bootstrap.sql` に `GRANT CREATE ON DATABASE %I TO app_migrator` を1文足して流し直し → migrate **成功**。
  `ALTER SCHEMA public OWNER` は**打っていない**。`public` の所有者は `pg_database_owner` のままで
  `test:db` **8ファイル102件合格**。**つまり手順で打った `ALTER SCHEMA public OWNER` は要らなかった。**
- `POSTGRES_DB` 無しで作り、`install_pkgs.sh` に全部やらせる（白紙から）: exit 0、DB の所有者は
  `app_migrator`、`.env.local` 生成、migrate 適用、`test:db` 8ファイル102件合格

**次にローカルを立てるときは、ロールを手で作らない。** `bash scripts/install_pkgs.sh` が
bootstrap SQL 2本を流す（ホストに `psql` が無ければ `docker exec -i ada-pg psql` で代用する）。
`POSTGRES_DB` は渡さないのが素直だが、渡してしまっても GRANT が効くので壊れない。

### 件34 `.nvmrc` が無かった — 参考情報（追加済み）

`package.json` の `engines` は `">=20 <23"`、CI の `NODE_VERSION` は `"22"`。ローカルの既定は v24 で、
範囲外のまま動きかけた（`npm ci` は警告を出すだけで止まらない）。

`.nvmrc`（`22`）を追加し、`tests/unit/node-version.test.ts` で
`.nvmrc`・`engines`・CI の `NODE_VERSION`・**いま走っている Node** の4つが揃うことを検査するようにした。
範囲外の Node でテストを走らせると、そのテスト自体が落ちて気づける。

### 件35 `install_pkgs.sh` のローカル分岐 — 参考情報（P4 以降は毎セッションこれが走る）

従来は「`node_modules` が無ければ `npm ci`」だけだった。DB の準備まで見るようにした。

- **コンテナを起動も作成もしない**（判断: 2026-09-03、ユーザー。SessionStart は毎セッション走るため、
  ライフサイクルまで持たせると範囲が広すぎる）。応答が無ければ `docker start` / `docker run` の
  完全な行を出力して `exit 0`。停止したコンテナで実測済み
- **`.env.local` が既にあれば上書きしない**。目印を書いて3回続けて走らせ、残ることを確認した。
  クラウド分岐は従来どおり毎回上書きする
- 冪等。2回目以降は `[notice] schema "drizzle" already exists, skipping` が出るだけ。所要 約1秒
- `ADA_SKIP_LOCAL_DB=1` / `ADA_PG_PORT` / `ADA_PG_CONTAINER` / `ADA_PG_DB` / `ADA_PG_SUPERPASS` で変えられる
- `tests/unit/install-pkgs.test.ts` に「`docker run`/`docker start` を実行しない（案内文にだけ現れる）」
  「破壊操作を含まない」「`.env.local` を上書きしない」「手で `CREATE ROLE` しない」の静的検査を足した

**このブランチで検証できていないこと**: クラウド分岐の実挙動（ローカルから実行できない。共通化の
リファクタが壊していないことは静的検査まで）。ホストに `psql` がある環境の分岐（手元には無い）。

### そのほか（参考情報）

- `RULESET_DEFAULT` は `.env.local` に書いたが、`envSchema` に `.default("henda-20")` があるので**必須ではない**。
  `install_pkgs.sh` が生成する `.env.local` にも入れていない
- `.env.local` の内容（ダミー値）: `DATABASE_URL=postgres://app_server:devonly@127.0.0.1:5432/debate_dev` /
  `DIRECT_URL=postgres://app_migrator:devonly@127.0.0.1:5432/debate_dev` / `SUPABASE_JWT_SECRET=devonly-jwt-secret`
- `docs/TASKS.md` の「実行場所」を「Web / デスクトップ」から「ローカル（クラウドセッションでも可）／
  ローカル（実キー）/ CI／ローカルで実装 → 人の確認」に差し替えた。各PRの要件そのものは変えていない

---

## P4 から P5 への申し送り

P4（ジョブ基盤）の作業中に、実際にコード・DB を触って確認した事項。推測は含まない。
確認した環境はローカル（WSL2 上の Ubuntu / Docker の `postgres:16` = PostgreSQL 16.15 /
Node v22 / vitest 4.1.11）。

### 件36 `max_attempt` は総試行回数の上限 — 判断済み（P5 で同じ問いが出る）

**判断（2026-09-03・ユーザー）: `max_attempt` は総試行回数の上限であり、
自動再投入だけの上限ではない。人が `retry` を撃った回数も同じ `attempt` に積む。**

きっかけは、`retryJob` を書いていて次の穴に気づいたことである。

- `claimNextJob` は `attempt < max_attempt` の行しか拾わない
- `max_attempt` の既定は 3。3 回失敗したジョブに人が `retry` を撃つと `queued` に戻る
- しかし二度と拾われない。**エラーも出ず、黙って進まない**

読みが 2 通りあった。

1. **自動再投入の上限**と読む → 人の `retry` は回数に関係なく通す。
   `0003` の `CHECK (attempt <= max_attempt)` と `claimNextJob` の絞り込みが邪魔になり、
   新しいマイグレーションが要る
2. **総試行回数の上限**と読む → いまの実装で正しく、足りないのはエラーの返し方だけ

**2 を採った。** 理由は、`0003` の CHECK が既にその読みで書かれていること、および
「行を作り直さず `attempt` を積み上げる」と決めた以上、人の `retry` だけ別勘定にすると
`attempt` が実際に走らせた回数を表さなくなることである。**`0004` は作っていない。**

返すのは **`409 VERSION_CONFLICT`**。`cancel` を終了状態に撃ったときと同じ
「この行はもう動かせない」という事実であり、新しい語彙を増やさない。
`JOB_ALREADY_RUNNING` は「走っている」の意味なので、走っていないこの場面では嘘になる。
ただし `VERSION_CONFLICT` だけでは理由が分からないため、
**メッセージに `試行回数の上限に達しています（attempt/max_attempt）` と数字を入れている。**

`TRANSCRIPTION.md` §6.2 に 1 行足した。

**P5 で自動再投入（`attempt < max` なら `queued` へ戻す）を実装するとき、同じ問いが出る。**
そのときも「人の retry と自動再投入は同じ `attempt` を消費する」で通すこと。
別勘定にしたくなったら、`attempt` と `max_attempt` の意味そのものを設計し直すことになる。

---

## v08 → v09 統合の申し送り（P4 完了後・分割文書更新の前）

ブランチ `docs/design-v08` で、`BASIC_DESIGN_v08.md` を実装（P0〜P4）と分割文書の現行版に
突き合わせ、`BASIC_DESIGN_v09.md` を正本として新設した作業（2026-09-05〜06）。
確認した環境はローカル（WSL2 / Docker `postgres:16` / Node v22 / vitest 4.1.11）。

### 件37 `assertNotSystemActor` が `if (false as boolean)` で無効化されたままコミットされていた — 修正済み（`999d600`）

`packages/core/src/http/define-handler.ts:295` が次の状態で `ef9153b`（P4）に入っていた。

```ts
if (false as boolean) await assertNotSystemActor(tx);
```

件22 と同じ「守りを外してテストが落ちることを確かめる」作業（`scripts/db-guard-toggle.mjs`）の
回で、DB 側は `zz-snapshot.json` から戻したが、**TS 側にはその仕組みが無く、戻し忘れた**。

実測：`npm run test:db` → `tests/db/define-handler.test.ts`「sub がシステム actor の JWT は 401」が
`expected 200 to be 401` で落ちていた（1 failed / 128 passed）。つまり **P4 完了時点で `test:db` は赤だった**。
`sub` がシステム actor（`public.system_actor_id()`）の JWT を作れる者が、RLS の
`transcription_jobs_select_member` / `edit_logs_insert_member` の節でランナーとして通り、
全 match のジョブと編集履歴を読める状態だった。

**無条件に戻すと別の2件が落ちる。** `runInTx` は JWT 経路と内部 API 経路の両方が通り、
内部経路は `withSystemActor` が**意図して**システム actor を `set_config` する。そこでガードが発火し、
「X-Job-Secret が一致すれば通る」「Authorization: Bearer でも同じ秘密で通る」が
`expected 401 to be 200` で落ちた（2 failed / 127 passed）。docstring どおり JWT 経路だけのガードなので、
条件を付けた。

```ts
if (auth !== "internal") await assertNotSystemActor(tx);
```

`auth` は `defineHandler(options)` の引数から分割代入され `route` クロージャに閉じ込められる値で、
リクエストから決まらない（`define-handler.ts:79-80, 214-222`）。内部経路は `authenticateInternal()`
（`176-193`）で共有秘密の照合を通らないと `withSystemActor`（`366-369`）へ到達しない。
修正後 `test:db` 129/129、`test:unit` 237/237、typecheck・lint 緑。

**教訓（次に守りを外して確かめるとき）**：TS 側のガードを外すなら、`git stash` か別ブランチでやる。
`if (false as boolean)` のような「戻し忘れても typecheck が通る」書き方をしない。

### 件38 v08 の第9.2・12.1・13章・付録A は、P1 で v05 へ入れた修正より前の本文から書かれていた — 参考情報（v09 で修正済み）

`git log --follow docs/BASIC_DESIGN_v05.md` で、v05 は `69868da`（第13章を P1 実装に合わせる）と
`574d676`（横断確認）の2回更新されていた。v08 の該当章はこの2コミットより前の形で、次が消えていた。

`SeatLabel` / `ChairCue`（kind 4値と refine）/ `TOTAL_*_SEC` / `Ruleset` と `StageDef` の refine 9つ /
`Uuid = z.uuid()` / `Issue` の side refine / `AttackEffectKind` と `DefendEffectKind` の分離 /
`FlowLink.comparison` / `ComparisonAxis.favors` / `STRENGTH_ORDER` / `z.iso.datetime()` /
`judge.test-d.ts` の説明 / §9.2 の role 5値 / §12.1 の `flow_links` 列 / 付録A の evidence。

さらに v08 §13.1 の `chairCues[].kind` は `name_call` / `match_end` という**実装にもどこにも無い語彙**
だった（実装・`henda-20.json`・`HENDA_RULESET §8` は `speech_start` / `debate_end`）。
`ruleset.test.ts` の 13 件の negative test がこの refine 群に依存しているので、v08 §13.1 をそのまま
実装に写すとテストが落ちる。

また v05 本体は `574d676`（8/26）以降更新が無く、分割文書は P3 / P4 で更新されている
（`aaa1792` / `e22cfe3` / `10a57dc` 等）。**v05 本体のほうが分割文書より古い。**
v09 のマージ元は「v08 ＋ v05 ＋ 分割文書の現行版」の三者だった。

`BASIC_DESIGN_v09.md` は v08 を `cp` して差分を当てる形で作った。冒頭の改訂履歴に
「v08 から引き継いだ項目」「実装と分割文書から取り込んだ項目」「v09 で新たに決めた点」の3系統で書いてある。
`CLAUDE.md` に「設計書の改訂は直前の版を複製して差分を当てる」を絶対原則として足した。

### 件39 判断 A〜G と v09 の9点 — 判断済み（2026-09-05・ユーザー）

計画時に【要判断】として挙げた7点と、v09 執筆中に決めた9点。詳細は `BASIC_DESIGN_v09.md` 冒頭の改訂履歴。

| # | 問い | 判断 |
| --- | --- | --- |
| A | P4 を完了とみなすか | P4 は「DB とドメインまで」と再定義。job API 6本（`API_SPEC.md §3`）は **P4.5** として P5 の前に置く。`app/api/v1/` に job ルートは1本も無く、`schema/job.ts` はバレルにも `generate-schemas.ts` にも入っていない |
| B | `consent_scope` の値域 | **5値** `practice_only` / `training_material` / `research` / `public` / `expert_reference`。v08 の `practice` は `practice_only` の書き損じ。DB CHECK（`0001`）・`schema/match.ts` の `ConsentScope`・`PRIVACY_RETENTION §2` は現在4値なので、スキーマ先行 PR で3点同時に直す |
| C | ballot 一意制約と assessments 分離の時期 | P12 で `UNIQUE(match_id, decided_by)` / `panel_size` / `judge_issue_assessments_human` の列と制約だけ入れる。パネル UI と `GET /panel` は P22。AI案の `judge_issue_assessments` は残す |
| D | `chairCues[].kind` | 実装語彙（`stage_start` / `prep` / `speech_start` / `debate_end`）＋ **`self_introduction`** の5値。`henda-20.json` へのエントリ追加はスキーマ先行 PR |
| E | `role` → `node_type` | `legacy_role` は作らない。flow テーブルが無く移行対象データが無い。`ArgumentRole` / `ATTACK_TARGET_ROLE` / `flow.test.ts` / `ARGUMENT_MODEL §1` / `HENDA_RULESET §4` / `API_SPEC §6` を一括で書き換える |
| F | `ComparisonAxis.favors` | 残す |
| G | `effect_kind` の語彙 | `flow_links.effect_kind` は実装の 9＋4 値に v07 の 7 値を足した **20値**。`clash_events.attack_type` は別語彙（8値）とし、v09 §9.6 に多対一の対応表を置いた |

v09 で新たに決めた9点（判断 A〜G の外）：(1) `RuleFlagType` に `dropped` を足して15値、(2) 名乗り区間の印は
`is_self_introduction` に統一（v08 の `is_self_naming` は同じ列）、(3) panel_size 偶数等は専用コードを作らず
`VALIDATION_FAILED` の `details` へ、(4) `ReviewReasonCode` 6値、(5) `AnswerEffectKind` を分離し ANSWERS では任意、
(6) `judge_cited_segments` に `judge_issue_assessments_human.segment_ids` を UNION、(7) `evidence_status` 3値、
(8) AI worker のロール名 `app_ai_worker` は**仮置き**（P12.4 で確定）、(9) P1.5 は P5 の前。

### 件40 次の PR の順序 — **次の PR で判断が要る**

v09 は正本になったが、分割文書と Zod はまだ v05 系列である。`CLAUDE.md` に「食い違ったら v09 を正とし相談する」と
書いてあるが、食い違いが残っている期間は短いほどよい。順序は次のとおり。

1. **分割文書の更新**（1 PR）。順序は v09 付録G「次の一手」2 のとおり
   `DATA_MODEL` → `ARGUMENT_MODEL` → `JUDGE_LOGIC` → `API_SPEC` → `HENDA_RULESET` → `TRANSCRIPTION` →
   `REVIEW_SEMANTICS` → `PRIVACY_RETENTION` → `ACCEPTANCE` → `TASKS`。
   `JUDGE_LOGIC §1.1` の L1/L2 書き分けはここ。`REVIEW_SEMANTICS §4` の「`.reviewed` → `role_status`」は
   §7.1 の第一原則に反する行なので必ず直す。
2. **スキーマ先行のマイグレーションと Zod・テストの一括書き換え**（1 PR。v09 §17.2 の列挙）。
   `ArgumentRole` → `NodeType`、`ChairCueKind` 5値、`ConsentScope` 5値（CHECK も）、`ERROR_STATUS` に4件、
   `henda-20.json` の `self_introduction`、`packages/core/src/schema/*.ts` と `ruleset/schema.ts` のヘッダコメント
   （`BASIC_DESIGN_v05 §13.x` のまま）。**`ruleset.test.ts` / `flow.test.ts` / `http-errors.test.ts` は仕様書の表を
   逐語で持っているので、文書を先に直してからテストを直す。** `npm run generate-schemas` の差分ゼロも確認する。
3. **P4.5**（job API 6本）→ P5。

判断が要る点：1 と 2 を1つの PR にまとめるか。文書だけの PR は CI が何も検証しないので、
2 と合わせたほうが「文書とコードの一致」を `test:unit` で確かめられる。ただし差分が大きくなる。
