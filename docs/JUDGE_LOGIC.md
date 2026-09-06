# JUDGE_LOGIC.md — 判定支援とサーバ権威

Decision Chart とサーバ権威、L1（AI 参考判定）と L2（内部計算）の書き分け、ロック不変条件。
本書は v09 §3.6・§10・§11・§12.3・§12.6・§15.0 に追随している（2026-09-06）。
Zod の形は v09 §13.3（judge）・§13.4（scoring / decision-support）を正とする。

## 0. このアプリが判定に対してすること・しないこと

| する | しない |
| --- | --- |
| 公式Decision Making Chartの各欄に**候補**を出す | 勝敗を決める |
| 候補の根拠として、時刻付きの発言を示す | 候補を確定として保存する |
| ルール違反の**候補**を提示する | 違反を自動で判定から除外する |
| 集計（AD合計 vs DA合計）をサーバで計算する | 独自の点数体系を作る |
| 判定理由のドラフトを書く | ドラフトを最終文書として確定する |
| 判定支援を三層（L1 / L2 / L3）と人間 Ballot に分けて持つ（§9） | AI が `judge_decisions` / `judge_issue_assessments_human` を書く |
| 不確かなときは断定せず `REVIEW_REQUIRED` を返す（§13） | `REVIEW_REQUIRED` をエラーや未判定として扱う |

---

## 1. Decision Making Chart

公式Judge Sheetの構造をそのまま中心に置く。第3列は AI Decision Support（L1）が出す候補であり、
画面では常に「AI参考判定」と表示する（v09 §10.2）。

| 欄 | 公式表現 | AI Decision Support の支援 |
| --- | --- | --- |
| 1. List of issues | AD1 / AD2 / DA1 / DA2（各側最大2） | 最大2件を同定。3つ目以降は `INADMISSIBLE_EXTRA_ISSUE`（Rule State）と `extra_issue`（RuleFlag）の候補 |
| 2. Probability | `Hi` / `Lo` | L2 から数値 P とカテゴリ候補を出す（A/B の立証と Attack 後の残存） |
| 3. Value (Impact) | `Large` / `Small` | Impact（C）ノードから数値 V とカテゴリ候補を出す |
| 4. Strength | `Strong` / `Weak` / `None` | L2 で **P × V** を計算しカテゴリ候補へ写像。**人が確定** |
| 5. Compare | AD合計 と DA合計 | AI 参考の AFF/NEG 合計、margin、`winner_suggestion`。人間 Ballot は AFF勝ち: AD1+AD2 > DA1+DA2 / NEG勝ち: DA1+DA2 ≧ AD1+AD2 |
| 6. Voting Issue | ラベル1つ | `survival_candidate` / `clash_candidate` / confidence と根拠時刻（§11） |
| New Argument check | Yes / No | Rule State で採用可能イベントだけが寄与しているか再検査（§3.3） |
| Communication | 1〜5の整数 | **勝敗とは別枠**。音声由来の暫定提案。映像・マナーは人が確認（§7） |
| Best Debater | 1名 | **候補を出さない。人が入力する** |

### 1.1 数値へ置換しない — L1 の公式表示と人間 Ballot に対する規則

`Hi/Lo`・`Large/Small`・`Strong/Weak/None` を0〜100点に変換しない。
この規則の適用先は **L1 の公式表示と人間 Ballot** である（v09 §10.3 の書き分け）。

1. 人間が確定する `judge_decisions` / `judge_issue_assessments_human` は、Hi/Lo・Large/Small・Strong/Weak/None の
   語彙だけを持つ。比較演算が要る場合も `STRENGTH_ORDER = ['None', 'Weak', 'Strong']`（`schema/judge.ts`）の
   順序関係だけを使い、差の大きさを数値化しない。
2. **L2 の内部数値は存在する。** AI Decision Support の再現可能な計算と校正のためである。
   - A/B ノードの level 0〜4 を `scoring_config.node_map` で数値へ写す（初期値 4→.95 / 3→.80 / 2→.60 / 1→.30 / 0→.05）
   - `P = chain_rule(A, B1..Bn)`。既定は `weakest_link = min(...)`、代替は `product`（Phase 2 で比較）
   - `V = Impact C の magnitude`（0〜1）
   - `Strength = P × V`。閾値は P ≥ .50 → Hi、V ≥ .50 → Large、Strength ≥ .40 → Strong、.10〜.40 → Weak、< .10 → None
   - 閾値は**校正対象**であり、公式規則そのものとは記載しない
3. L2 の数値の保存先は `official_decision_support` と `argument_node_scores` **だけ**である。
   この数値を人間 Ballot の列へ写す経路は作らない。AI 値を人間 Ballot へ一括コピーする機能も作らない（v09 §12.3）。
