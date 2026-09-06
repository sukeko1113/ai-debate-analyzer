# ARGUMENT_MODEL.md — 議論をどうモデル化するか

熟練ジャッジは、立論を一つの塊として見ていない。
**分解し、どこが攻撃され、どこが回復し、最後に何が残ったか**を追っている。
このファイルは、その思考過程をデータ構造にする方法を決める。
守備範囲は A/B/C ノードと Support Quality、やりとりの種別（`effect_kind`）と clash event、
Impact 比較の4軸、HP、役割優先UI（`BASIC_DESIGN_v09.md` 付録F）。

> **本アプリの価値は「AIが勝者を当てること」ではない。**
> 立論を A / B / C に分解する → Attackを当てる → Defenseを確認する → Rule State で採用可否を見る →
> 生き残った論点を見る → Impactを比較する → Summaryを評価する → 不確かなら止まる（Review Gate）→
> Voting Issueを決める。
> この過程を、音声・Flow・時刻付き根拠とともに見える形へ変えることにある。

本書は v09 §3.2・§9.5〜9.10・§10.3〜10.4 に追随している（2026-09-06）。
§1 の表・§2.1 / §2.2 の表・§5.1 の保存先は `packages/core/src/schema/flow.test.ts` が逐語で固定しているため、
P4.2 で Zod・テストと同時に書き換えた（`HANDOFF.md` 件41 e）。

---

## 1. 議論の構造：A / B / C ノード＋Support Quality

各 Issue（AD1 / AD2 / DA1 / DA2）を一塊にせず、**証明構造の3ノード**に分解する（v09 §3.2・§9.5）。
**Attack は必ず「どのノードを攻撃したか」を持つ。**

| `node_type` | 意味 | AFF Advantage | NEG Disadvantage | 典型的なAttack（`effect_kind`） |
| --- | --- | --- | --- | --- |
| `A_OBSERVATION` | 現状・前提（Present Situation / Inherency / Necessity / Uniqueness） | 現状の問題と、Plan なしでは解決しないこと | 現状は問題なく、Plan が状況を変えること | `not_true` / `not_unique` / `not_necessary` |
| `B_LINK`（`link_order` 1..n） | Plan から結果への因果（Effect / Link / Solvency / Process） | Plan が問題を解決する経路 | Plan が害を生む経路 | `no_link` / `no_solvency` / `alternative_solves` / `not_solvent` |
| `C_IMPACT` | 結果の重要性（Importance / Significance / Impact） | 解決される害の大きさ | 生じる害の大きさ | `not_important` / `value_turn` |
| `OTHER` | Plan の説明、進行、手続き等で A/B/C に該当しない | | | 原則採点対象外 |

Evidence / Warrant は**第4のノードではない**。A/B/C が成立する理由の質を表す
**Support Quality タグ**（`EVIDENCE` / `WARRANT` / `RELEVANCE` / `BURDEN`）として、
ノードの評価（`argument_node_scores.level` 0〜4）の理由に保存する。タグは式に直接入らない。
Judge Sheet の Probability との二重評価を避けるためである（v09 §3.2）。
ASR や記録欠損で証拠を確認できないときは level を下げず `evidence_status = 'unverifiable'` にする。

`link_order` を持つのは `B_LINK` だけ（Zod の refine と DB の CHECK）。
`P = chain_rule(A, B1..Bn)` の既定は `weakest_link`（`JUDGE_LOGIC.md` §1.1）。

**移行は不要だった。** flow テーブルは P11 で初めて作るため `role` を持つ行はどこにも無い。
`legacy_role` は作らず、`ArgumentRole`（5値）と `ATTACK_TARGET_ROLE` は P4.2 で `NodeType` へ一括で書き換えた。
v05 の `role` との対応は `present` → `A_OBSERVATION`、`effect` → `B_LINK`、`importance` → `C_IMPACT`、
`evidence` → Support Quality タグ（§1.1）、`other` → `OTHER`。

### 1.1 Support Quality タグと `evidence_refs` の違い

紛らわしいので明示する。v05 の `role='evidence'` ノードは v09 で無くなり、その内容は次の2つに分かれた。

