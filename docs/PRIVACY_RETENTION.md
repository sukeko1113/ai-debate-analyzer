# PRIVACY_RETENTION.md — 保持レベルと削除

このアプリは**未成年である高校生の音声と氏名**を扱う。
「音声だけ消せばよい」ではない。**transcript本文・氏名・判定理由・証拠の引用部分も個人情報になり得る。**

したがって保持を5層に分け、**試合単位で「何を、いつ消すか」を指定できる**ようにする。

本書は v09 §16.2〜16.3・§12.1 に追随している（2026-09-06）。`consent_scope` の5値は本書 §2 が正本で、
`DATA_MODEL.md` §2・`schema/match.ts` の `ConsentScope`・DB の CHECK は P4.2 で5値に揃える。

---

## 1. 保持レベル

| レベル | 内容 | 消したら何が失われるか | 消しても残るもの |
| --- | --- | --- | --- |
| **A** 音声・動画 | Storage上のメディア本体 | 原音での再確認。audibilityの再判定 | 時刻・本文・フロー・判定 |
| **B** transcript本文 | `transcript_segments.text_ai` / `text_human`、`align_words` | 発言内容の閲覧。逐語記録としての価値 | ノードの要約テキスト・フロー構造・判定 |
| **C** 氏名・識別情報 | `match_members.display_name`、`judge_decisions.best_debater`、本文中の人名 | 誰の試合かの特定 | 座席ラベル（A1〜N4）・チーム区分・構造・判定 |
| **D** フロー・判定 | `issues` / `argument_nodes` / `flow_links` / `judge_*` / 解説 | 試合の議論構造と判定記録 | 匿名化された集計値 |
| **E** 匿名化統計 | 試合数、ステージ長、フラグ種別ごとの件数、一致率 | — | （最後まで残す層） |

**削除は A → B → C → D の順にしか進めない。**
Dだけ消してBを残す、のような穴あきは許さない（Bが残っていれば実質的に復元できてしまうため）。

---

## 2. 既定の保持ポリシー

`matches.consent_scope` から既定値を導く。ユーザーは短くはできるが、長くはできない。

| scope | A 音声 | B transcript | C 氏名 | D フロー・判定 |
| --- | --- | --- | --- | --- |
| `practice_only`（校内練習） | 90日 | 1年 | 1年 | 無期限 |
| `training_material`（研修教材） | **即時匿名化プロファイル**（下記） | 同左 | 同左 | 無期限 |
| `research`（研究利用） | **即時匿名化プロファイル** | 同左 | 同左 | 無期限 |
| `public`（公開教材） | 個別合意（既定は即時匿名化プロファイル） | 同左 | 同左 | 無期限 |
| `expert_reference`（熟練ジャッジ参照DB） | 個別合意（既定は即時匿名化プロファイル） | 同左 | 同左 | 無期限 |

**即時匿名化プロファイル（v09 §16.3）。** v05 は `training_material` 以下を「試合終了時に氏名だけ即匿名化」としていた。
それは音声（A）と transcript（B）を残したまま C 層を消す操作であり、§1 の順序規則（A → B → C → D）に正面から反する。
しかも順序規則の根拠がそのまま当てはまる。スピーチには必ず名乗りが入るため、A が残っていれば氏名は復元できてしまう。

代わりに、これらの試合は**解析が完了し G0 相当の確認（判定ロックと成果物の出力）が済んだ時点で、A → B → C を1トランザクションで実行する**。
中間状態を作らないので順序規則を破らず、氏名も音声も残らない。残るのはフロー構造と判定（D 層）以降である。
このプロファイルを選んだ試合は、取り込み時点でその旨を画面に表示し、**後から音声を再確認できない**ことを明示する。
`match_retention_policies.anonymize_c_immediately` がこのプロファイルの印である（§5）。

`expert_reference` は Phase C 専用の scope である（`ARGUMENT_MODEL.md` §8）。値域だけ先に入れ、運用は Phase C。
**通常の録画許諾に「AIの参照データにする」は含まれない。**
この scope を選べるのは、次がすべて揃った試合だけとする。

- 大会映像・音声の権利者の確認（主催者・学校・出場者）
- 解説している熟練ジャッジ本人の許諾（コメントは個人情報であり著作物でもある）
- 参照データとして使うことへの明示的な同意

- `matches.consent_expires_on` が設定されている場合、**そちらが優先**され、期限日にA〜Cを削除する。
- `matches.consent_recorded_at` が null の match では解析ジョブを作れない（`409 CONSENT_REQUIRED`。API と DB トリガの両方）。
- 保持期限は `matches` ではなく `match_retention_policies` に置く（§5）。
- `practice_only` 以外は、氏名を持ち続ける理由がない。既定で即時匿名化プロファイルにする。

---