4. **AI はカテゴリと根拠と confidence を出し、数値写像はサーバが `scoring_config` で行う。** LLM に小数を出させない。
5. 両者を同じ画面に並べるときは、L2 側に常に「AI参考判定」と表示する（§10、v09 §15.0）。

「砂山」「HP」「残存率」のような可視化は、**学習・観戦用（L3）の補助表示としてのみ**使い、
公式Judge Sheetの判定ロジックと混ぜない（`HP = 10 × Strength`。`ARGUMENT_MODEL.md` §7）。

### 1.2 引き分けは存在しない

- `winner` は `AFF` か `NEG` の二択。スキーマで引き分けを表現できないようにする。
  型でも表現できない（`schema/judge.test-d.ts` が `@ts-expect-error` で検査し、型が緩むと typecheck が落ちる）。
- どう検証しても優劣がつけられない例外的な場合のみ、推定により**否定側の勝ち**。
- この既定値をAIに自動適用させない。**人が「優劣がつけられない」と判断したときだけ**提示する。
- AI 参考判定の `winner_suggestion` は `AFF` / `NEG` / `REVIEW_REQUIRED` の3値で、
  `REVIEW_REQUIRED` は引き分けではなく「人の確認が要る」である（§13）。

---

## 2. サーバ権威の原則

判定に関わる状態を、AIやクライアントが直接書けるようにしてはならない（v09 §10.12）。

| 対象 | 原則 | 理由 |
| --- | --- | --- |
| Issue key（AD1等）、node id | **サーバが割り当てる。AIに生成させない** | AI生成のキーは重複・揺れが起き、履歴の同一性が壊れる |
| `confirmed` / `excluded` | **サーバのAPI（`/review`）だけが書ける** | クライアント直書きを許すと改竄経路になる |
| AD合計とDA合計の比較、Net sum、counterfactual、Review Gate | **サーバで計算する。AIはカテゴリと根拠だけを出す** | 判定の再現性を保つ。同入力・同 `scoring_config` で差分ゼロ |
| Rule State、カテゴリ→数値写像 | **サーバが `rule_state_table` と `scoring_config` から決定する** | AI に小数や採用可否を出させると再現できない |
| AIの出力 | **必ず `suggested` 層に入る。`official_decision_support` も AI 側の表である** | AIが確定状態を作れないことを構造で保証する |
| ruleset版・モデル版・prompt版・scoring_config版 | **実行時にサーバが記録する**（`flow_runs` / `judge_runs` / `official_decision_support`） | どのルール・モデル・写像で作られた判定かを後から追える |
| 人間 Ballot | **別API・別権限**（`DATA_MODEL.md` §11）。AI worker のロール（`app_ai_worker`。**仮置き**、P12.4 で確定）から INSERT / UPDATE できない | AI参考判定と公式判定を構造で分ける |

### 2.1 実装での担保

```ts
// 悪い例：LLMの出力をそのまま保存する
const issues = await llm.extractIssues(transcript);
await db.insert("issues", issues);          // ← id も review_status も AI 任せ

// 良い例：サーバが id と状態を決める
const drafts = await llm.extractIssues(transcript);   // 返るのは title と根拠のみ
for (const [i, d] of drafts.entries()) {
  await db.insert("issues", {
    id: crypto.randomUUID(),                 // サーバ割当
    label: assignLabel(d.side, i),           // サーバ割当（AD1/AD2/DA1/DA2）
    title: d.title,
    review_status: "suggested",              // 常に suggested
  });
}
```

**LLMの応答スキーマに `id` / `label` / `review_status` を含めない。**
含めると、いつか誰かがそのまま保存する。

---

## 3. ルール違反フラグの扱い

`HENDA_RULESET.md` §3 の **15種**（P1 の9種＋v07 の5種＋`dropped`）すべてに共通する規則。
`status` の3値（`candidate` / `confirmed` / `rejected`）は `review_status` とは**別語彙**である。

1. AIは `status = 'candidate'` でしか作れない。
2. `candidate` のフラグは**判定に一切影響しない**（集計から除外しない）。
3. 人が `confirmed` にして初めて、対象ノードが `excluded` へ遷移できる。
4. `rejected` にしたフラグも削除しない。「なぜ除外しなかったか」も記録に残す。
5. フラグの `rationale` には、**根拠となる発言の時刻**を必ず含める。
6. `candidate` が残ったままでは判定をロックできない（§5 条件6）。

### 3.1 New Argument の説明文に書くこと