| | 何か | 攻撃対象になるか |
| --- | --- | --- |
| Support Quality タグ（`argument_node_scores.support_tags`） | A/B/C ノードが**なぜそう言えるか**の質。`EVIDENCE`（出典のある具体的根拠）/ `WARRANT`（理由づけ）/ `RELEVANCE`（根拠と主張の関連）/ `BURDEN`（立証責任を果たしたか） | **なる**。`effect_kind = evidence_weak` / `logic_jump` の ATTACKS は対象ノードへ向かい、`clash_events.attack_type` は `EVIDENCE` / `RELEVANCE`（`BURDEN` は `effect_kind` に対応値が無く、AI が clash_events 側に直接立てる） |
| `evidence_refs` | 引用の**記録**（出典・年度・氏名・肩書） | ならない。CITES の先。条項 3.2.1 の必須要素の充足を判定するための記録 |

「その統計は2005年のもので古い」という攻撃は、その統計を根拠にしている A/B/C ノードに向かい、
Support Quality `EVIDENCE` への攻撃として記録する。
`evidence_refs` は、その引用が条項3.2.1の必須要素を満たしていたかを別に記録する。
`evidence_refs` は残る（`DATA_MODEL.md` §6）。無くなったのは**ノードとしての** evidence である。

---

## 2. やりとりの種別（`effect_kind`）と攻防の計算単位（`attack_type`）

`flow_links` に、そのやりとりが**何をしたのか**を細かく持たせる（`effect_kind`）。
一方、AI 参考判定が数値化する攻防の単位は `clash_events.attack_type`（8値）であり、
`effect_kind` から**多対一**に写す（§2.4）。二つの語彙を混ぜない（v09 §9.6）。

`effect_kind` は **20値**：ATTACKS 11値（§2.1）＋ DEFENDS 7値（§2.2）＋ ANSWERS 2値（§2.3）。
relation ごとに語彙が閉じ、ATTACKS / DEFENDS では必須、**ANSWERS では任意**、それ以外は null
（v09 §13.2 `FlowLink` の refine、`DATA_MODEL.md` §6 の CHECK）。

### 2.1 ATTACKS の種別

「主な対象」列は検出の手掛かりであり、これ以外のノードを攻撃できないという意味ではない
（`ATTACK_TARGET_NODE_TYPE`。v09 §13.2）。`SUPPORT` は `node_type` の値ではなく、
A/B/C ノードの Support Quality タグ（§1.1）へ向かう攻撃であることを示す。

| `effect_kind` | 意味 | 主な対象 `node_type` |
| --- | --- | --- |
| `not_true` | 現状認識が事実と違う | `A_OBSERVATION` |
| `not_unique` | Planがなくても同じことが起きる | `A_OBSERVATION` |
| `not_necessary` | Planがなくても Advantage は得られる | `A_OBSERVATION` |
| `no_link` | Planから結果への因果が成立しない | `B_LINK` |
| `no_solvency` | Planでは解決しない | `B_LINK` |
| `alternative_solves` | 既存の制度・別の手段で足りる（Plan を採らなくてよい） | `B_LINK` |
| `not_solvent` | 対象の大半が要件を満たさず、Plan の効果が届かない | `B_LINK` |
| `not_important` | 結果に客観的な価値がない | `C_IMPACT` |
| `value_turn` | 価値づけを逆転させる（良いこと→避けるべきこと） | `C_IMPACT` |
| `evidence_weak` | 根拠が不足／出典が弱い | `SUPPORT` |
| `logic_jump` | Claim と根拠の接続が飛んでいる | `SUPPORT` |

### 2.2 DEFENDS の種別

| `effect_kind` | 意味 |
| --- | --- |
| `re_evidence` | 新たな根拠で補強する（新規Attackではないこと） |
| `re_explain` | 説明し直す・誤読を正す |
| `counter_example` | 反例を示す |
| `mitigate` | 影響を限定する |
| `re_link` | 切られた因果を別経路でつなぎ直す |
| `concede` | 攻撃を認めたうえで、残りを守る |
| `alt_limited` | `alternative_solves` への再反論。代替手段の適用範囲が狭い |

Defense は `clash_events` 上では親 Attack を `parent_event_id` で参照し、`recovery_cat`
（Attack の核心に答えたか。論点ずらしは Minor 以下）を持つ（v09 §9.6）。

