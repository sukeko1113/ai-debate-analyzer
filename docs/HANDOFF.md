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

（P2 完了時に追記する）
