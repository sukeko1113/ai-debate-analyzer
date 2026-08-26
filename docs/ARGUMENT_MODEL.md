# ARGUMENT_MODEL.md — 議論をどうモデル化するか

熟練ジャッジは、立論を一つの塊として見ていない。
**分解し、どこが攻撃され、どこが回復し、最後に何が残ったか**を追っている。
このファイルは、その思考過程をデータ構造にする方法を決める。

> **本アプリの価値は「AIが勝者を当てること」ではない。**
> 立論を分解する → Attackを当てる → Defenseを確認する → 生き残った論点を見る →
> Impactを比較する → Summaryを評価する → New Argumentを除外する → Voting Issueを決める。
> この過程を、音声・Flow・時刻付き根拠とともに見える形へ変えることにある。

---

## 1. 議論の4構成要素

各 Issue（AD1 / AD2 / DA1 / DA2）を一塊にせず、4つの要素に分解する。
**Attack は必ず「どの要素を攻撃したか」を持つ。**

| `role` | 意味 | 典型的なAttack | 崩れたときの波及 |
| --- | --- | --- | --- |
| `present` | 現状・前提（Present Situation / Inherency / Uniqueness） | 現状認識が違う／程度が違う | 前提が崩れると後段の `effect` も弱くなる |
| `effect` | Planから結果への因果（Effect / Link / Solvency / Process） | No link／因果が弱い／別原因がある | 因果が切れると Issue 全体が立たない |
| `importance` | 結果の重要性（Importance / Significance / Impact） | 規模が小さい／発生可能性が低い／価値がない | Value turn で逆転することもある |
| `evidence` | 主張を支える根拠と理由づけ（Evidence / Warrant） | 根拠不足／出典が弱い／ロジックジャンプ | Claim と根拠の接続が切れる |

### 1.1 `role: 'evidence'` と `evidence_refs` の違い

紛らわしいので明示する。

| | 何か | 攻撃対象になるか |
| --- | --- | --- |
| `argument_nodes.role = 'evidence'` | 「なぜそう言えるか」を述べた**言明**（ノード） | **なる**。ATTACKS の to になれる |
| `evidence_refs` | 引用の**記録**（出典・年度・氏名・肩書） | ならない。CITES の先。引用要件の充足を判定するための記録 |

「その統計は2005年のもので古い」という攻撃は、`role='evidence'` のノードに向かう。
`evidence_refs` は、その引用が条項3.2.1の必須要素を満たしていたかを別に記録する。

---

## 2. やりとりの種別（`effect_kind`）

`flow_links` に、そのやりとりが**何をしたのか**を持たせる。

### 2.1 ATTACKS の種別

| `effect_kind` | 意味 | 主な対象 `role` |
| --- | --- | --- |
| `not_true` | 現状認識が事実と違う | `present` |
| `not_unique` | Planがなくても同じことが起きる | `present` |
| `not_necessary` | Planがなくても Advantage は得られる | `present` |
| `no_link` | Planから結果への因果が成立しない | `effect` |
| `no_solvency` | Planでは解決しない | `effect` |
| `not_important` | 結果に客観的な価値がない | `importance` |
| `value_turn` | 価値づけを逆転させる（良いこと→避けるべきこと） | `importance` |
| `evidence_weak` | 根拠が不足／出典が弱い | `evidence` |
| `logic_jump` | Claim と根拠の接続が飛んでいる | `evidence` |

### 2.2 DEFENDS の種別

| `effect_kind` | 意味 |
| --- | --- |
| `re_evidence` | 新たな根拠で補強する（新規Attackではないこと） |
| `re_explain` | 説明し直す・誤読を正す |
| `counter_example` | 反例を示す |
| `mitigate` | 影響を限定する |

`value_turn` と `case_flip` の区別は大会ルール2.1.3の注記に従う。
価値だけを転倒する Value turn は許されるが、Case flip は立論での仕事である。
`case_flip` を検出したら `rule_flags` の候補にする。

