# API_SPEC.md — HTTP API 契約

**このAPIがセキュリティ境界そのものである。**
`confirmed` / `excluded` / `locked` を書けるのは、ここに定義されたエンドポイントだけ。
クライアントからDBへ直接書く経路は存在しない（Data APIは無効・`DATA_MODEL.md` §0.1）。

---

## 0. 共通仕様

### 0.1 ベースと形式

| 項目 | 規約 |
| --- | --- |
| ベースパス | `/api/v1` |
| 形式 | JSON（`Content-Type: application/json`）。ファイル本体はAPIを通さない |
| 実装 | Next.js App Router の Route Handler。`packages/core` のZodで入出力を検証 |
| 成功応答 | `{ "data": ... }` |
| 失敗応答 | `{ "error": { "code": "...", "message": "...", "details": ... } }` |

### 0.2 認証・認可

| 項目 | 規約 |
| --- | --- |
| 認証 | `Authorization: Bearer <Supabase Auth JWT>` |
| 検証 | サーバでJWTを検証し、`actor_id` を得る |
| 認可 | `actor_id` が対象matchのメンバーであること。トランザクション内で `SET LOCAL app.actor_id` を発行し、RLSにも同じ値を渡す |
| 内部API | `/api/v1/internal/*` は `X-Job-Secret: <JOB_CRON_SECRET>` のみ。JWTを受け付けない |

### 0.3 楽観ロック（expectedVersion）

`lock_version` を持つ全エンティティの更新は、リクエストボディに `expectedVersion` を必須とする。

```jsonc
// PATCH /api/v1/segments/{id}
{ "expectedVersion": 3, "audibility": "unheard" }
```

- 一致しなければ `409 VERSION_CONFLICT`。応答の `details.currentVersion` に現在値を返す。
- **`expectedVersion` を省略した更新は受け付けない**（400）。「最後に書いた人が勝つ」を作らない。

### 0.4 冪等性（Idempotency-Key）

ジョブ作成・エクスポート作成など、副作用のあるPOSTは `Idempotency-Key` ヘッダを必須とする。

- 同じキーで再送された場合、**新規作成せず既存の結果を返す**（200）。
- ジョブの冪等キーはこれとは別に、DB側でも `match_id + kind + target_stage_no + params_hash` で担保する（`TRANSCRIPTION.md` §6.2）。

### 0.5 エラーコード

| code | HTTP | 意味 |
| --- | --- | --- |
| `VALIDATION_FAILED` | 400 | Zod検証失敗。`details` にissue配列 |
| `UNAUTHENTICATED` | 401 | JWTなし／不正 |
| `FORBIDDEN` | 403 | matchのメンバーでない |
| `NOT_FOUND` | 404 | 対象なし |
| `VERSION_CONFLICT` | 409 | `expectedVersion` 不一致 |
| `CONSENT_REQUIRED` | 409 | `consent_recorded_at` が null のまま解析しようとした |
| `DECISION_LOCKED` | 409 | `locked_at` が入った判定を変更しようとした |
| `AUDIBILITY_UNRESOLVED` | 409 | **根拠segmentに `audibility = unknown` が残っている**（§7.3） |
| `STAGES_NOT_CONFIRMED` | 409 | ステージ未確定でPass Bを起動しようとした |
| `JOB_ALREADY_RUNNING` | 409 | 同じ冪等キーのジョブが実行中 |
| `NODE_WITHOUT_SEGMENT` | 422 | `segmentIds` が空 |
| `INVALID_LINK_DIRECTION` | 422 | relationの方向違反（`JUDGE_LOGIC.md` §4） |
| `ISSUE_LIMIT_EXCEEDED` | 422 | 片側3件目のIssue |
| `UNSUPPORTED_IMPORT_SCHEMA` | 422 | whosaid schema 5 以外 |
| `RETENTION_PURGED` | 410 | 保持期限切れで削除済みの層を要求した |
| `RATE_LIMITED` | 429 | |
| `PROVIDER_ERROR` | 502 | 転写・LLM providerの失敗 |
| `INTERNAL` | 500 | |

---

## 1. Match

| method | path | 認可 | 備考 |
| --- | --- | --- | --- |
| `POST` | `/api/v1/matches` | 認証済み | 作成者がownerになる |
| `GET` | `/api/v1/matches/{id}` | member | |
| `PATCH` | `/api/v1/matches/{id}` | member | `expectedVersion` 必須 |
| `POST` | `/api/v1/matches/{id}/consent` | owner | 許諾の記録 |
| `PUT` | `/api/v1/matches/{id}/members` | member | 一括置換 |

