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
| 内部API | `/api/v1/internal/*` は `JOB_CRON_SECRET` の照合のみ。**JWTを受け付けない**（下記） |

#### 内部APIの秘密の受け取り方

`/api/v1/internal/*` は、次の**どちらのヘッダでも** `JOB_CRON_SECRET` を受ける。

| ヘッダ | 送り主 |
| --- | --- |
| `X-Job-Secret: <JOB_CRON_SECRET>` | 自前のポーラー・テスト |
| `Authorization: Bearer <JOB_CRON_SECRET>` | Vercel Cron |

**Vercel Cron は `Authorization: Bearer $CRON_SECRET` しか送れない。**
`vercel.json` の `crons` にカスタムヘッダを書く手段が無いため、設計側が合わせる。

**この経路では `Authorization` を JWT として一切解釈しない。**
`Bearer` を見た時点で `verifySupabaseJwt` へ流す実装を混ぜないこと。
混ぜると、内部APIが「JWTを受け付けない」境界（この表の4行目）を自分で外すことになる。
照合は `crypto.timingSafeEqual`。長さ違いで早期 return しない。
`JOB_CRON_SECRET` が未設定なら **500**。未設定のときに素通りさせる分岐は作らない。

内部APIは match に紐づかない（全 match のジョブを跨ぐ）ため、
`SET LOCAL app.actor_id` には **`public.system_actor_id()`** を入れる。
この UUID の定義は SQL 関数ただ1つで、RLSポリシーもサーバのガードもそこだけを見る
（`DATA_MODEL.md` §4.1）。**`sub` がこの値の JWT は 401 で弾く。**

### 0.3 楽観ロック（expectedVersion）

`lock_version` を持つ全エンティティの更新は、リクエストボディに `expectedVersion` を必須とする。

```jsonc
// PATCH /api/v1/segments/{id}
{ "expectedVersion": 3, "audibility": "unheard" }
```

- 一致しなければ `409 VERSION_CONFLICT`。応答の `details.currentVersion` に現在値を返す。
- **`expectedVersion` を省略した更新は受け付けない**（400）。「最後に書いた人が勝つ」を作らない。

### 0.4 冪等性（Idempotency-Key）

`Idempotency-Key` ヘッダを要求するのは、次の**いずれか**に当たる POST である。

1. **一意制約で二重作成を防げないもの。**
   例: `POST /matches`。`matches` に一意制約がないため、同じ試合を二度作れてしまう。
   画面Aの二重送信で試合が二つできるのは、実際に起きる事故である。
2. **外部への副作用を伴うもの。**
   例: ジョブ作成、エクスポート作成。DBの一意キーがあっても、HTTP層で先に止める価値がある。
   外部 provider を叩くため、行の一意性だけでは再送を吸収しきれないためである。
   ここでいう外部への副作用とは、**外部に状態を作る、または課金・実行が走るもの**を指す。
   読み取りや短命トークンの発行は含まない。

**この二つの観点で判定する。「例外かどうか」で判断しない。**
基準を観点として置くのは、エンドポイントが増えるたびに同じ議論をやり直さないためである。

- 同じキーで再送された場合、**新規作成せず既存の結果を返す**（200）。
  作成時が 201 でも再送は 200 で、`Idempotent-Replay: true` ヘッダを付ける。
- 同じキーで内容が違えば 400。
- ジョブの冪等キーはこれとは別に、DB側でも `match_id + kind + target_stage_no + params_hash` で担保する（`TRANSCRIPTION.md` §6.2）。ジョブは観点2に当たるので、**両方**を持つ。
- 記録先は `api_idempotency_keys`（`DATA_MODEL.md` §2）。記録と再送判定は、
  ハンドラ本体と同じトランザクション内で行う。外に出すと、記録の直前に落ちたときに二重実行できてしまう。

**Media の3本はいずれの観点にも当たらないため、対象外である**（§2）。
`source_sha256` の UNIQUE 制約が二重登録を構造的に防ぐ（観点1に当たらない）。
`upload-intent` は短命トークンを払い出すだけで、外部に状態を作らない（観点2に当たらない）。
二つの冪等機構が同じことを守ると、片方が壊れたときに気づけない。

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
| `POST` | `/api/v1/matches` | `authenticated` | 作成者がownerになる。`Idempotency-Key` 必須（§0.4 観点1） |
| `GET` | `/api/v1/matches` | `authenticated` | 一覧。RLS が見える範囲へ絞るので、match 単位の認可は要らない |
| `GET` | `/api/v1/matches/{id}` | `match:read` | |
| `PATCH` | `/api/v1/matches/{id}` | `match:write` | `expectedVersion` 必須 |
| `POST` | `/api/v1/matches/{id}/consent` | `match:owner` | 許諾の記録 |
| `PUT` | `/api/v1/matches/{id}/members` | `match:write` | 一括置換 |

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
  // 許諾の記録は matches の更新である。§0.3 のとおり expectedVersion を要求する
  expectedVersion: z.number().int(),
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

