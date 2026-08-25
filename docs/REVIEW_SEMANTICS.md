# REVIEW_SEMANTICS.md — レビュー状態の意味論

**このファイルの規則は製品価値そのものである。実装の都合で緩めない。**

前身プロジェクト whosaid-editor では、`✓`（人が耳で聴いて確定）と `△`（一括適用で埋めただけ）の
区別を壊さないことが最優先の設計原則だった。本アプリは判定に使うため、その区別をさらに細かく持つ。

---

## 1. 4軸の状態

ひとつの `transcript_segments` の行について、次の4軸を**独立に**持つ。

| 軸 | 値 | 意味 | 誰が書けるか |
| --- | --- | --- | --- |
| `text_status` | `ai_draft` / `human_edited` | 本文がAI出力のままか、人が直したか | `human_edited` は人の操作のみ |
| `time_status` | `unverified` / `derived` / `human_verified` | `unverified`=AI出力のまま<br>`derived`=アンカー照合で引き直した<br>`human_verified`=人が耳で確かめた | `human_verified` は人の操作のみ |
| `audibility` | `unknown` / `clear` / `partial` / `unheard` | 人のレビューで実際に聞き取れたか | **人のみ**（AIは書けない） |
| `role_status` | `ai_suggested` / `rule_derived` / `human_confirmed` | ステージと発言者の割当 | `human_confirmed` は人の操作のみ |

### 1.1 それぞれの初期値

| 経路 | text_status | time_status | audibility | role_status |
| --- | --- | --- | --- | --- |
| Pass B（AI転写） | `ai_draft` | `unverified` | `unknown` | `ai_suggested` |
| Pass C（アンカー照合成功） | 変更なし | `derived` | 変更なし | 変更なし |
| ステージ確定後の導出 | 変更なし | 変更なし | 変更なし | `rule_derived` |
| whosaid-editor取り込み | 元の値を保存（§4） | 同左 | `unknown` | 同左 |

### 1.2 `unknown` の扱い（v04で確定）

`unknown` は「**まだ人が聞いていない**」を意味する。「聞こえない」ではない。

| 場面 | 扱い |
| --- | --- |
| 解析View | 本文を表示する |
| Judge View | 本文を表示する。ただし `unreviewed: true` を付けて「未確認」と明示する |
| 判定のロック | **根拠として引用された segment に `unknown` が1件でも残っていたらロックできない** |

Judge Viewで `unknown` を隠すと、レビュー前は何も読めなくなり、作業が始められない。
だから隠さない。代わりに**ロックの段階で止める**。

`unknown` へ戻すAPIは存在しない。初期値としてのみ存在する。
`clear` / `partial` / `unheard` のいずれかを人が選んだ時点で、二度と `unknown` にはならない。

> これを許すと、AIの文字起こしを人間が聞いたものとして判定に使ってしまう。
> 本設計が最も避けたい事故が、ちょうどここで起きる。
> 詳細は `JUDGE_LOGIC.md` §5、`API_SPEC.md` §7.2〜7.3、`DATA_MODEL.md` §8。

### 1.3 `audibility` を AI が書けない理由

`audibility` は「機械が認識できたか」ではなく「**人間ジャッジが聞き取れたか**」である。
大会ルールは、発音や速度のためにジャッジが聞き取れなかった箇所を、
試合後に原稿や証拠資料で補って判定してはならないとしている（4.1.4 の注記）。
ASRのconfidenceは `audibility` の代用にならない。混同したらこの規定を再現できない。

DBでも担保する。`transcript_segments` に `audibility_set_by` を持ち、
`CHECK (audibility = 'unknown' OR audibility_set_by IS NOT NULL)` を張る。
ジョブや解析からは `audibility_set_by` を書けないので、AIは `unknown` から動かせない。

---

## 2. Judge View と 解析View

| ビュー | `audibility = unheard` の区間 | 用途 |
| --- | --- | --- |
| **Judge View** | 本文を表示しない。「聞き取れなかった」と表示 | 判定作業。ジャッジが実際に得た情報だけを見る |
| **解析View** | 本文を表示する（`unheard` の印付き） | 研修・解説・研究 |

`unknown`（未確認）は、どちらのビューでも本文を表示する。Judge Viewでは「未確認」と明示し、
ロックの段階で止める（§1.2）。

- **判定理由メモとJudge Sheetの生成は、Judge Viewの内容のみを根拠にする。**
- 解説レポートは両方を使えるが、Judge View外を根拠にした箇所はその旨を明示する。
- ビューの切替はUI上で常に見える位置に置く。どちらを見ているかが分からない状態を作らない。

---