---

## 3. やりとりの効果（`effectiveness`）

**今回の追加で最も重要な部分。** 最終結果だけでなく、
各 Issue が試合中にどう変化したかを追えるようにする。

### 3.1 持ち方

| 列 | 値 | 誰が書けるか |
| --- | --- | --- |
| `effectiveness_ai` | `strong` / `partial` / `none` | AIのみ |
| `effectiveness_human` | 同上・null可 | 人のみ。**任意** |
| `effectiveness_set_by` | actor_id | 人が入れたときだけ埋まる |
| `rationale_ai` | 「Planと効果の因果が弱い」等の説明文 | AIのみ |

表示は `COALESCE(effectiveness_human, effectiveness_ai)`。

### 3.2 `review_status` との違い

同じ `flow_links` に2つの状態があるので、混同しないこと。

| | 問い |
| --- | --- |
| `review_status` | **そのリンクは存在するか**（この Attack は本当に AD1 の Effect に向かっているか） |
| `effectiveness` | **そのやりとりは効いたか**（その Attack で Effect はどれだけ削れたか） |

### 3.3 人の入力は任意にする（重要な設計判断）

per-exchange の効果評価を人に必須で入力させない。理由は2つある。

1. **作業量が現実的でない。** audibility を全区間に付ける作業がすでにある。
   そのうえ Attack / Defense 一つずつに評価を求めると、ツールが使われなくなる。
2. **二重入力の矛盾が起きる。** 「AD1 Effect は完全回復」とログに付けたのに
   Decision Chart は `Probability: Lo`、という食い違いが必ず出る。
   どちらが正か、というルールを作る羽目になる。

### 3.4 判定の権威は Issue 単位に置いたまま

> **`effectiveness` は判定に一切入らない。**
> 勝敗を決めるのは `judge_decisions` の Probability / Value / Strength だけである。
> `effectiveness` は「なぜそう判定したか」を説明するためのものであり、
> 判定を計算するためのものではない。

集計コードが `effectiveness` を参照していないことを、CIで静的に検査する。

---

## 4. Debate Evolution View

「AD1 が試合中にどう変化したか」は、**新しいテーブルを作らずに導出する**。
`stage_no` の順序と `flow_links` の内容だけで再構成できるからである。

```sql
CREATE VIEW debate_evolution AS
SELECT
  i.match_id, i.label AS issue,
  n_to.role       AS target_role,
  s.start_ms      AS at_ms,
  n_from.stage_no AS stage_no,
  l.relation, l.effect_kind,
  COALESCE(l.effectiveness_human, l.effectiveness_ai) AS effectiveness,
  l.rationale_ai,
  l.effectiveness_human IS NOT NULL AS human_confirmed
FROM flow_links l
JOIN argument_nodes n_from ON n_from.id = l.from_node
JOIN argument_nodes n_to   ON n_to.id   = l.to_node
JOIN issues i              ON i.id      = n_to.issue_id
JOIN node_segments ns      ON ns.node_id = n_from.id
JOIN transcript_segments s ON s.id      = ns.segment_id
ORDER BY i.label, n_from.stage_no, s.start_ms;
```

これで、メモにあった時系列ログがそのまま出る。

| 時刻 | Stage | 対象 | 行為 | 攻撃/防御点 | AI候補 | 人の確定 |
| --- | --- | --- | --- | --- | --- | --- |
| 05:10 | NEG Attack | AD1 `effect` | `ATTACKS` | `no_link` | Planと効果の因果が弱い | 有効 |
| 22:35 | AFF Defense | AD1 `effect` | `DEFENDS` | `re_evidence` | 統計で因果を補強 | 一部回復 |
| 35:40 | AFF Summary | AD1 vs DA1 | `COMPARES` | — | 規模・確率・期間でAD1優位 | 採用 |