- どのステージで初出したか
- 過去のどのステージにも見当たらないこと（探した範囲を明示する）
- **例外の可能性**（否定立論③にアタック相当が含まれていた場合は、⑦での反論が許される等）

「新しい議論です」と断定しない。「初出に見えます。次を確認してください」と書く。

⑦肯定アタックで直前の否定アタック⑤へ再反論するのは `INADMISSIBLE_PREMATURE_REBUTTAL` 候補だが、
**否定立論③にアタックに該当する議論が含まれていた場合は例外的に許される**（`HENDA_RULESET.md` §3.2、Gold Dataset の罠 T2）。
Rule State Engine（§3.3）は⑦のイベントが③のノードを target にしているかを見て、③由来なら `ADMISSIBLE` とする。
規則表では `speech_no = 7, event_type = 'attack', condition = 'target.stage_no = 3', rule_ref = '4.2.2'` の1行。
判別できないときは `INADMISSIBLE_PREMATURE_REBUTTAL` 候補にしたうえで、理由文にこの例外の可能性を書き添える。

### 3.2 Rule State と RuleFlag の関係

Rule State は **clash event 単位の採用可否**、RuleFlag は**発言・ステージ単位の注意喚起**であり、粒度が違う（v09 §10.5）。

- `INADMISSIBLE_*` の Rule State を立てるとき、対応する RuleFlag
  （`new_argument` / `premature_rebuttal` / `extra_issue` / `over_time`）も `candidate` で立てる。
- 人が RuleFlag を `rejected` にしたら、対応する Rule State は `ADMISSIBLE` へ再判定する（`POST /matches/{id}/rule-state/rebuild`）。
- **どちらも自動で判定から除外しない。** 大会ルール 4.2.2 は「新しい議論かどうかの判断はジャッジが行う」と明記している。

### 3.3 Rule State Engine

v07 の New Argument detector を、v08 で Rule State Engine へ拡張した。
**`speech_no × event_type × condition → rule_state` をサーバが `rule_state_table` から決定する。**
AI には event_type・target・理由・confidence を出させ、採用可否は出させない。

`rule_state` は **16値**（v09 §13.4 `RuleState`。prose の一覧は `INADMISSIBLE_NEW_*` を1行にまとめているが enum は3値）：

| 値 | 意味 |
| --- | --- |
| `ADMISSIBLE` | 採用可能 |
| `ADMISSIBLE_REEMPHASIS` | 既出論点の再強調（EXTENDS） |
| `ADMISSIBLE_COMPARISON_MICRO` | Issue 内の比較 |
| `ADMISSIBLE_COMPARISON_MACRO` | AD 群と DA 群の比較 |
| `ADMISSIBLE_NEW_EVIDENCE_FOR_COMPARISON` | Summary の新 Evidence。比較説明と Voting Issue の理由づけには使えるが、**A/B/C のノード値を上げない** |
| `NEEDS_CITATION` | 質疑の Concession / Clarification。後続スピーチで明示的に引用されたときだけ P/V へ反映（`qa_effect_mode = cited_only`） |
| `INADMISSIBLE_NEW_ADVANTAGE` / `INADMISSIBLE_NEW_DA` / `INADMISSIBLE_NEW_PLAN` | 立論以外での新 AD / DA / Plan（条項 4.2.2） |
| `INADMISSIBLE_NEW_ATTACK` | Summary での新 Attack |
| `INADMISSIBLE_PREMATURE_REBUTTAL` | ⑦での⑤への再反論（③由来の例外あり。§3.1） |
| `INADMISSIBLE_EXTRA_ISSUE` | 片側3件目以降の Issue |
| `INADMISSIBLE_OVERTIME` | 時間超過後の発言 |
| `INADMISSIBLE_LATE_REPAIR` | 立論または Defense で欠けていた A/B/C を Summary の Evidence で初めて成立させた |
| `DROPPED` | 応答されなかった |
| `UNVERIFIABLE` | 記録・聞き取りの事情で確認できない（`evidence_status` と対応） |

`INADMISSIBLE_*` と `UNVERIFIABLE` のイベントは `ai_scoring_inputs` に入らず、AI 参考判定の Net sum に寄与しない。
`UNVERIFIABLE` が margin を変え得るなら `REVIEW_REQUIRED`（§13）。
Rule State はイベント生成時の ruleset 版（`rule_state_ruleset_version`）とともに保存し、
後のルール更新で過去試合の判定理由が変わらないようにする（v09 §12.2）。

---

## 4. FlowLink の relation と方向