`value_turn` と Case flip の区別は大会ルール2.1.3の注記に従う。
価値だけを転倒する Value turn は許されるが、Case flip は立論での仕事である。
Case flip に相当する議論を Attack 以降で検出したら、`effect_kind` ではなく
`rule_flags` の `new_argument` 候補と Rule State `INADMISSIBLE_NEW_ADVANTAGE` / `INADMISSIBLE_NEW_DA` として扱う
（`JUDGE_LOGIC.md` §3.3。`RuleFlagType` に `case_flip` という値は無い）。

### 2.3 ANSWERS の種別（v07 で限定解禁）

| `effect_kind` | 意味 |
| --- | --- |
| `admits` | 質疑で相手の前提を認めた |
| `declines_to_answer` | 答えをずらした・答えなかった |

ANSWERS では `effect_kind` は**任意**。付いた場合、`clash_events` では `type = concession` / `clarification`、
`rule_state = NEEDS_CITATION` で記録し、後続スピーチで明示的に引用されたときだけ AI 参考 P/V へ反映する
（`scoring_config.qa_effect_mode = 'cited_only'` が既定。v09 §10.5）。

### 2.4 `clash_events.attack_type`（8値）と `effect_kind` の対応

`attack_type` は A/B/C と Support Quality に対応する。

- A：`NOT_NECESSARY` / `NOT_UNIQUE`
- B：`NO_EFFECT`（`attack_subtype` として `alternative_solves` / `not_solvent` を持てる）
- C：`NOT_IMPORTANT` / `VALUE_TURN`
- Support Quality：`EVIDENCE` / `RELEVANCE` / `BURDEN`

AI が clash event を提案するとき、対応する flow_link があればこの表で `attack_type` を決め、無ければ人が確認する。

| relation | `flow_links.effect_kind` | `clash_events.attack_type` | 主な対象 `node_type` |
| --- | --- | --- | --- |
| ATTACKS | `not_true` / `not_unique` / `not_necessary` | `NOT_UNIQUE`（`not_unique`）／ `NOT_NECESSARY`（`not_true`・`not_necessary`） | `A_OBSERVATION` |
| ATTACKS | `no_link` / `no_solvency` / `alternative_solves` / `not_solvent` | `NO_EFFECT`（サブタイプ：`no_solvency`・`not_solvent` → `not_solvent`、`alternative_solves` → `alternative_solves`） | `B_LINK` |
| ATTACKS | `not_important` | `NOT_IMPORTANT` | `C_IMPACT` |
| ATTACKS | `value_turn` | `VALUE_TURN`（`impact_direction = -1` を伴う） | `C_IMPACT` |
| ATTACKS | `evidence_weak` | `EVIDENCE` | 任意（Support Quality） |
| ATTACKS | `logic_jump` | `RELEVANCE` | 任意（Support Quality） |
| ATTACKS | （対応なし） | `BURDEN` | 任意（Support Quality）。`effect_kind` に対応値が無いので、AI は `clash_events` 側に直接立てる |
| DEFENDS | 7値すべて | （`attack_type` なし。`type = defense`、`parent_event_id` で親 Attack を参照し `recovery_cat` を持つ） | 親 Attack の対象 |
| ANSWERS | `admits` / `declines_to_answer` | （`attack_type` なし。`type = concession` / `clarification`、`rule_state = NEEDS_CITATION`） | — |

`not_true` と `not_necessary` を同じ `NOT_NECESSARY` に写すのは、どちらも「現状に問題が無い／Plan が無くても得られる」
という A への攻撃であり、L2 の数値計算では区別が要らないためである。Flow 上で区別を残すのは説明のためであり、判定のためではない。

---

## 3. やりとりの効果（`effectiveness`）— 人の説明メモ

`flow_links.effectiveness_*` は、そのやりとりが効いたかについての**人の説明メモ**である（v09 §9.6）。
v05 ではこれを「今回の追加で最も重要な部分」としていたが、v08 以降、AI 参考判定が数値化する攻防は
`clash_events`（§10）を正本にする。二つを混ぜない。

| 目的 | 正本 | 値 |
| --- | --- | --- |
| Flow 上で「何と何がつながるか」 | `flow_links` | ATTACKS / DEFENDS / COMPARES 等 |
| 説明用の効果コメント | `flow_links.effectiveness_ai` / `_human` | `strong` / `partial` / `none`（従来互換。**判定式には使わない**） |
| AI 参考判定の攻防計算 | `clash_events` | `claimed_effect_cat` / `support_cat` / `recovery_cat` / `rule_state` |

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
> **AI 参考判定（L1）も `effectiveness` を読まない。** AI の数値計算は `clash_events` ＋ `scoring_config`
> （ビュー `ai_scoring_inputs`）だけに限定する。これで「人の per-exchange 評価」と
> 「Issue 単位の human ballot」の二重権威を避ける（v09 §9.6「互換性の一線」）。