ここから「AD1 は Effect を大きく攻撃されたが Defense で一部回復し、
Importance は最後まで崩れなかったため、最終的に Strong 寄りで残った」
という説明を自動生成できる（`JUDGE_LOGIC.md` §6）。

**新テーブルを作らないことが肝心。** 作ると、`flow_links` とログの二重管理になり、
片方だけ更新される事故が起きる。

---

## 5. Impact 比較の4軸

Summary の `COMPARES` リンクに、比較の中身を持たせる。

| 軸 | 例 | 注意 |
| --- | --- | --- |
| `magnitude` | 影響人数、金額、生命、失業 | **数字が大きいだけで自動勝利にしない** |
| `probability` | 発生確率、因果の確かさ | Attack後にどれだけ残ったかを見る |
| `timeframe` | 短期か長期か | |
| `value` | 生命、権利、教育、経済 | 価値判断の理由を明示する |

### 5.1 スキーマ

```ts
// packages/core/src/schema/flow.ts
export const ComparisonAxis = z.object({
  axis: z.enum(['magnitude', 'probability', 'timeframe', 'value']),
  favors: z.enum(['AFF', 'NEG', 'neither']),
  rationale: z.string().min(1),
  source: z.enum(['debater', 'judge']),
  segmentIds: z.array(Uuid),          // Uuid = z.uuid()（packages/core/src/schema/ids.ts）
}).refine(
  o => o.source === 'judge' || o.segmentIds.length >= 1,
  'ディベーター由来の比較は根拠segmentを必須とする'
);
```

`flow_links.comparison`（jsonb）に `ComparisonAxis[]` として保存する。
**比較を持てるのは `relation = 'COMPARES'` のリンクだけである。**
DB 側は `CHECK (comparison IS NULL OR relation = 'COMPARES')`（`DATA_MODEL.md` §6）、
アプリ側は `FlowLink` の refine で担保する。

### 5.2 `source` を分ける理由

大会ルールの運用では、**比較基準が試合中に示されなかった場合、
ジャッジ独自の判断で比較評価してよい**とされている。
したがって「誰が持ち出した比較か」を区別できないと、判定理由の説明が不正確になる。

- `source: 'debater'` → 根拠 segment が必須。誰がいつ言ったかへ戻れる
- `source: 'judge'` → segment なしを許す。ただし判定理由に「試合中に比較基準が
  示されなかったため、ジャッジの判断による」と明記する

### 5.3 数値化しない

4軸はいずれも**理由の記述**であり、点数ではない。
「Magnitude 8点 vs 5点」のような持ち方をしない。
`JUDGE_LOGIC.md` §1.1 の「数値へ置換しない」がここにも及ぶ。

---

## 6. 役割優先UI

HEnDA では各ステージの担当役割が固定されている。
したがって解析・観戦画面では、**選手名より先に競技上の役割を出す**。

| 表示対象 | 原則 | 実装 |
| --- | --- | --- |
| **役割** | 必須・主表示 | 「肯定立論」「否定Attack」等を常に明示 |
| **座席ラベル** | 必須 | `A1`〜`N4`。ステージ確定後に担当者表から自動導出 |
| **選手名** | **任意表示** | 解析・観戦画面では省略可。必要なら役割の下に小さく |
| **公式出力** | 氏名を入れる | Best Debater 欄など、公式Judge Sheetで氏名が要る箇所のみ |

### 6.1 これは見た目の話ではない

**保持レベルC（氏名の匿名化）と完全に噛み合う。**
最初から役割ラベルが主で動く画面なら、氏名を消しても何も壊れない。
逆に選手名前提の画面を作ってから匿名化すると、表示が虫食いになる。

### 6.2 機械で担保する

> 解析・観戦画面のコンポーネントから `display_name` を参照しない。
> 参照してよいのは、試合登録画面と公式Judge Sheetの生成コードだけ。

静的検査でCIに入れる（`ACCEPTANCE.md` M24）。