```ts
export const CreateMatchReq = z.object({
  motion: z.string().min(1).max(300),
  heldOn: z.string().date().nullable(),
  round: z.string().max(20).nullable(),
  affTeam: z.string().max(100),
  negTeam: z.string().max(100),
  rulesetId: z.literal('henda-20'),
  rulesetVersion: z.string(),
});

export const ConsentReq = z.object({
  scope: z.enum(['practice_only', 'training_material', 'research', 'public']),
  obtainedFrom: z.array(z.enum(['student', 'guardian', 'school', 'organizer'])).min(1),
  expiresOn: z.string().date().nullable(),
  note: z.string().max(1000),
});

export const PutMembersReq = z.object({
  expectedVersion: z.number().int(),
  teamSize: z.union([z.literal(3), z.literal(4)]),
  members: z.array(z.object({
    side: z.enum(['AFF','NEG']),
    seat: z.enum(['A1','A2','A3','A4','N1','N2','N3','N4']),
    displayName: z.string().max(60),
  })),
});
```

> `consent` が未記録の match に対して `POST /jobs` を呼ぶと `409 CONSENT_REQUIRED`。
> UIの注意書きではなく**API側で拒否する**。

---

## 2. Media

| method | path | 備考 |
| --- | --- | --- |
| `POST` | `/api/v1/matches/{id}/media/upload-intent` | TUSのアップロード先と保存パスを払い出す |
| `POST` | `/api/v1/matches/{id}/media` | アップロード完了後の登録 |
| `GET` | `/api/v1/media/{id}/playback-url` | 短命の署名URL（既定15分） |

```ts
export const UploadIntentReq = z.object({
  filename: z.string(),
  byteSize: z.number().int().max(50 * 1024 * 1024),   // 入力規約：50MB以下
  mime: z.enum(['audio/mpeg','audio/mp4','audio/wav','audio/x-m4a']),
});
export const UploadIntentRes = z.object({
  storagePath: z.string(),
  tusEndpoint: z.string().url(),                       // 直接ストレージホスト
  uploadToken: z.string(),
  expiresAt: z.string().datetime(),
});

export const RegisterMediaReq = z.object({
  storagePath: z.string(),
  sourceSha256: z.string().length(64),
  durationMs: z.number().int().positive(),
  mime: z.string(),
  bitrate: z.number().int().nullable(),
  channels: z.number().int().nullable(),
  origin: z.enum(['upload','extracted_in_browser','imported']),
});
```

- **ファイル本体はAPIを通らない。** ブラウザ → Supabase Storage（TUS）へ直接送る。
- `playback-url` の応答をDBに保存しない。毎回発行する。

---

## 3. Job

| method | path | 認可 | 備考 |
| --- | --- | --- | --- |
| `POST` | `/api/v1/matches/{id}/jobs` | member | `Idempotency-Key` 必須 |
| `GET` | `/api/v1/matches/{id}/jobs` | member | ポーリング用 |
| `POST` | `/api/v1/jobs/{id}/retry` | member | `failed` のみ |
| `POST` | `/api/v1/jobs/{id}/cancel` | member | `queued` / `running` |
| `POST` | `/api/v1/internal/jobs/run` | `X-Job-Secret` | Vercel Cron / ポーラーから |

```ts
export const CreateJobReq = z.object({
  kind: z.enum(['align','stage_detect','stage_transcribe','anchor']),
  targetStageNo: z.number().int().min(1).max(12).nullable(),
});
```

- `kind: 'stage_transcribe'` は、**`stage_segments` が `human_confirmed` でなければ `409 STAGES_NOT_CONFIRMED`**。
  推定のまま12回呼ばせない（`TRANSCRIPTION.md` §1.2）。
- `GET /jobs` の応答には `status` / `attempt` / `metrics`（所要時間・トークン量）を含める。

---

## 4. Stage

| method | path | 備考 |
| --- | --- | --- |
| `GET` | `/api/v1/matches/{id}/stages` | 候補または確定 |
| `PUT` | `/api/v1/matches/{id}/stages` | 境界の確定。`expectedVersion` 必須 |

```ts
export const PutStagesReq = z.object({
  expectedVersion: z.number().int(),
  stages: z.array(z.object({
    stageNo: z.number().int().min(1).max(12),
    startMs: z.number().int().min(0),
    endMs: z.number().int().positive(),
    nameAnnounced: z.boolean(),
  })).length(12),
  confirm: z.boolean(),        // true で role_status = human_confirmed
});
```

サーバ側検証:
- 12件そろっていること、`startMs` が単調増加、区間が重ならないこと
- `seat` はサーバが担当者表から導出する（**リクエストで受け取らない**）
- `confirm: true` を書けるのはこのエンドポイントのみ。ジョブや解析からは書けない

---

## 5. Transcript

| method | path | 備考 |
| --- | --- | --- |
| `GET` | `/api/v1/matches/{id}/segments` | `?stageNo=&view=judge\|analysis` |
| `PATCH` | `/api/v1/segments/{id}` | `expectedVersion` 必須 |
| `POST` | `/api/v1/segments/{id}/audibility` | 人の判断のみ |