| relation | 意味 | from kind | to kind |
| --- | --- | --- | --- |
| `ATTACKS` | 相手の証明要素を攻撃する | `ATTACK` | `CLAIM` |
| `DEFENDS` | 自陣への攻撃に再反論する | `DEFENSE` | `ATTACK` |
| `EXTENDS` | 既出の論点を維持・強調する | `DEFENSE` / `SUMMARY_POINT` | `CLAIM` |
| `COMPARES` | AD群とDA群を比較する | `SUMMARY_POINT` | `CLAIM`（Issue単位） |
| `QUESTIONS` | 質疑で確認・検証する | `QUESTION` | `CLAIM` / `ATTACK` |
| `ANSWERS` | 質疑に応答する | `ANSWER` | `QUESTION` |
| `CITES` | 証拠を参照する | 任意 | `evidence_refs` |
| `DROPS` | 反論も応答もされないまま残った（システム導出） | 応答されなかった `CLAIM` / `ATTACK` | **応答義務のあった相手ステージの先頭ノード** |

`DROPS` の方向を明記した理由（v09 §9.3）：方向が定まらないと `INVALID_LINK_DIRECTION` 422 のテストが書けない。

各リンクは、**何をしたのか**（`effect_kind`。20値。relation ごとに語彙が閉じ、ANSWERS では任意）と、
人の説明メモとしての**効いたのか**（`effectiveness`）も持つ。
種別の語彙は `ARGUMENT_MODEL.md` §2。効果評価が判定に入らない理由は同 §3。
**AI 参考判定が数値化する攻防は `flow_links` ではなく `clash_events` が正本である**（同 §10）。

**方向違反はDBのCHECKまたはAPIバリデーションで弾く。**
`ATTACK → ATTACK`（アタックへのアタック）は原則存在しない。
それらしいリンクが出たら、Defense の取り違えを疑う。

### 4.1 `DROPS` の導出

Dropped が成立するのは、**応答機会があり、記録が揃っていて、Defense で応答しなかった**場合だけである（v09 §3.3）。

- 対象ノードに、後続ステージからの `ATTACKS` も `QUESTIONS` も付いていない
- かつ、相手側のSummaryでも触れられていない

導出は自動でよいが、**`suggested` で出す**。人が確認して `confirmed` にする。

次の場合は DROPS を**導出しない**（v09 §9.3）。

| 状況 | 代わりに立てるもの | 理由 |
| --- | --- | --- |
| 相手ステージにノードが1つも無い | `rule_flags.dropped` | to になる先頭ノードが無く、リンクを作れない |
| 対象区間に `audibility = unheard` がある | `rule_flags.audibility_gap` | 「聞き取れなかった」を「応答しなかった」として記録すると、大会ルールの趣旨に反した判定材料が生まれる |
| 応答義務のあったステージの `coverage_status ≠ complete` | `rule_flags.stage_coverage_gap` | 実試合で⑩と⑪の本文が丸ごと失われていた。この状態で導出すると、否定側が DA を全放棄し肯定側が総括をしなかったという記録が機械的に生成される |

> **三つを混ぜない。** 「応答しなかった（DROPS）」「聞き取れなかった（`audibility_gap`）」「記録が無い（`stage_coverage_gap`）」は、
> いずれも画面上は同じ空白に見える。空白の理由が違えば、判定でできることも違う。
> **DROPS だけが判定材料になり、他の二つは判定材料にならない。** 復旧の手段も違う
> （記録が無い→音声の入れ直し、聞き取れなかった→聞き直し）。

---

## 5. ロック不変条件（v04で追加）

`judge_decisions.locked_at` を立てられるのは、次をすべて満たすときだけ（v09 §10.11 の8条件）。
**API（`POST /api/v1/judge/ballots/{id}/lock`）とDBトリガの両方で検査する。**

1. `winner` / `voting_issue` / `comm_aff` / `comm_neg` / `reason` / `reason_grounds` が埋まっている
2. `voting_issue` に対応する `issues.review_status = 'confirmed'`
3. **判定根拠として引用された全 segment の `audibility` が `clear` / `partial` に人間確定されている。`unknown` も `unheard` も不可**
   （v05 は `unheard` を許す書き方になっていた。`unheard` の区間は Judge View に本文が無く、根拠にできない）
4. 引用された segment が属するステージの `coverage_status = 'complete'`（欠損ステージの引用不可）
5. 引用された segment の `stage_no IS NOT NULL`（自己紹介・アナウンスを根拠にしない）
6. `rule_flags` に `status = 'candidate'` が残っていない
7. `rule_state` が `INADMISSIBLE_*` の `clash_events` を、判定理由の段落（`reason_grounds[].segment_ids`）が根拠参照していない
   （明示的 override を作る場合は理由必須。P15）