---

## 7. HP View（Phase B・学習/観戦用）

AD1 / AD2 / DA1 / DA2 の強さの変化を、HPバーのように見せる補助表示。

```
AFF AD1 ████████░░
 ├ Present  : 残っている
 ├ Effect   : Attackで弱化 → Defenseで一部回復
 ├ Importance: Strong
 └ Evidence : 確認済み

NEG DA1 █████░░░░░
 └ Summaryで比較劣位
```

### 7.1 導出元

`debate_evolution` の `effectiveness` から計算する。
`effectiveness` は原則としてAI候補なので、**HPバーはAI推定である**。

### 7.2 守る規則

- **画面に常に「AI推定」と表示する。** 公式の得点だと誤解させない。
- **確定した判定からHPを計算しない。** 逆に、**HPから判定を計算しない。**
  双方向とも禁止。
- 判定の集計コードがHPモジュールを import していないことを、CIで静的に検査する
  （`ACCEPTANCE.md` M25）。

`JUDGE_LOGIC.md` §1.1 の「`Strong/Weak/None` を0〜100点へ置換しない」を、
表示層でも守るための規則である。

---

## 8. 熟練ジャッジ参照DB（Phase C）

実試合の映像に、経験豊富なジャッジが「どこで差がついたか」を解説している素材がある場合、
それは学習・評価資料として価値が高い。3〜4試合から始める。

### 8.1 保存する要素

| 要素 | 内容 | 利用 |
| --- | --- | --- |
| Turning Point | 熟練者が差がついたと判断した場面 | AI候補と比較 |
| Issue Evaluation | AD1/AD2/DA1/DA2 の評価 | Decision Chart候補の参考 |
| Attack/Defense評価 | どの反論が効いた・効かなかったか | `effectiveness` の参照例 |
| Comparison | 最終比較の軸と理由 | Summary支援・教材 |
| New Argument判断 | 新規議論と正当な比較の区別 | ルール検査の参照例 |
| Advice | 改善案・指導コメント | **判定理由とは別枠**で教材化 |

### 8.2 着手前に満たすべき前提（実装より先）

Phase C は、次がすべて揃うまで着手しない。

1. **大会映像・音声の権利者の確認**（主催者・学校・出場者）
2. **解説している熟練ジャッジ本人の許諾。** コメントは個人情報であり著作物でもある
3. **参照データとして使うことへの明示的な同意。**
   通常の録画許諾に「AIの参照データにする」は含まれない。
   `consent_scope` に `expert_reference` を新設し、これを選んだ試合だけが対象になる
4. 保持レベル A〜C がフルに関わるため、`PRIVACY_RETENTION.md` の期限設定を先に決める

### 8.3 「正解」にしない

> 熟練者のコメントは**唯一の正解として固定しない**。熟練ジャッジの判断例・参照データとして扱う。
> 複数ジャッジで見解が分かれる試合は、**その差も保存する**。教育価値はむしろそちらにある。

正解らしきものが手に入ると、Winner一致率を上げたくなる。
`ACCEPTANCE.md` §3.1 の「Winner一致率を上げるためにプロンプトを調整しない」は、
Phase C でこそ効く規則である。

---

## 9. まとめ：何が判定に入り、何が入らないか

| | 判定に入るか |
| --- | --- |
| `judge_decisions` の Probability / Value / Strength | **入る**（これだけが判定） |
| `issues` / `argument_nodes` / `flow_links` の `confirmed` | 入る（判定の材料） |
| `rule_flags` の `confirmed` | 入る（除外の根拠） |
| **`effectiveness`** | **入らない**（説明のため） |
| **`comparison` の4軸** | **入らない**（説明のため。ただし Voting Issue の根拠にはなる） |
| **HP バー** | **入らない**（学習・観戦用の推定） |
| **熟練ジャッジ参照DB** | **入らない**（参照例） |