| method | path | 認可 | 備考 |
| --- | --- | --- | --- |
| `POST` | `/api/v1/matches/{id}/media/upload-intent` | `match:write` | 保存パスと署名トークンを払い出す |
| `POST` | `/api/v1/matches/{id}/media` | `match:write` | アップロード完了後の登録 |
| `GET` | `/api/v1/media/{id}/playback-url` | `match:read` | 短命の署名URL（既定15分） |

**`Idempotency-Key` は3本とも要求しない**（§0.4）。

`playback-url` は `params.id` が match id ではないため、`defineHandler` に
`matchIdFrom` を渡す（§11）。渡し忘れると「match id を特定できません」の 500 になる。

```ts
export const MediaMime = z.enum(['audio/mpeg','audio/mp4','audio/wav','audio/x-m4a']);

export const UploadIntentReq = z.object({
  filename: z.string(),                                // 表示用。保存パスには使わない
  byteSize: z.number().int().max(50 * 1024 * 1024),    // 入力規約：50MB以下
  mime: MediaMime,
  sourceSha256: z.string().length(64),                 // クライアントが先に全体を読んで計算する
});

// 判別可能なユニオン。呼び出し側に status での分岐を強制する
export const UploadIntentRes = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ready'),
    storagePath: z.string(),
    bucket: z.string(),                                // TUS の metadata に要る。秘密ではない
    tusEndpoint: z.string().url(),                     // 直接ストレージホスト
    uploadToken: z.string(),                           // x-signature ヘッダに載せる
    expiresAt: z.iso.datetime(),
  }),
  z.object({
    status: z.literal('already_exists'),
    mediaSourceId: z.uuid(),
  }),
]);

export const RegisterMediaReq = z.object({
  storagePath: z.string(),
  sourceSha256: z.string().length(64),
  durationMs: z.number().int().positive(),
  mime: MediaMime,                                     // intent と同じ enum。何でも通る口を作らない
  bitrate: z.number().int().nullable(),
  channels: z.number().int().nullable(),
  origin: z.enum(['upload','extracted_in_browser','imported']),
});

export const RegisterMediaRes = z.discriminatedUnion('status', [
  z.object({ status: z.literal('created'),        mediaSourceId: z.uuid() }),  // 201
  z.object({ status: z.literal('restored'),       mediaSourceId: z.uuid() }),  // 200
  z.object({ status: z.literal('already_exists'), mediaSourceId: z.uuid() }),  // 200
]);
```

### 2.1 保存パスはサーバが決める

`storagePath` は `{match_id}/{sha256}.{ext}`（バケットは `media`。`TRANSCRIPTION.md` §7）。

- `ext` は **mime から決める**。`filename` は申告値なので保存パスに混ぜない。
  `audio/mpeg → mp3` / `audio/wav → wav` / `audio/mp4 → m4a` / `audio/x-m4a → m4a`。
  拡張子はパスの一部にすぎず、内容の判定には使わない。
- したがって `sourceSha256` を intent の時点で受け取る必要がある。
  クライアントが先にファイル全体を読んで計算する（Web Crypto）。
- 一時パスを払い出して後から改名する案は採らない。
  Storage の改名は追加の権限と操作が要り、失敗時に孤児ファイルが残る。

### 2.2 三通りの結果（新規 / 既存 / purge後の再利用）

`media_sources` は `UNIQUE(match_id, source_sha256)` を持つ（`DATA_MODEL.md` §3）。
**重複はエラーではない。** 同じ音声を二度登録しようとしただけである。

| 状態 | `upload-intent` | `POST /media` |
| --- | --- | --- |
| 未登録 | `ready`（`upsert: false` で署名） | `created`（201） |
| 登録済み・`purged_at` が null | `already_exists` | `already_exists`（200） |
| 登録済み・`purged_at` あり（A削除後） | `ready`（`upsert: true` で署名） | `restored`（200） |

- **`upsert` はクライアントから受け取らない。** サーバが `purged_at` の有無で決める。
  署名トークンは発行時に `upsert` が焼き込まれるため、後から選ばせる余地がない。
  クライアントに上書きの可否を選ばせない、という意図でもある。
- **`POST /media` は INSERT の UNIQUE 違反（23505）を捕まえて SELECT し直す。**
  先に SELECT してから INSERT する形は、並行実行の競合を防げない。
- `restored` を `already_exists` と分けているのは、「一度消して入れ直した」ことが
  応答から分かるようにするためである。呼び出し側が `retention_events` を引かずに気づける。

### 2.3 `expiresAt` はサーバが選んだ期限ではない