```ts
export const PatchSegmentReq = z.object({
  expectedVersion: z.number().int(),
  textHuman: z.string().nullable().optional(),        // 書くと text_status = human_edited
  startMs: z.number().int().optional(),               // 書くと time_status = human_verified
  endMs: z.number().int().optional(),
}).refine(o => Object.keys(o).length > 1, '更新対象がない');

export const SetAudibilityReq = z.object({
  expectedVersion: z.number().int(),
  audibility: z.enum(['clear','partial','unheard']),  // ← unknown へは戻せない
});
```

- **`audibility` に `unknown` をセットするAPIは存在しない。** 初期値としてのみ存在する。
- `view=judge` の応答では、`audibility = 'unheard'` の `text` を返さない（`null` にして `hidden: true` を付ける）。
- `view=judge` の応答では、`audibility = 'unknown'` の segment に `unreviewed: true` を付ける（§7.3）。
- `*_ai` 列を書き換えるAPIは存在しない。更新できるのはジョブだけ。

---

## 6. Flow

| method | path | 備考 |
| --- | --- | --- |
| `POST` | `/api/v1/matches/{id}/flow/runs` | AI抽出の起動。結果は必ず `suggested` |
| `GET` | `/api/v1/matches/{id}/flow` | issues / nodes / links / flags |
| `POST` | `/api/v1/matches/{id}/issues` | |
| `PATCH` | `/api/v1/issues/{id}` | `expectedVersion` 必須 |
| `POST` | `/api/v1/matches/{id}/nodes` | `segmentIds` 1件以上 |
| `PATCH` | `/api/v1/nodes/{id}` | |
| `POST` | `/api/v1/matches/{id}/links` | |
| `PATCH` | `/api/v1/links/{id}` | |
| `POST` | `/api/v1/{entity}/{id}/review` | **`reviewStatus` を書ける唯一の経路** |

```ts
export const CreateNodeReq = z.object({
  issueId: z.string().uuid().nullable(),
  kind: z.enum(['CLAIM','ATTACK','DEFENSE','QUESTION','ANSWER','SUMMARY_POINT']),
  role: z.enum(['present','effect','importance','other']).nullable(),
  stageNo: z.number().int().min(1).max(12),
  text: z.string().min(1),
  segmentIds: z.array(z.string().uuid()).min(1),   // ← 0件は 422 NODE_WITHOUT_SEGMENT
});

export const ReviewReq = z.object({
  expectedVersion: z.number().int(),
  reviewStatus: z.enum(['reviewed','confirmed','excluded']),
  reason: z.string().max(500).optional(),          // excluded のとき必須
});
```

### 6.1 サーバが決めること（リクエストで受け取らない）

- `id`（UUID）
- `label`（`AD1` / `AD2` / `DA1` / `DA2`）
- `reviewStatus` の初期値（常に `suggested`）
- relationの方向妥当性の検証

> **LLMの応答スキーマに `id` / `label` / `reviewStatus` を含めない。**
> 含めると、いつか誰かがそのまま保存する（`JUDGE_LOGIC.md` §2.1）。

---

## 7. Judge

| method | path | 備考 |
| --- | --- | --- |
| `POST` | `/api/v1/matches/{id}/judge/runs` | AI候補の生成 |
| `GET` | `/api/v1/matches/{id}/judge/runs` | 履歴 |
| `PUT` | `/api/v1/matches/{id}/judge/decision` | 人間の確定（下書き）。`expectedVersion` 必須 |
| `POST` | `/api/v1/matches/{id}/judge/decision/lock` | **不変条件をここで検査する** |

```ts
export const PutJudgeDecisionReq = z.object({
  expectedVersion: z.number().int(),
  winner: z.enum(['AFF','NEG']),                   // 引き分けを表現できない
  votingIssue: z.enum(['AD1','AD2','DA1','DA2']),
  assessments: z.array(z.object({
    issueId: z.string().uuid(),
    probability: z.enum(['Hi','Lo']),
    value: z.enum(['Large','Small']),
    strength: z.enum(['Strong','Weak','None']),
  })).max(4),
  commPoints: z.object({
    aff: z.number().int().min(1).max(5),
    neg: z.number().int().min(1).max(5),
  }),
  bestDebater: z.string().max(60).nullable(),
  reason: z.string().min(1),
});

export const LockRes = z.object({
  lockedAt: z.string().datetime(),
  citedSegmentCount: z.number().int(),
});
```

### 7.1 `PUT /judge/decision` のサーバ検証

- `assessments` の `issueId` が、この match の `issues` に属すること
- AD合計 と DA合計 の比較を**サーバで計算**し、`winner` と矛盾しないことを警告として返す
  （矛盾していても保存は許す。ジャッジの判断を機械が拒否しない。ただし `warnings` に載せる）