## 3. 匿名化（レベルC）の具体

氏名を消しても試合が成立するように、**最初から座席ラベルを主キーにする**。

| 対象 | 匿名化後 |
| --- | --- |
| `match_members.display_name` | `null`。表示は `A1` / `N3` などの座席ラベル |
| `matches.aff_team` / `neg_team` | `AFF校` / `NEG校`（学校名を消す） |
| `judge_decisions.best_debater` | 座席ラベルに置換 |
| `judge_decisions.decided_by` | ジャッジID（内部）のみ。氏名を持たない |
| `media_sources.uploaded_by` | `null`（§5） |
| `match_members.intro_segment_id` が指す区間、`transcript_segments.is_self_introduction = true` の区間 | 本文を伏せ字にする。**名乗りは二か所**（開会の自己紹介と各スピーチ冒頭）にあり、両方を対象にする（v09 §16.3） |
| 本文中の人名（上記以外） | **自動置換しない**（§3.1） |

**C で消えるのは氏名であって、座席と担当ではない。** 実試合の書き起こしから氏名を落としても、
A1 が立論し A3 がディフェンスを担当したという競技上の記録は完全に残る。`ARGUMENT_MODEL.md` §6 の役割優先 UI は、
この状態でも画面が虫食いにならないことを保証するためのものである。

### 3.1 本文中の人名を自動置換しない理由

スピーチには自己紹介の名乗り（条項2.2.2）が必ず入り、証拠資料の引用には専門家の氏名（条項3.2.1）が入る。
**専門家名は消してはいけない情報**であり、選手の名乗りは消すべき情報である。
機械的な人名検出では両者を区別できない。

したがって:
- レベルB（transcript本文）を残す場合は、**名乗り区間を人が印付けし、その区間だけを伏せる**。
  印は `transcript_segments.is_self_introduction`（v08 の `is_self_naming` は同じ列）と `match_members.intro_segment_id` の2つで、
  座席の結び付け（`HENDA_RULESET.md` §2.1）で人が確定する。
- 印がつかないまま `research` / `public` 用途へ出す操作は、APIが拒否する。

---

## 4. 削除時に何をするか

| 対象 | A削除時 | B削除時 | C削除時 | D削除時 |
| --- | --- | --- | --- | --- |
| Storage のメディア | 物理削除 | — | — | — |
| `media_sources` | `storage_path = null`、`purged_at` を立てる。`source_sha256` は監査のため残す | — | — | — |
| `align_words` | 物理削除 | — | — | — |
| `transcript_segments.text_ai` / `text_human` | 残す | `null` にする。時刻・`audibility`・`is_silence` は残す | `is_self_introduction = true` の区間と `intro_segment_id` が指す区間の本文を伏せ字にする（B が残っている場合） | 物理削除 |
| `argument_nodes.text` | 残す | 残す（要約であり逐語ではない） | 残す | 物理削除 |
| `evidence_refs.cited_elements` | 残す | 残す | 残す | 物理削除 |
| `match_members.display_name` / `intro_segment_id` / `name_source` | 残す | 残す | `display_name` を `null`。`intro_segment_id` は残す（伏せ字対象の特定に要る）。`seat` / `seat_binding_status` は残す | — |
| `media_sources.uploaded_by` | 残す | 残す | `null` | — |
| `judge_decisions` / `judge_issue_assessments_human` | 残す | 残す | `best_debater` を座席へ置換。`reason` / `reason_grounds` / `compare_note` / `residual_note` に含まれる選手名は人が確認して伏せる（自動置換しない） | 物理削除 |
| `argument_node_scores.rationale` / `clash_events.rationale` / `official_decision_support.explanation` / `hp_ledger.reason` | 残す | 残す（発言の引用を含み得るが、要約である） | 残す | 物理削除（L2 / L1 / L3 は D 層） |
| `export_runs` の生成物 | — | 生成物を物理削除（本文を含むため） | — | 物理削除 |
| `edit_logs` の `before` / `after` | — | 本文を含む差分を `null` に置換 | 氏名を含む差分を `null` に置換 | — |
| `retention_events` | 追記 | 追記 | 追記 | 追記 |

> **`edit_logs` を忘れない。** 追記専用にしてあるため、
> 本文や氏名がここに残り続けると、削除したつもりで残る。
> 追記専用の原則は保つが、**削除に伴う `before` / `after` の伏せ字化だけは
> 専用の関数（`SECURITY DEFINER`）で許可する**。その操作自体も `retention_events` に記録する。

---

## 5. テーブル