Supabase の署名アップロードトークンは**有効期間が2時間に固定**されており、
期限を指定する引数がない。`expiresAt` は「**発行時刻＋2時間**」を返しているだけである。

`playback-url` の既定15分とは別物である。将来 Supabase が期限指定に対応しても、
**こちらが15分や2時間を選んだのではない**ことが分かるよう、ここに書いておく。

### 2.4 その他

- **ファイル本体はAPIを通らない。** ブラウザ → Supabase Storage（TUS）へ直接送る。
- `playback-url` の応答をDBに保存しない。毎回発行する。
- `mime` は申告値であり、内容の検証は行わない（`TRANSCRIPTION.md` §7）。

---

## 3. Job

| method | path | 認可 | 備考 |
| --- | --- | --- | --- |
| `POST` | `/api/v1/matches/{id}/jobs` | `match:write` | `Idempotency-Key` 必須（§0.4 観点2） |
| `GET` | `/api/v1/matches/{id}/jobs` | `match:read` | ポーリング用 |
| `POST` | `/api/v1/jobs/{id}/retry` | `match:write` | `failed` のみ。`matchIdFrom` が要る |
| `POST` | `/api/v1/jobs/{id}/cancel` | `match:write` | `queued` / `running`。`matchIdFrom` が要る |
| `POST` | `/api/v1/matches/{id}/jobs/run` | `match:write` | **1回の呼び出しで最大1件**。ポーリング用の実行契機 |
| `POST` | `/api/v1/internal/jobs/run` | 内部（§0.2） | Vercel Cron から。match を跨ぐ |

```ts
export const CreateJobReq = z.object({
  kind: z.enum(['align','stage_detect','stage_transcribe','anchor']),
  targetStageNo: z.number().int().min(1).max(12).nullable(),
});
```

- **`params_hash` はサーバが決める。** `kind` / `targetStageNo` / `ruleset_version` /
  `provider_id` / `model` を正規化して SHA-256 にする。リクエストからは受け取らない。
  受け取ると、クライアントが冪等キーを選べる＝二重実行を自分で作れることになる。
- `kind: 'stage_transcribe'` は、**`stage_segments` が `human_confirmed` でなければ `409 STAGES_NOT_CONFIRMED`**。
  推定のまま12回呼ばせない（`TRANSCRIPTION.md` §1.2）。
- `GET /jobs` の応答には `status` / `attempt` / `metrics`（所要時間・トークン量）を含める。
- 同じ冪等キー（`TRANSCRIPTION.md` §6.2）のジョブが既にあれば、
  `POST /jobs` は**新規作成せず既存を 200 で返す**。ここでは `409 JOB_ALREADY_RUNNING` を使わない。
  `409 JOB_ALREADY_RUNNING` を返すのは、**`failed` でないジョブに `retry` を撃ったとき**である。
- `cancel` を `succeeded` / `failed` / `canceled` に撃つと `409 JOB_ALREADY_RUNNING` ではなく
  **`409 VERSION_CONFLICT`**（状態がもう動かせない）。エラー語彙を増やさない。

### 3.1 実行契機が2本ある理由

`TRANSCRIPTION.md` §6.2 は「クライアントのポーリングと Vercel Cron の**両方**」と定めている。
ブラウザを閉じても進み、開いていれば速く進むためである。

`/internal/jobs/run` は `JOB_CRON_SECRET` を要るので、**ブラウザからは叩けない**。
秘密をクライアントへ出せば「サーバからのみ外部APIを呼ぶ」境界が消える。
そのため、ポーリング側の実行契機として `POST /matches/{id}/jobs/run` を置く。

| | 認可 | 対象 | 1回で進む数 |
| --- | --- | --- | --- |
| `/matches/{id}/jobs/run` | `match:write` | **その match だけ** | 最大1件 |
| `/internal/jobs/run` | 内部（§0.2） | 全 match | 最大1件 |

- **`Idempotency-Key` は要求しない。** 二重実行は `queued → running` の条件付きUPDATE
  （`lock_version`）が防ぐ。同じ機構を二つ置くと、片方が壊れたときに気づけない（§0.4 末尾と同じ理由）。
- **`GET /jobs` に副作用を持たせない。** リトライやプリフェッチで意図せず走る。

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
  issueId: z.uuid().nullable(),
  kind: z.enum(['CLAIM','ATTACK','DEFENSE','QUESTION','ANSWER','SUMMARY_POINT']),
  role: ArgumentRole.nullable(),   // 5値。BASIC_DESIGN_v05 §13.2 / ARGUMENT_MODEL.md §1
  stageNo: z.number().int().min(1).max(12),
  text: z.string().min(1),
  segmentIds: z.array(z.uuid()).min(1),   // ← 0件は 422 NODE_WITHOUT_SEGMENT
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
    issueId: z.uuid(),
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
  lockedAt: z.iso.datetime(),
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
  judgeDecisionId: z.uuid(),   // locked 済みのもののみ
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