- `locked_at` が入っていたら `409 DECISION_LOCKED`

### 7.2 ロック不変条件（重要）

`POST /judge/decision/lock` は、次をすべて満たすときだけ成功する。

1. `winner` / `votingIssue` / `commPoints` / `reason` が埋まっている
2. `votingIssue` に対応する `issues` が `confirmed` である
3. **判定根拠として引用された全 segment の `audibility` が `clear` / `partial` / `unheard` のいずれかに人間確定されている**
4. `status = 'candidate'` のまま放置された `rule_flags` がない（Phase B）

### 7.3 なぜ `unknown` でロックを止めるのか

`audibility = unknown` は「**まだ人が聞いていない**」という意味である。
これを許すと、AIの文字起こしを人間が聞いたものとして判定に使ってしまう。
本設計が最も避けたい事故がここで起きる。

- 「判定根拠として引用された segment」= `judge_decisions` から辿れる
  `issues` → `argument_nodes` → `node_segments` の集合（`reviewStatus = confirmed` のもの）
- 未確定が残る場合は `409 AUDIBILITY_UNRESOLVED` を返し、
  `details.pendingSegmentIds` に該当segmentのidを返す。UIはそこへ直接ジャンプする。
- **Judge Viewでは `unknown` の本文を隠さない。**
  隠すとレビュー前は何も読めなくなる。`unreviewed: true` を付けて「未確認」と明示し、
  ロックの段階で止める。

---

## 8. Export

| method | path | 備考 |
| --- | --- | --- |
| `POST` | `/api/v1/matches/{id}/exports` | `Idempotency-Key` 必須 |
| `GET` | `/api/v1/exports/{id}` | 生成物のパスと署名URL |

```ts
export const CreateExportReq = z.object({
  artifacts: z.array(z.enum([
    'transcript','flow_sheet','judge_sheet_official','judge_sheet_extended',
    'decision_memo','commentary','audit_trail',
  ])).min(1),
  judgeDecisionId: z.string().uuid(),   // locked 済みのもののみ
});
```

- `judgeDecisionId` が `locked_at` を持たない場合は `409 DECISION_LOCKED`（未ロックのため出力不可）。
- 同じ `judgeDecisionId` ＋ 同じ `templateVersion` からは、**何度でも同じ生成物が出る**（G7）。

---

## 9. Import（Phase B）

| method | path | 備考 |
| --- | --- | --- |
| `POST` | `/api/v1/matches/{id}/imports/whosaid` | schema 5 のみ |

- `schema !== 5` は `422 UNSUPPORTED_IMPORT_SCHEMA`
- `speakers[]` → `A1`〜`N4` の対応づけはリクエストで受け取る（人が画面で決めた結果）。**自動対応づけしない**

---

## 10. Retention（Phase B）

| method | path | 備考 |
| --- | --- | --- |
| `PUT` | `/api/v1/matches/{id}/retention` | 保持レベルごとの期限設定 |
| `POST` | `/api/v1/matches/{id}/purge` | 指定レベルの即時削除 |

```ts
export const PurgeReq = z.object({
  levels: z.array(z.enum(['A_media','B_transcript','C_identity','D_flow_judge'])).min(1),
  confirmPhrase: z.string(),   // 試合名の入力を要求する（誤操作防止）
});
```

詳細は `PRIVACY_RETENTION.md`。

---

## 11. Route Handler の実装型

全エンドポイントを同じ形で書く。例外を作らない。

```ts
// app/api/v1/segments/[id]/audibility/route.ts
export const POST = defineHandler({
  auth: 'member',
  params: z.object({ id: z.string().uuid() }),
  body: SetAudibilityReq,
  handler: async ({ params, body, actor, tx }) => {
    // tx: SET LOCAL app.actor_id 済みのトランザクション
    const seg = await tx.segments.lockForUpdate(params.id, body.expectedVersion);
    await tx.segments.setAudibility(seg.id, body.audibility, actor.id);
    await tx.editLogs.append({ entity: 'transcript_segments', ... });
    return { data: { id: seg.id, version: seg.lockVersion + 1 } };
  },
});
```

`defineHandler` が担保すること:
1. JWT検証 → `actor`
2. トランザクション開始 → `SET LOCAL app.actor_id`
3. Zod検証（`params` / `body`）→ 失敗は `400 VALIDATION_FAILED`
4. `expectedVersion` の照合 → 不一致は `409 VERSION_CONFLICT`
5. `Idempotency-Key` の記録と再送判定
6. 例外 → エラーコードへの変換
7. **`edit_logs` への追記**（`before` / `after` / `actor`）

**素の `route.ts` を直接書かない。** 書くと1〜7のどれかが抜ける。
