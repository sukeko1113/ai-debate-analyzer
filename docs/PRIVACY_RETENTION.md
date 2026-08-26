# PRIVACY_RETENTION.md — 保持レベルと削除

このアプリは**未成年である高校生の音声と氏名**を扱う。
「音声だけ消せばよい」ではない。**transcript本文・氏名・判定理由・証拠の引用部分も個人情報になり得る。**

したがって保持を5層に分け、**試合単位で「何を、いつ消すか」を指定できる**ようにする。

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

`consent.scope` から既定値を導く。ユーザーは短くはできるが、長くはできない。

| scope | A 音声 | B transcript | C 氏名 | D フロー・判定 |
| --- | --- | --- | --- | --- |
| `practice_only`（校内練習） | 90日 | 1年 | 1年 | 無期限 |
| `training_material`（研修教材） | 1年 | 3年 | **試合終了時に即匿名化** | 無期限 |
| `research`（研究利用） | 1年 | 3年 | **即匿名化** | 無期限 |
| `public`（公開教材） | 個別合意 | 個別合意 | **即匿名化** | 無期限 |
| `expert_reference`（熟練ジャッジ参照DB） | 個別合意 | 個別合意 | **即匿名化** | 無期限 |

`expert_reference` は Phase C 専用の scope である（`ARGUMENT_MODEL.md` §8）。
**通常の録画許諾に「AIの参照データにする」は含まれない。**
この scope を選べるのは、次がすべて揃った試合だけとする。

- 大会映像・音声の権利者の確認（主催者・学校・出場者）
- 解説している熟練ジャッジ本人の許諾（コメントは個人情報であり著作物でもある）
- 参照データとして使うことへの明示的な同意

- `consent.expiresOn` が設定されている場合、**そちらが優先**され、期限日にA〜Cを削除する。
- `practice_only` 以外は、氏名を持ち続ける理由がない。既定で匿名化する。

---

## 3. 匿名化（レベルC）の具体

氏名を消しても試合が成立するように、**最初から座席ラベルを主キーにする**。

| 対象 | 匿名化後 |
| --- | --- |
| `match_members.display_name` | `null`。表示は `A1` / `N3` などの座席ラベル |
| `matches.aff_team` / `neg_team` | `AFF校` / `NEG校`（学校名を消す） |
| `judge_decisions.best_debater` | 座席ラベルに置換 |
| `judge_decisions.decided_by` | ジャッジID（内部）のみ。氏名を持たない |
| 本文中の人名 | **自動置換しない**（§3.1） |

### 3.1 本文中の人名を自動置換しない理由

スピーチには自己紹介の名乗り（条項2.2.2）が必ず入り、証拠資料の引用には専門家の氏名（条項3.2.1）が入る。
**専門家名は消してはいけない情報**であり、選手の名乗りは消すべき情報である。
機械的な人名検出では両者を区別できない。

したがって:
- レベルB（transcript本文）を残す場合は、**名乗り区間を人が印付けし、その区間だけを伏せる**。
- 印がつかないまま `research` / `public` 用途へ出す操作は、APIが拒否する。

---

## 4. 削除時に何をするか

| 対象 | A削除時 | B削除時 | C削除時 | D削除時 |
| --- | --- | --- | --- | --- |
| Storage のメディア | 物理削除 | — | — | — |
| `media_sources` | `storage_path = null`、`purged_at` を立てる。`source_sha256` は監査のため残す | — | — | — |
| `align_words` | 物理削除 | — | — | — |
| `transcript_segments.text_ai` / `text_human` | 残す | `null` にする。時刻・`audibility`・`is_silence` は残す | — | 物理削除 |
| `argument_nodes.text` | 残す | 残す（要約であり逐語ではない） | 残す | 物理削除 |
| `evidence_refs.cited_elements` | 残す | 残す | 残す | 物理削除 |
| `match_members.display_name` | 残す | 残す | `null` | — |
| `judge_decisions` | 残す | 残す | `best_debater` を座席へ置換 | 物理削除 |
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
| `anonymize_c_immediately` | bool |
| `lock_version` | int |

### `retention_events`（追記のみ）
| 列 | 型 |
| --- | --- |
| `id`, `match_id` | |
| `level` | text（`A_media` / `B_transcript` / `C_identity` / `D_flow_judge`） |
| `trigger` | text（`scheduled` / `manual` / `consent_expired`） |
| `affected_rows` | jsonb（テーブルごとの件数） |
| `actor`, `at` | |

### `media_sources` への追加
`purged_at timestamptz`

### `transcript_segments` への追加
`text_purged_at timestamptz`, `is_self_introduction bool`（名乗り区間の印）

---

## 6. 実行

| 契機 | 実装 |
| --- | --- |
| 期限到来 | Vercel Cron（日次）→ `/api/v1/internal/retention/run` |
| 手動 | `POST /api/v1/matches/{id}/purge`（試合名の入力を要求する） |
| 許諾失効 | `consent.expiresOn` の翌日にA〜Cを削除 |

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
| C削除後 | 上に加えて、座席ラベルでの表示 |
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