## 3. 再解析で人手の結果を壊さない

### 3.1 列の分離

| 種類 | 列 | 更新するもの |
| --- | --- | --- |
| AI出力 | `text_ai`, `ai_start_ms`, `ai_end_ms` | 再転写・再解析が更新する |
| 人手 | `text_human`, `start_ms`, `end_ms`（人が直した場合） | 人の操作のみが更新する |

表示は `COALESCE(text_human, text_ai)`。

### 3.2 規則

- 再転写・再解析は `*_ai` 列だけを更新する。`*_human` 列には触れない。
- `human_edited` / `human_verified` / `human_confirmed` を、再解析が下位の状態へ戻さない。
- `edit_logs` は**追記のみ**。DELETE と UPDATE をDBトリガで拒否する。
- **テストで担保する**: 再解析の前後で `human_*` の件数が減っていないこと（`ACCEPTANCE.md` の該当項目）。

### 3.3 AI出力が人手と食い違ったとき

上書きせず、**差分として提示する**。
「再転写したところ本文が変わりました。確認しますか」というUIを出し、
人が採用を選ぶまで `text_human` は変えない。

---

## 4. whosaid-editor 作業JSON（schema 5）の取り込み

ローカルで前処理を済ませたユーザーのための正式な入力経路。
これによりPass A・Pass Bを省略でき、録音を外部へ送らずに解析・判定支援だけを使える。

| whosaid-editor | 本アプリ | 備考 |
| --- | --- | --- |
| `segments[].start` / `end` | `start_ms` / `end_ms` | 秒 → ミリ秒 |
| `segments[].text` | `text_ai`（`text_edited` が true なら `text_human`） | 人手修正を人手として引き継ぐ |
| `segments[].reviewed` | `role_status`: true→`human_confirmed` / false→`ai_suggested` | `✓` と `△` の意味論を保存 |
| `segments[].time_reviewed` | `time_status`: true→`human_verified` | |
| `segments[].orig_start` / `orig_end` | `ai_start_ms` / `ai_end_ms` | AIが出した元の時刻を残す |
| `segments[].cluster` / `chunk` | `import_meta` | 参考情報として保持のみ |
| `speakers[]` | **取り込み時に人が AFF/NEG・A1〜N4 へ対応づける** | 名簿と競技上の役割は別物。自動対応づけしない |
| `source_sha256` | `media_sources.source_sha256` | 同一音声かの検証に使う |
| `audio_fingerprint`（BLAKE2b） | `import_meta.original_fingerprint` | アルゴリズムは移植しない |
| `edit_log` | `edit_logs` へ追記型で移送 | 履歴を切らない |

### 4.1 取り込み時の規則

- **対応スキーマは schema 5 に固定する。** 他バージョンは明示的に拒否する。
- 変換層は1箇所（`packages/core/src/import/whosaid.ts`）に集約する。散らさない。
- 取り込んだ `human_*` の状態は、以後の再解析で上書きしない。
- 取り込み後もPass A・Pass Cは任意で実行できる（時刻だけ検証したい場合）。

---

## 5. 逐語性について

- **フィラー・言い直し・相づち・沈黙を自動削除しない。**
  会議では「同意の意思表示が消える」ことが問題だったが、
  ディベートでは「答えなかった」「沈黙した」「聞き返した」こと自体が判定材料になる。
- 整文版・要約版が必要な場合は、本文を置き換えず**別フィールド**に持つ。
- Pass Bのプロンプトには逐語モードの指示（フィラーを残す・整文しない）を必ず含める。
- **無音・沈黙も区間として保持する**。長い沈黙は質疑の評価に直結する。

---

## 6. フロー・判定側のレビュー状態

`transcript_segments` の4軸とは別に、フローと判定のオブジェクトは1軸を持つ。

| 状態 | 意味 | 表示 | 判定での扱い |
| --- | --- | --- | --- |
| `suggested` | AIが抽出・リンクしただけ | 灰色／点線 | 勝敗計算に自動確定しない |
| `reviewed` | 人が原音・文脈を確認した | 青 | レビュー済みとして使用可 |
| `confirmed` | 人がフロー上の意味まで確定した | 濃色／実線 | Judge Sheetの材料に使用 |
| `excluded` | New Argument等で判定から除外 | 赤取り消し線 | 解説には残すが勝敗に算入しない |

- **AIの出力は必ず `suggested` に入る。** これを構造で保証する（`JUDGE_LOGIC.md` §2）。
- `excluded` にできるのは人だけ。`rule_flags` が `confirmed` になった結果として遷移する。
- `excluded` のノードも削除しない。解説には「なぜ除外されたか」として残す。