### `match_retention_policies`
| 列 | 型 |
| --- | --- |
| `match_id` | uuid PK FK |
| `scope` | text（consent.scope） |
| `purge_a_on`, `purge_b_on`, `purge_c_on`, `purge_d_on` | date null可 |
| `anonymize_c_immediately` | bool。**即時匿名化プロファイル**の印（§2）。true なら G0 相当の確認後に A → B → C を1トランザクションで実行する。「C だけを先に消す」ではない |
| `lock_version` | int |

順序トリガ（`DATA_MODEL.md` §9）は A・B・C の一括遷移を通す。順序違反は `400 VALIDATION_FAILED` の `details` に理由を返す。専用コードは作らない。

### `retention_events`（追記のみ）
| 列 | 型 |
| --- | --- |
| `id`, `match_id` | |
| `level` | text（`A_media` / `B_transcript` / `C_identity` / `D_flow_judge`） |
| `trigger` | text（`scheduled` / `manual` / `consent_expired`） |
| `affected_rows` | jsonb（テーブルごとの件数） |
| `actor`, `at` | |

### `media_sources` への追加
`purged_at timestamptz`, `uploaded_by uuid`（C削除で `null`）

`uploaded_by` は `actor_id` であり氏名ではないが、`match_members` を引けば人に辿れるため
レベルCの対象に含める（`DATA_MODEL.md` §3）。

**A削除した行は消さない。** `storage_path` を null にし `purged_at` を立てて残す
（`source_sha256` は監査のため残す）。同じ音声を上げ直したときは、
その行を再利用して `storage_path` を入れ直し、`purged_at` を null に戻す
（`API_SPEC.md` §2.2 の `restored`）。

UNIQUE(`match_id`, `source_sha256`) があるため、行を作り直すことはできない。
「消したのに二度と入れられない」を避けるための復活経路である。
**一度消して入れ直した履歴は `retention_events` に残る**ので、
`media_sources` の行が上書きされても、削除があった事実は追える。

### `transcript_segments` への追加
`text_purged_at timestamptz`, `is_self_introduction bool`（名乗り区間の印。この列名に統一する）

### `match_members` への追加（v07）
`intro_segment_id uuid`（自己紹介での名乗り区間）, `name_source text`（`self_introduction` / `registration` / `unknown`）,
`seat_binding_status text`。`intro_segment_id` は C 削除後も残す（どの区間を伏せたかの特定に要る）。

---

## 6. 実行

| 契機 | 実装 |
| --- | --- |
| 期限到来 | Vercel Cron（日次）→ `/api/v1/internal/retention/run` |
| 手動 | `POST /api/v1/matches/{id}/purge`（試合名の入力を要求する） |
| 許諾失効 | `consent_expires_on` の翌日にA〜Cを削除 |
| 即時匿名化プロファイル | 判定ロックと成果物出力（G0 相当）の完了を契機に A → B → C を1トランザクションで実行 |

- 削除は**トランザクション内で完結**させ、途中で失敗したらロールバックする。
  半分だけ消えた状態を作らない。
- 削除の30日前に、matchのownerへ通知する（Phase B以降。MVPは画面での警告表示）。

---

## 7. 削除しても成立させる設計

「Aを消したらアプリが壊れる」を作らない。次を満たすように実装する。

| 削除レベル | まだできること |
| --- | --- |
| A削除後 | フローの閲覧、判定の閲覧、解説の閲覧、Word再出力（本文入り） |
| B削除後 | フローの閲覧、判定の閲覧、構造の解説。**逐語の再出力はできない**（`410 RETENTION_PURGED`） |
| C削除後 | 上に加えて、座席ラベルでの表示。**座席と担当の競技記録（A1 が立論し A3 がディフェンスを担当した）は完全に残る** |
| D削除後 | レベルEの集計のみ |

UIは、削除済みの層を「削除済み」と明示する。空欄にして「データがない」ように見せない。

---

## 8. Gitとfixture

- **実音声・実映像・実名・実試合transcriptをリポジトリに置かない。**
- `fixtures/` は合成データのみ（`ACCEPTANCE.md` §4）。
- CIの `check-no-real-data` が、音声・映像拡張子、大容量ファイル、
  および `fixtures/` 外に置かれた `.speakers.json` を検出して失敗させる。

---

## 9. 外部送信

| 送信先 | 送るもの | 同意 |
| --- | --- | --- |
| Pass A provider | 音声（署名URL） | 取り込み画面で明示し、チェックを必須にする |
| Pass B provider | 音声（Files API） | 同上 |
| 解析・判定支援LLM | 確定transcript（テキスト） | 同上 |

- 送信先の名称とリージョンを画面に表示する。「外部AIを利用します」ではなく、具体名を出す。
- **チーム名・学校名・氏名をプロンプトに含めない。** 不要な文脈を外へ出さない。
- ローカル完結が要件の案件には、whosaid-editorでの前処理＋作業JSON取り込みを案内する
  （`REVIEW_SEMANTICS.md` §4）。