人間 Ballot の集計コードは `judge_flow_links` ビュー（`effect_kind` / `effectiveness_*` / `rationale_ai` を除いた列）
しか読めない。`flow_links` / `summary_links` への直接参照と `SELECT *` を CI で静的に検査する（`ACCEPTANCE.md` M22）。

---

## 4. Debate Evolution View

「AD1 が試合中にどう変化したか」は、**ビューとして導出する**。
導出元は `clash_events` と `argument_node_scores`（`snapshot_kind = 'event'`）である（v09 §9.7）。
v05 は `stage_no` の順序と `flow_links` だけから再構成するとしていたが、各イベント前後の P / V / HP を
追うには時点別の評価（snapshot）が要る。

```sql
CREATE VIEW debate_evolution AS
SELECT
  e.match_id, i.label AS issue,
  n.node_type, n.link_order,
  e.speech_no, s.start_ms AS at_ms,
  e.type AS event, e.attack_type, e.attack_subtype,
  e.claimed_effect_cat, e.support_cat, e.recovery_cat,
  e.rule_state,
  sc.level, sc.value AS node_value_after, sc.evidence_status,
  e.status AS human_review
FROM clash_events e
JOIN argument_nodes n        ON n.id = e.target_node_id
JOIN issues i                ON i.id = n.issue_id
LEFT JOIN argument_node_scores sc
       ON sc.node_id = n.id AND sc.snapshot_kind = 'event' AND sc.event_id = e.id
JOIN transcript_segments s   ON s.id = e.segment_ids[1]
ORDER BY i.label, e.speech_no, s.start_ms;
```

これで、次の時系列ログがそのまま出る。

| 時刻 | Stage | Issue / Node | Event | Rule State | AI category | P / HP 変化 | Human review |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 立論 | ① | AD1-B1 | construct | `ADMISSIBLE` | level 4 | P = .95 | confirmed |
| Attack | ⑤ | AD1-B1 | `NO_EFFECT` | `ADMISSIBLE` | Major × Adequate | HP 低下 | reviewed |
| Defense | ⑨ | AD1-B1 | recovery | `ADMISSIBLE` | Substantial | 一部回復 | confirmed |
| Summary | ⑪ | AD1 vs DA1 | comparison | `ADMISSIBLE_COMPARISON_MACRO` | — | node 値不変 | confirmed |

色分けは L3 で、青＝論点、赤＝Attack、緑＝Defense、灰＝不採用 / Drop、黄＝UNVERIFIABLE、紫＝Delivery。
各イベントから元 segment へ戻れる。

ここから「AD1 は B1 を大きく攻撃されたが Defense で一部回復し、
C は最後まで崩れなかったため、最終的に Strong 寄りで残った」
という説明を自動生成できる（`JUDGE_LOGIC.md` §6）。

**ビュー自身は行を持たない。** `clash_events` / `argument_node_scores` は版を持って追記する表であり
（`DATA_MODEL.md` §6.5）、Evolution View のためにそれらを二重に持たない。

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

> **【P4.2 で置換】** 以下の保存先は v05 の形で、`flow.test.ts` が「comparison を持てるのは COMPARES だけ」を固定している。
> v09 では `flow_links.comparison` を廃し、**`summary_links`**（`link_id` = COMPARES の flow_link、
> `own_issue_id` / `opponent_issue_id`、`source`、`axes: ComparisonAxis[]`、`review_status`）に持つ
> （`DATA_MODEL.md` §6、v09 §13.2 `SummaryLink`）。`SummaryLink.source` と `axes[].source` は一致させる。
> `FlowLink.comparison` から `SummaryLink` への書き換えは Zod と同時に行う。

`flow_links.comparison`（jsonb）に `ComparisonAxis[]` として保存する。
**比較を持てるのは `relation = 'COMPARES'` のリンクだけである。**
DB 側は `CHECK (comparison IS NULL OR relation = 'COMPARES')`（`DATA_MODEL.md` §6）、
アプリ側は `FlowLink` の refine で担保する。