8. `Strength = None` の Issue に `residual_note`（残存リスクの記述）がある。「無視できる」で終わらせない

| 条件 | 応答 |
| --- | --- |
| 3（`unknown` が残る） | `409 AUDIBILITY_UNRESOLVED`、`details.pendingSegmentIds` |
| 3（`unheard` を含む） | `409 UNHEARD_CITED`、`details.unheardSegmentIds` |
| 4 | `409 GAPPED_STAGE_CITED`、`details.gappedStageNos` と `segmentIds` |
| 5 | `422 NON_STAGE_SEGMENT_CITED`、`details.segmentIds` |
| 8 | `VALIDATION_FAILED`（Zod の refine）と DB の CHECK |

いずれも該当 id を `details` に返し、UI はそこへ直接ジャンプする。

**AI の `REVIEW_REQUIRED` は人間 Ballot のロックを機械的に禁止しない。** 人が内容を確認し、独立に判定できるためである。
ただし UI は Review Gate の未確認を目立たせる（§13）。

### 5.1 「判定根拠として引用された segment」の定義

上の条件のうち 3〜5 は、すべて「判定根拠として引用された segment」の集合に対する検査である。
この集合は、**確定した Issue から確定した ArgumentNode を辿った `node_segments`** と、
**人の Decision Chart（`judge_issue_assessments_human.segment_ids`）** の和集合と定義する（v09 改訂履歴 6）。
定義はビュー `judge_cited_segments` として1箇所に持ち、API と DB トリガが同じビューを参照する。

```sql
CREATE VIEW judge_cited_segments AS
SELECT DISTINCT jd.id AS judge_decision_id, ns.segment_id
FROM judge_decisions jd
JOIN issues i         ON i.match_id  = jd.match_id AND i.review_status = 'confirmed'
JOIN argument_nodes n ON n.issue_id  = i.id        AND n.review_status = 'confirmed'
JOIN node_segments ns ON ns.node_id  = n.id
UNION
SELECT a.judge_decision_id, unnest(a.segment_ids)
FROM judge_issue_assessments_human a;
```

### 5.2 なぜ 3〜5 が要るのか

`audibility = unknown` は「**まだ人が聞いていない**」を意味する。
これを許すと、**AIの文字起こしを人間が聞いたものとして判定に使ってしまう**。
本設計が最も避けたい事故が、ちょうどここで起きる。

- 未確定が残る場合は `409 AUDIBILITY_UNRESOLVED`。
  `details.pendingSegmentIds` を返し、UIはそこへ直接ジャンプする。
- **Judge Viewで `unknown` の本文を隠さない。** 隠すとレビュー前は何も読めなくなる。
  「未確認」と明示して見せ、ロックで止める。

`unheard`・`coverage_status`・`stage_no IS NULL` も同じ理屈である。大会ルールは、聞き取れなかった箇所を
試合後に原稿で補って判定してはならないとしている。「ジャッジが実際に得た情報」の外にあるもの
（聞き取れなかった区間、記録の無いステージ、競技の外側の発話）を判定材料にしないための線が 3〜5 である。

---

## 6. 判定理由のドラフト生成

### 6.1 根拠の必須化

- **解説の各段落は、最低1つの `transcript_segment_id` を参照する。**
- 参照のない主張文は生成しない。生成された場合はCIで検出して落とす。
- Judge Viewに存在しない内容（`audibility = unheard`）を根拠にした段落には、その旨を明示する。

### 6.2 判定理由とアドバイスを分ける

| 判定理由 | アドバイス |
| --- | --- |
| 試合内で実際に出た議論だけから作る | 「こう言えばもっと強かった」を書いてよい |
| 出力先: `04_判定理由メモ` | 出力先: `05_試合解説レポート` の指導コメント欄 |

混ぜない。埼玉いなほカップ掲載のジャッジ基準が、
判定理由とアドバイスを区別して試合後に述べるとしているのに対応する。

AI と人間で結論が異なる場合、どちらかへ丸めず**並記**する。AI が `REVIEW_REQUIRED` なら
「未判定」ではなく「AI参考判定は要確認」と記す（v09 §11.1）。

### 6.2.1 判定理由の根拠種別（`reason_grounds`。v07 で追加）

判定理由メモの各段落に、何に基づいて書かれた段落かを持たせる。実試合で、審査委員長の講評と
客観的な判定理由が、同じ結論を別の根拠で説明していたためである（v09 §11.2）。