**ここに載せるのは、実際に出荷しているコードである。** 架空のコードを書かない。
書き方の見本が動いていないと、次の実装者が見本のとおりに書いて壊れる。

### 11.1 基本形（`app/api/v1/matches/[id]/consent/route.ts` より）

```ts
import { z } from "zod";
import { defineHandler } from "@core/http";
import { ConsentReq } from "@core/schema";
import { requireMatch } from "@core/db/repo/matches";
import { updateWithVersion } from "@core/db/optimistic";

export const runtime = "nodejs";

export const POST = defineHandler({
  auth: "match:owner",
  params: z.object({ id: z.uuid() }),
  body: ConsentReq,
  requireExpectedVersion: true,
  handler: async ({ params, body, tx, audit }) => {
    const before = await requireMatch(tx, params.id);

    const after = await updateWithVersion<{ lock_version: number; consent_recorded_at: Date }>(tx, {
      table: "matches",
      id: params.id,
      expectedVersion: body.expectedVersion,
      set: {
        consent_scope: body.scope,
        consent_obtained_from: body.obtainedFrom,
        consent_expires_on: body.expiresOn,
        // 記録した時刻はサーバが決める。クライアントから受け取らない
        consent_recorded_at: new Date(),
      },
    });

    audit.record({
      entity: "matches",
      entityId: params.id,
      matchId: params.id,
      before: { consentScope: before.consentScope, consentRecordedAt: before.consentRecordedAt },
      after: { consentScope: body.scope, consentRecordedAt: after.consent_recorded_at.toISOString() },
    });

    return { data: { id: params.id, version: after.lock_version }, status: 200 };
  },
});
```

押さえる点。

- `auth` は `AuthMode` の語彙（`authenticated` / `match:read` / `match:write` / `match:owner`）。
  `member` / `owner` という語は使わない。`viewer` は `match:write` を通らない。
- **更新系は `updateWithVersion()` を使う。** 条件付きUPDATEが0行のとき、
  RLSで見えていないのか版がずれているのかを切り分け、それぞれ `404` と
  `409 VERSION_CONFLICT`（`details.currentVersion` 付き）にする。route ごとに書くと必ず片方を忘れる。
- **`audit.record()` を呼ばない変更系ハンドラは 500 で落ちる。** 警告ではなく例外である。
  警告にすると、記録の無い変更がいつか必ず本番へ出る。
- 他人の match は 403 ではなく **404** を返す。403 だと存在が漏れる。

### 11.2 id が match でないとき（`app/api/v1/media/[id]/playback-url/route.ts` より）

`defineHandler` は既定で `params.id` を match id とみなす。
`/media/{id}` のように id が match でないエンドポイントでは **`matchIdFrom` を渡す**。
渡し忘れると「match id を特定できません」の 500 になる。

```ts
export const GET = defineHandler({
  auth: "match:read",
  params: z.object({ id: z.uuid() }),
  /**
   * match は media_sources の行から引く。
   *
   * このクエリは認可の前に走るが、SET LOCAL app.actor_id 済みの
   * トランザクション上なので RLS が効く。見えないメディアはここで 404 になる。
   * 403 にすると、その id のメディアが存在することが漏れる。
   */
  matchIdFrom: async (params, tx) => (await requireMedia(tx, params.id)).matchId,
  handler: async ({ params, tx }) => {
    const media = await requireMedia(tx, params.id);
    if (media.storagePath === null) {
      throw new ApiError("RETENTION_PURGED", "この音声は保持期限またはA削除により削除済みです");
    }
    const signed = await getStorageSigner(parseEnv(process.env)).createPlaybackUrl(
      media.storagePath,
      PLAYBACK_URL_TTL_SECONDS,
    );
    return { data: { url: signed.url, expiresAt: signed.expiresAt } };
  },
});
```

- `matchIdFrom` は `(params, tx) => string | Promise<string>` である。
  id から表を引かないと match が分からない場合のために `tx` を受け取る。
- **この経路を外すと、持ち主でも 404 になる**（既定の `params.id` を match id として
  照会するため）。黙って通ることはない。P3 で実際に外して確かめてある。

### 11.3 `defineHandler` が担保すること
1. JWT検証 → `actor`
2. トランザクション開始 → `SET LOCAL app.actor_id`
3. Zod検証（`params` / `body`）→ 失敗は `400 VALIDATION_FAILED`
4. `expectedVersion` の照合 → 不一致は `409 VERSION_CONFLICT`
5. `Idempotency-Key` の記録と再送判定
6. 例外 → エラーコードへの変換
7. **`edit_logs` への追記**（`before` / `after` / `actor`）

**素の `route.ts` を直接書かない。** 書くと1〜7のどれかが抜ける。