`ComparisonAxis` 自体（4軸・`favors`・`rationale`・`source`・`segmentIds` と refine）は v09 でも変わらない。

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
 ├ A Observation : 残っている
 ├ B Link 1      : Attackで弱化 → Defenseで一部回復
 ├ C Impact      : Strong
 └ Support       : EVIDENCE 確認済み（verified）

NEG DA1 █████░░░░░
 └ Summaryで比較劣位
```

### 7.1 導出元

`HP = 10 × Strength`（L3 のみ。v09 §10.3）。`Strength = P × V` は L2 の内部数値であり、
`hp_ledger`（`hp_before` / `hp_after` / `delta` / `p` / `v` / `reason` / `scoring_config_version`。append-only）に
イベントごとの変化を記録する。`effectiveness` からは計算しない。
L2 の数値は AI が出したカテゴリをサーバが `scoring_config` で写したものなので、**HPバーはAI推定である**。

### 7.2 守る規則

- **画面に常に「AI推定」と表示する。** 公式の得点だと誤解させない。
- **確定した判定からHPを計算しない。** 逆に、**HPから判定を計算しない。**
  双方向とも禁止。human winner から HP を逆算しない。
- 判定の集計コードがHPモジュール（`schema/learning.ts`）を import していないことを、CIで静的に検査する
  （`ACCEPTANCE.md` M25）。`ai_scoring_inputs` ビューにも `hp_ledger` / `delivery_scores` は含めない。
- `hp_ledger` は `scoring_config_version` を持ち、どの写像で計算したかを残す（P17.6）。

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
| Attack/Defense評価 | どの反論が効いた・効かなかったか | `clash_events` の `claimed_effect_cat` / `recovery_cat` の参照例 |
| Comparison | 最終比較の軸と理由 | Summary支援・教材 |
| New Argument判断 | 新規議論と正当な比較の区別 | ルール検査の参照例 |
| Advice | 改善案・指導コメント | **判定理由とは別枠**で教材化 |

### 8.2 着手前に満たすべき前提（実装より先）

Phase C は、次がすべて揃うまで着手しない。

1. **大会映像・音声の権利者の確認**（主催者・学校・出場者）
2. **解説している熟練ジャッジ本人の許諾。** コメントは個人情報であり著作物でもある
3. **参照データとして使うことへの明示的な同意。**
   通常の録画許諾に「AIの参照データにする」は含まれない。
   `consent_scope` の5値の一つ `expert_reference`（値域は先に入れ、運用は Phase C。`PRIVACY_RETENTION.md` §2）を
   選んだ試合だけが対象になる
4. 保持レベル A〜C がフルに関わるため、`PRIVACY_RETENTION.md` の期限設定を先に決める

### 8.3 「正解」にしない

> 熟練者のコメントは**唯一の正解として固定しない**。熟練ジャッジの判断例・参照データとして扱う。
> 複数ジャッジで見解が分かれる試合は、**その差も保存する**。教育価値はむしろそちらにある。

正解らしきものが手に入ると、Winner一致率を上げたくなる。
`ACCEPTANCE.md` §3.1 の「Winner一致率を上げるためにプロンプトを調整しない」は、
Phase C でこそ効く規則である。

---

## 9. まとめ：何が判定に入り、何が入らないか

判定支援は三層（L1 AI Decision Support / L2 Internal Analysis / L3 Learning）と人間 Ballot に分かれる
（v09 §3.6・§10.1）。「判定」は人間 Ballot だけを指し、AI 参考判定は判定ではない。

| | AI 参考判定（L1）の計算に入るか | 人間 Ballot（判定）に入るか |
| --- | --- | --- |
| `judge_decisions` / `judge_issue_assessments_human` の Probability / Value / Strength | 入らない（AI は読まない） | **入る**（これだけが判定） |
| `issues` / `argument_nodes` の `confirmed` な A/B/C | 入る（`ai_scoring_inputs`） | 入る（判定の材料。`judge_flow_links` 経由） |
| `flow_links` の `confirmed`（relation だけ） | 入らない（`clash_events` が正本） | 入る（判定の材料。`judge_flow_links` 経由） |
| `clash_events`（`rule_state` が `ADMISSIBLE*` のもの） | **入る**（攻防計算の正本） | 入らない |
| `argument_node_scores` / `issue_snapshots` / `scoring_config` | **入る** | 入らない |
| `rule_flags` の `confirmed` | 入る（Rule State と連動） | 入る（除外の根拠） |
| `official_decision_support` | これが L1 の出力。**名前に official を含むが AI 側** | 入らない（参考表示のみ。自動コピーしない） |
| **`effectiveness`** / `effect_kind` / `rationale_ai` | **入らない**（説明のため） | **入らない**（説明のため） |
| **`summary_links` の4軸** | 入らない | **入らない**（説明のため。ただし Voting Issue の根拠にはなる） |
| **HP（`hp_ledger`）** / `delivery_scores` | **入らない**（L3） | **入らない**（学習・観戦用の推定） |
| **熟練ジャッジ参照DB** | 入らない | **入らない**（参照例） |

AI Decision Support の計算はビュー `ai_scoring_inputs` だけを読む。含めてよいのは confirmed な A/B/C 構造、
admissible な clash event、node score snapshot、Impact、`scoring_config` のみ。`delivery_scores` と HP は含めない。
人間 Ballot の集計モジュールは `judge_decisions` だけを読み、AI Decision Support の内部値を読まない（v09 §12.6）。

---

## 10. Clash Event と Clash View（v08 評価エンジン）

### 10.1 `clash_events`

AI 参考判定が攻防を数値化する単位は `clash_events` であり、`flow_links` ではない（§3）。
「いつ誰がどう攻撃・防御したか」を時間順に持つ台帳で、版を持って追記する（`DATA_MODEL.md` §6.5）。

| 項目 | 内容 |
| --- | --- |
| `type` | `attack` / `defense` / `concession` / `clarification` / `comparison` / `value_turn` / `extension`（7値） |
| 対象 | `target_node_id`（原則必須）。論点全体攻撃だけは `target_argument_ids` で許し、人間確認を促す |
| `attack_type` / `attack_subtype` | §2.4 の8値。`attack_subtype` は `NO_EFFECT` のときだけ |
| `claimed_effect_cat` | `none` / `minor` / `moderate` / `major` / `decisive`（初期数値 0 / .25 / .50 / .75 / 1.0） |
| `support_cat` | `unsupported` / `weak` / `adequate` / `strong`（.30 / .50 / .75 / 1.0） |
| `recovery_cat` | `none` / `minor` / `partial` / `substantial` / `full`（0 / .25 / .50 / .75 / 1.0）。Defense が持つ |
| `parent_event_id` | Defense が参照する親 Attack。必須 |
| `rule_state` | 16値（`JUDGE_LOGIC.md` §3.3）。サーバが `rule_state_table` から決める |
| `status` | `suggested` / `reviewed` / `confirmed` / `excluded`。`POST /clash-events/{id}/review` だけが書く |

計算（v09 §10.4）：Attack の内部ダメージは `r = claimed_effect × support`、ノード値は `p × (1 − r)`。
Defense は親 Attack に対する `g`（recovery）を使い `r' = r × (1 − g)` で再計算する。
**AI はカテゴリと根拠と confidence を出し、小数演算はサーバだけが行う**（`scoring_config` で版管理）。
この数値は AI 参考判定の内部モデルであり、人間 Ballot へ直接コピーしない。

Zod（v09 §13.4 `ClashEvent`）の不変条件：`type = attack` なら `attack_type` / `claimed_effect_cat` / `support_cat` 必須、
`type = defense` なら `parent_event_id` / `recovery_cat` 必須、`attack_subtype` は `NO_EFFECT` のみ、対象（node か argument）が要る。

### 10.2 Clash View

主要 Issue ごとに Constructive → Attack → Defense → Summary を横断して「結局どうなったか」を見せる（v09 §9.10）。

- 通常表示：双方の Claim、主要 Attack、Defense、最終 P / V / Strength カテゴリ
- 研修表示：`constructive_end` 値、`final` 値、`clash_leverage`、`winner_flip`（`JUDGE_LOGIC.md` §11）
- Review Gate：Value turn、Late Repair 境界、UNVERIFIABLE があれば理由コードを表示
- Human Ballot と AI Decision Support を左右に並べ、同じ Issue をどう見たか比較できる

**Clash View 自体が human winner を計算することはない。** AI 側の数値は Decision Support の説明として、
常に「AI参考判定」の表記付きで表示する。