| `ground` | 内容 | 判定の理由として使えるか |
| --- | --- | --- |
| `content` | 議論の内容。主張・因果・根拠・残存 | 使える |
| `comparison` | 比較秤量。AD と DA をどの軸で比べたか | 使える |
| `procedure` | ルール適用。New Argument、担当者違反、時間超過 | 使える |
| `delivery` | 伝達。声量・速度・表現力・共感 | Communication 欄でのみ使う。内容判定の理由に使うと `communication_in_content` が **candidate** で立つ。自動で消さない |
| `advice` | 指導コメント。こう言えばもっと強かった | 判定理由に入れない。Advice 欄へ分ける |

種別は段落の属性であって、文の禁止ではない。「否定側の説明が速すぎて論点の対応が追えなかった」は `delivery` であり、
Communication の減点事由としては正当である。それを「したがって DA1 は成立しなかった」の理由に接続したときに、初めてフラグが立つ。

Zod（v09 §13.3）：`ReasonParagraph = { text, ground, segmentIds（1件以上）}`、
`JudgeDecision.reasonGrounds` は1件以上、`compareNote`（残ったもの／削られたもの）と `isChief`（審査委員長のバロットか）を持つ。

### 6.3 プロンプトの中立性

- 「どちらが勝ちそうか」を先に問わない。**先にDecision Chartを埋めさせ、その結果として勝敗を導く。**
- AFF / NEG のどちらに投票しても不利にならないことをプロンプトに明記する。
- **受け入れテストでは、同じ試合の AFF / NEG を入れ替えた入力で、判定が対称に反転することを確認する。**
  片側に偏るなら、プロンプトかスキーマに偏りがある。

---

## 7. Communication Points

- **勝敗の計算に一切入れない。** 別テーブル・別UI・別出力欄。
- 1〜5の整数のみ。`CHECK (comm_aff BETWEEN 1 AND 5)`。
- 発音・訛りそのものを理由にしない。扱うのは「聞き取れた／聞き取れなかった」という結果のみ。
- AI が音声から観測できるのは聞き取りやすさ・速度・間・無応答などに限る（`comm_points_suggested`。音声由来の暫定案、null 可）。
  減点事由（試合態度、質疑のマナー、証拠閲覧への非協力）は**人が入力する**。AIは減点事由を提案しない。
- 速度（150 wpm）と語数（600語）は候補フラグとして出すが、**自動減点しない**。

### 7.1 話者別 Delivery（L3）

学習用の話者別 Delivery は別テーブル `delivery_scores` に保存する（v09 §10.9。P16 / P17.6）。

| 指標 | 尺度 |
| --- | --- |
| Fluency | 1〜5 |
| Intelligibility | 1〜5 |
| Clarity / Organization | 1〜5 |
| Delivery Persuasiveness | 1〜5 |
| `wpm` / `word_count` | 実測 |

**これらを L1 の P / V / Strength へ入れない。** `ai_scoring_inputs` にも含めない。
判定理由の `delivery` 段落が Voting Issue / Strength の理由へ使われていれば
`communication_in_content` を candidate で立てて警告する（§6.2.1、`HENDA_RULESET.md` §7.1）。自動で除外しない。

---

## 8. ロック後の扱い

- `locked_at` が入った `judge_decisions` は、以後変更できない（`409 DECISION_LOCKED`）。
- 変更が必要な場合は、**新しい `judge_decisions` を作る**。古い行は消さない。
- エクスポートは `locked` 済みの判定からのみ行う。下書きからは出力しない。
- 同じ `judge_decision_id` ＋ 同じ `template_version` ＋ 同じ `decision_support_id` からは、何度でも同じ生成物が出る（G7）。
  `export_runs` はどの human ballot / decision support / template version から作ったかを保持する（v09 §12.4）。

---

## 9. 判定に入るもの・入らないもの（三層と人間 Ballot）

判定支援は三層に分かれ、混ぜない（v09 §3.6・§10.1）。

| 層 | 保存対象 | 公式判定との関係 |
| --- | --- | --- |
| L1 AI Decision Support | 内部 P/V/Strength、カテゴリ、Net sum、Voting Issue 候補、Review Gate（`official_decision_support`） | HEnDA 語彙で参考判定を提示するが、人間バロットではない。画面では常に「AI参考判定」 |
| L2 Internal Analysis | ノード採点、Support Quality、clash events、Rule State、snapshot（`argument_node_scores` / `clash_events` / `issue_snapshots` / `scoring_config`） | L1 と L3 の根拠。監査用 |
| L3 Learning | HP、色分け、delivery（`hp_ledger` / `delivery_scores`） | 公式判定へ逆流させない |
| Human Ballot | 人が確定した Hi/Lo、Large/Small、Strong/Weak/None、Winner、Voting Issue、Communication（`judge_decisions` / `judge_issue_assessments_human`） | 大会・研修での最終記録 |

> **不変条件** AI が `judge_decisions` または `judge_issue_assessments_human` を直接確定しない。AI は `suggested` 系テーブルだけを書く。
> AI Decision Support の計算はビュー `ai_scoring_inputs`（confirmed な A/B/C、admissible な clash event、node score snapshot、
> Impact、`scoring_config`）だけを読む。人間 Ballot の集計モジュールは `judge_decisions` だけを読み、AI の内部値を読まない（v09 §12.6）。

| | AI 参考判定（L1）の計算に入るか | 人間 Ballot（判定）に入るか |
| --- | --- | --- |
| `judge_decisions` / `judge_issue_assessments_human` の Probability / Value / Strength | 入らない（AI は読まない） | **入る**（これだけが判定） |
| `issues` / `argument_nodes` の `confirmed` な A/B/C | 入る | 入る（判定の材料。`judge_flow_links` 経由） |
| `flow_links` の `confirmed`（relation だけ） | 入らない（`clash_events` が正本） | 入る（判定の材料） |
| `clash_events`（`ADMISSIBLE*`） / `argument_node_scores` / `issue_snapshots` | **入る** | 入らない |
| `rule_flags` の `confirmed` | 入る（Rule State と連動） | 入る（除外の根拠） |
| `official_decision_support` | これが L1 の出力。**AI 参考であって判定ではない** | 入らない（参考表示のみ） |
| **`flow_links.effectiveness`** | **入らない** | **入らない**（説明のため） |
| **`summary_links` の4軸** | 入らない | **入らない**（説明のため。Voting Issue の根拠にはなる） |
| **HP** / `delivery_scores` | **入らない**（L3） | **入らない**（学習・観戦用のAI推定） |
| **熟練ジャッジ参照DB** | 入らない | **入らない**（参照例であって正解ではない） |

下4つは、判定の集計コードから参照してはならない。CIで静的に検査する（`ACCEPTANCE.md` M22・M25・M61）。
詳細は `ARGUMENT_MODEL.md` §9。

---

## 10. 出力する2種類のJudge Sheet と評価ビュー

| 版 | 内容 | 用途 |
| --- | --- | --- |
| **公式版** | 公式レイアウトに近いシート。根拠時刻の欄なし | 印刷・提出 |
| **拡張版** | 各欄に根拠時刻とEvidenceRefを併記 | 振り返り・研修・監査 |

公式版は印刷しても崩れないよう、用紙・余白・表幅を固定する。
**公式様式の画像・PDFを同梱しない**（付録Eの確認が取れるまで）。

画面（v09 §15.0）は次の5つの評価ビューに分かれる。

1. **Decision Support View（L1）**：Judge Sheet 形式で P/V/Strength カテゴリ、内部値、Net sum、Voting Issue 二候補、Review Gate。常に「AI参考判定」
2. **Clash Ledger View（L2）**：論点→ノード→Attack→Defense→Rule State→残存値を時系列・逆引きで表示
3. **Counterfactual View（L2）**：各 Issue を `constructive_end` へ戻した場合の margin 変化と `winner_flip`。研修・開発用
4. **HP / Learning View（L3）**：HP、デリバリー、初心者向け説明。公式判定と視覚的に区別する
5. **Human Ballot View**：従来の Judge Sheet（画面 F）。AI 候補は右側に参考表示できるが、各欄を人が確定する。Strength=None の残存リスク記述欄を持つ

Review Gate があるとき、警告アイコンだけでなく**なぜ止まったか・どの発言を確認するか**を具体的に表示する。
パネル画面（F2）はバロット一覧、多数と少数、Voting Issue の分布、判定理由の並置を持つ（P22）。

---

## 11. Voting Issue：survival と clash leverage

Voting Issue の AI 候補を単純な `max(Strength)` にしない（v09 §10.6）。二つの候補を出す。

- **`survival_candidate`**：最終時点で勝者側に残った Issue のうち Strength 最大
- **`clash_candidate`**：当該 Issue の post-constructive clash を取り除き、`constructive_end` snapshot へ戻した
  counterfactual で margin を最も動かす Issue

```text
clash_leverage(i) = abs(margin_final - margin_counterfactual_no_clash(i))
```

counterfactual では Issue i の A/B/C だけを立論終了時（③終了時点）へ戻し、他の Issue は最終値のままにする。
勝者が反転すれば `winner_flip = true`。

- 二候補が一致 → `confidence = high`
- 不一致 → 両候補を提示し `confidence = low`。人間確認へ
- **`decisive_event_ids` を必ず添付する**（`DecisionSupport.issues[].decisiveEventIds` は1件以上）
- 説明に fluent / vivid / impressive 等の delivery 語彙が混じれば `communication_in_content` 候補フラグ

counterfactual と `clash_leverage` はサーバが決定的に計算する（§2）。Issue が AD1 / DA1 の2つしか無い★G0 の段階では
検証にならないため、機能としては★G0 の後（P12.2）。列（`official_decision_support.counterfactuals` / `voting_issue_candidates`）は先に入れる。

---

## 12. Value turn Review Gate

Value turn は Impact の magnitude と direction を分離する（v09 §10.7）。

- `impact_direction ∈ {+1, −1}` を L2（`argument_node_scores` / `issue_snapshots`）に保存する
- **L1 の公式表示では signed score を出さず、Strength の magnitude は P × V のまま**
- `scoring_config.value_turn_mode = 'review_gate'` を MVP の既定値とする
- turn 適用あり／なしの counterfactual net sum で winner が変わる場合、`winner_suggestion = REVIEW_REQUIRED`
- winner が変わらない場合は AI 参考判定を出せるが、Value turn の存在を明記する
- `signed_net` の自動計算への移行は Phase 2 以降の実データ校正後に再検討する

Zod：`ValueTurnGate = { present, issues, winnerWithTurn, winnerWithoutTurn, flips }`。`flips = true` なら `REVIEW_REQUIRED`。
機能は★G0 の後（P12.3）。

---

## 13. Decision Support の停止条件と `REVIEW_REQUIRED`

次の場合、AI は AFF / NEG を断定せず `winner_suggestion = REVIEW_REQUIRED` を返す（v09 §10.8）。
理由は `review_reasons[]` に **`ReviewReasonCode` 6値**で持ち、`REVIEW_REQUIRED` のときだけ1件以上存在する（v09 §13.4 の refine）。

| 停止条件 | `ReviewReasonCode` |
| --- | --- |
| 重大な `UNVERIFIABLE` が margin を変え得る | `UNVERIFIABLE_AFFECTS_MARGIN` |
| coverage gap（`coverage_status ≠ complete`）が margin を変え得る | `COVERAGE_GAP_AFFECTS_MARGIN` |
| Value turn の採否で winner が変わる（§12） | `VALUE_TURN_FLIPS_WINNER` |
| `survival_candidate` と `clash_candidate` が競合し、説明 confidence が閾値未満（§11） | `VOTING_CANDIDATES_CONFLICT` |
| Summary の Evidence が comparison か late repair か境界で confidence が低い（§3.3） | `SUMMARY_EVIDENCE_BOUNDARY` |
| 採用状態未確定（`suggested` のまま）のイベントが Net sum / Voting Issue へ寄与している | `UNRESOLVED_RULE_STATE` |

`ReviewReason = { code, issue, eventIds, segmentIds, note }`。UI は対象 segment / event へ直接ジャンプできる。

**`REVIEW_REQUIRED` は正常な状態であり、エラーでも未判定でもない。** HTTP は 200 で返す（`API_SPEC.md` §12）。
Review Gate は「モデルが弱いから失敗」ではなく、判断支援ツールが不確かな材料を公式らしく見せないための正常動作である。
人間 Ballot のロックを機械的には止めない（§5）。

---

## 14. 人間 Ballot とパネル

- **`judge_decisions` は1ジャッジ1票。** `UNIQUE(match_id, decided_by)`。2票目は `409 BALLOT_DUPLICATE`
- `judge_issue_assessments_human` に、人が確定した Issue ごとの P / V / Strength カテゴリと根拠 segment、
  Strength=None の残存リスク（`residual_note`）を保存する
- **パネル結果はビュー `panel_result` で多数決を導出し、行として保存しない。少数意見（`dissenting`）を消さない**
- `matches.panel_size` は奇数。偶数は `400 VALIDATION_FAILED` の `details` に理由（専用コードは作らない）
- `ballots_cast < panel_size` の間、`panel_result.winner` は null
- AI Decision Support はジャッジ人数とは独立して 1 run 以上持てる
- AI と人間、ジャッジ同士の一致・不一致を研究用に比較するが、**AI 値で人間票を上書きしない**
- `human_disagreement = 少数票 / 総票数` と AI の margin は別変数として保存する。
  **4-1 を機械的に「僅差」と扱わない**（v09 §18.1.1）

`PanelResult`（v09 §13.3）：`{ matchId, panelSize, ballotsCast, affVotes, negVotes, winner, dissenting }`。
refine は `panelSize % 2 === 1` と `affVotes + negVotes === ballotsCast`。
列と一意制約は P12 で先に入れ、パネル UI（F2）と `GET /matches/{id}/panel` は P22。
