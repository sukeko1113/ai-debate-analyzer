# HENDA_RULESET.md — 大会ルールと機械可読化の対応

対象: 第20回 全国高校生英語ディベート大会 大会ルール（HEnDA審査委員会）
ruleset id: `henda-20` / version: 大会ルールの改定日（例 `2025-11-28`）

このファイルは「どの条項を、どこまで機械で扱うか」の対応表である。
**ルール本文をコードやプロンプトに埋め込まない。** 条項番号と要約で参照する。

本書は v09 §3・§8.2〜8.6・§10.5・§13.1〜13.2 に追随している（2026-09-06）。
§2 の担当者表・§5 の表・§8 の文言は `packages/core/src/ruleset/ruleset.test.ts` が固定しており、v09 でも変わらない。
§3 の RuleFlag 表と §4 の `role` は `packages/core/src/schema/flow.test.ts` が固定しているため、
**表の書き換えは Zod と同時（P4.2）** に行う。それまで直前の注記が v09 の値を示す。

---

## 1. 12ステージ（条項 2.1）

| No | type | side | 時間 | 直後の準備時間 | 主な役割 |
| --- | --- | --- | --- | --- | --- |
| 1 | `AFF_CONSTRUCTIVE` | AFF | 4分 | 1分 | Plan ＋ Advantage（最大2） |
| 2 | `NEG_QUESTIONS` | NEG | 2分 | 0 | ①の確認・検証 |
| 3 | `NEG_CONSTRUCTIVE` | NEG | 4分 | 1分 | Disadvantage（最大2） |
| 4 | `AFF_QUESTIONS` | AFF | 2分 | 2分 | ③の確認・検証 |
| 5 | `NEG_ATTACK` | NEG | 3分 | 0 | AFF Advantageの証明を攻撃 |
| 6 | `AFF_QUESTIONS` | AFF | 2分 | 0 | 原則⑤の確認・検証 |
| 7 | `AFF_ATTACK` | AFF | 3分 | 0 | NEG Disadvantageの証明を攻撃 |
| 8 | `NEG_QUESTIONS` | NEG | 2分 | 2分 | 原則⑦の確認・検証 |
| 9 | `AFF_DEFENSE` | AFF | 3分 | 0 | AD再構築 |
| 10 | `NEG_DEFENSE` | NEG | 3分 | 2分 | DA再構築 |
| 11 | `AFF_SUMMARY` | AFF | 3分 | 0 | 要約と比較（AD > DA） |
| 12 | `NEG_SUMMARY` | NEG | 3分 | 0 | 要約と比較（DA ≧ AD） |

**スピーチ34分 ＋ 準備8分 ＝ 42分。**
「スピーチ合計42分」と書くと準備時間を含むのか曖昧になるので、内訳で示す。
準備時間の内訳は ①後1分 / ③後1分 / ④後2分 / ⑧後2分 / ⑩後2分。

準備時間とチェアパーソンのアナウンスも**別イベントとして保持する**（捨てない。§1.1）。

この3つの数（34分・8分・42分）は `packages/core/src/ruleset/schema.ts` の
`TOTAL_SPEECH_SEC` / `TOTAL_PREP_SEC` / `TOTAL_MATCH_SEC` と対応しており、
どれか1つでも合わなければ ruleset の検証が落ちる。

`StageDef`（v09 §13.1）は表の各行に加えて、`allowsNewIssue`（①③だけ true）/ `allowsAttack`（⑤⑦）/
`allowsDefense`（⑨⑩）/ `allowsComparison`（⑨〜⑫）/ `seat4` / `seat3`（§2）を持つ。
`Ruleset` の定数は `maxIssuesPerSide = 2`、`constructiveMaxWords = 600`、`maxWordsPerMinute = 150`、
`graceSecAfterBell = 10`、`tieBreak = 'NEG'`、`communicationPoints = {min 1, max 5, integerOnly}`、`evidenceRequirements`（§3.1）。
いずれも refine で固定され、`ruleset.test.ts` が壊した ruleset で落ちることを検査している。

### 1.1 12ステージの外側（v07。条項の外だが設計上は無視できない）

実試合の録音は、①の前に開会と自己紹介が置かれていた。8名全員が順に立ち、名前と担当
（constructive speaker / attack / defense / summary）を述べる。計時対象ではなく判定材料でもないが、
座席（A1〜N4）と氏名を結び付ける情報が試合を通してここにしか無い（§2.1）。

| 区間 | 保持先 | 判定での扱い |
| --- | --- | --- |
| 開会・自己紹介 | `match_events(kind='self_introduction')` ＋ `transcript_segments`（`stage_no` NULL、`event_id` あり） | 判定材料にしない。根拠として引用できない（`422 NON_STAGE_SEGMENT_CITED`） |
| チェアパーソンのアナウンス | `match_events(kind='announcement')` | 同上。ステージ境界の手掛かりとしてのみ使う（§8） |
| 準備時間 | `match_events(kind='prep')` | 同上 |
| スピーチ冒頭の名乗り（条項 2.2.2） | `transcript_segments`（`stage_no` あり、`is_self_introduction = true`）＋ `match_members.intro_segment_id` | 計測開始点。保持レベル C で伏せる対象 |

`match_events.kind` は3値。`transcript_segments.stage_no` は NULL 可で、NULL のときは `event_id` が必須（CHECK）。
判定の根拠として引けるのは `stage_no` が 1〜12 の区間だけ、という規則も同じ制約で書ける（`DATA_MODEL.md` §5）。
**名乗りは二か所にある。** 片方だけ伏せると、音声を消していない限り復元できてしまう。印は `is_self_introduction` に統一する。

### 1.2 ステージ長の妥当性検査と欠損（v07）

ステージの実測長を規定時間と突き合わせる（v09 §8.5）。閾値を緩くしているのは、名乗りとアナウンスをどこで切るかで
実測長が数十秒動くためで、捕まえたいのは「3分のスピーチが10分になっている」桁違いである。

| 検査 | 条件 | 立てるフラグ |
| --- | --- | --- |
| 長すぎる | 実測長 > (`durationSec` + `graceSec`) の2倍 | `stage_duration_anomaly` |
| 短すぎる | 実測長 < `durationSec` の 1/3 | `stage_duration_anomaly` |
| 単一区間が長すぎる | ひとつの `transcript_segment` がそのステージの `durationSec` を超える | `segment_duration_anomaly` |
| 合計が合わない | 12ステージの実測長合計と34分の差が3分を超える | `stage_duration_anomaly`（match 単位） |

**このフラグは判定に入らない。** 人が境界を引き直すか、欠損として `stage_segments.coverage_status`
（`complete` / `partial` / `missing`。`missing` にできるのは人だけ）に記録する。
欠損ステージからは DROPS を導出せず（`JUDGE_LOGIC.md` §4.1）、その区間を根拠に引いたままロックできない（`409 GAPPED_STAGE_CITED`）。

---

## 2. スピーチ担当者表（条項 2.2）

ステージが確定すれば発言者は導出できる。**話者分離は不要**。

| ステージ | 肯定4人 | 肯定3人 | 否定4人 | 否定3人 |
| --- | --- | --- | --- | --- |
| ① 肯定立論 | A1 | A1 | — | — |
| ② 否定質疑 | — | — | N4 | N2 |
| ③ 否定立論 | — | — | N1 | N1 |
| ④ 肯定質疑 | A4 | A2 | — | — |
| ⑤ 否定アタック | — | — | N2 | N2 |
| ⑥ 肯定質疑 | A3 | A3 | — | — |
| ⑦ 肯定アタック | A2 | A2 | — | — |
| ⑧ 否定質疑 | — | — | N3 | N3 |
| ⑨ 肯定ディフェンス | A3 | A3 | — | — |
| ⑩ 否定ディフェンス | — | — | N3 | N3 |
| ⑪ 肯定総括 | A4 | A1 | — | — |
| ⑫ 否定総括 | — | — | N4 | N1 |

3人チーム登録は原則認められない（病欠等の例外のみ）。既定は4人。

### 2.1 座席と氏名の結び付け（v07。P7.5）

担当者表はステージが確定すれば「その発言者が A1 なのか A3 なのか」を決める。決まらないのは「A1 が誰なのか」であり、
実試合ではそれを自己紹介ラウンドの名乗り（§1.1）から取った（v09 §8.6）。

| 手順 | 内容 | `seat_binding_status` |
| --- | --- | --- |
| 1 | 自己紹介ラウンドの区間から、名乗りと担当の宣言を抽出する | `ai_suggested` |
| 2 | 宣言された担当（constructive / attack / defense / summary）と、担当者表の座席を対応づける | 同上 |
| 3 | 各スピーチ冒頭の名乗りと突き合わせ、矛盾がないことを確認する | 一致すれば `rule_derived` |
| 4 | 人が試合登録の名簿と照合して確定する | `human_confirmed` |

- 手順3は実試合で実際に効いた検算である。①の立論者が②で応答し、④の質問者が⑪で総括した、といった対応が
  全ステージで一致することを確認する。一致しない場合は `speaker_role_mismatch` を立てる。
- 名乗りが聞き取れないスピーカーの `display_name` は空のままにする。**推測で埋めない。** 座席ラベルだけで解析・観戦画面は成立する。
- `match_members` に `intro_segment_id`（名乗り区間）、`name_source`（`self_introduction` / `registration` / `unknown`）、
  `seat_binding_status`（3値）を持つ（`DATA_MODEL.md` §2）。
- 名乗り区間が未特定のまま `human_confirmed` にする要求は `400 VALIDATION_FAILED`（専用コードは作らない）。
- provider の話者ラベルはこの工程に使わない（`TRANSCRIPTION.md` §2.1）。

---

## 3. 機械可読化するルールとフラグ

すべて**候補フラグ**であり、自動で判定から除外しない。
`status` は `candidate` / `confirmed` / `rejected` の3値で、`review_status` とは別語彙（`JUDGE_LOGIC.md` §3）。

**15種**（`RuleFlagType`。v09 §13.2）。後6種は条項番号を持たない。
記録の欠損と、判定理由への混入に関する本アプリ側の規則である。

| type | 条項 | 検出内容 | 判断主体 |
| --- | --- | --- | --- |
| `speaker_role_mismatch` | 2.2 | 担当者表と実際の発言者の不一致 | 人 |
| `over_word_limit` | 2.1.10 | 立論が600語超過 | 人 |
| `over_speech_rate` | 2.1.10 | 平均150 wpm超過の区間 | 人 |
| `over_time` | 2.2.3 | ステージ終了＋10秒以降の発話 | 人 |
| `extra_issue` | 2.1.1.3 / 2.1.2.1 | AD/DAが片側3つ以上 | 人 |
| `new_argument` | 4.2.2 | Defense/Summaryでの初出Plan・AD・DA・新Attack証拠 | 人 |
| `premature_rebuttal` | 2.1.4 | 肯定アタック⑦での否定アタック⑤への再反論 | 人 |
| `evidence_incomplete` | 3.2.1 | 引用時の必須読み上げ要素の欠落 | 人 |
| `own_calculation` | 3.2.1.1 | 独自計算値の宣言と元データ読み上げの欠落 | 人 |
| `audibility_gap` | — | 対象区間に `audibility = unheard` があり、DROPS を導出できない | 人 |
| `stage_coverage_gap` | — | 応答義務のあったステージの `coverage_status ≠ complete` | 人 |
| `stage_duration_anomaly` | — | ステージ長が規定と大きく食い違う（§1.2） | 人 |
| `segment_duration_anomaly` | — | 区間長が異常（ASR の取りこぼし・貼り付き。§1.2） | 人 |
| `communication_in_content` | — | `delivery` の語彙が Voting Issue / Strength の理由に混入（§7.1） | 人 |
| `dropped` | — | 相手ステージにノードが1つも無く、DROPS リンクを作れない | 人 |

> **`audibility_gap` / `stage_coverage_gap` から DROPS を導出しない。**
> 「聞き取れなかった」「記録が無い」「応答しなかった」は別の事象で、判定材料になるのは DROPS だけである。
> この2つのフラグは **DROPS を導出できないことを人に伝えるため**に立てる。逆向きには使わない
> （`JUDGE_LOGIC.md` §4）。同じ理由で `dropped` も候補止まりであり、自動で「落ちた」ことにしない。

### 3.1 `evidence_incomplete` の必須要素（条項 3.2.1）

| 資料種別 | `evidenceRequirements` のキー | 必須要素 |
| --- | --- | --- |
| 事実・統計データ | `factData: ['source', 'year']` | ① 出典（白書・官庁統計・法律名等） ② 年度 |
| 専門家の証言・分析 | `expert: ['name', 'credential']` | ① 氏名 ② 肩書・権威 |
| 新聞記事・ニュース | `news: ['outlet', 'date']` | ① 新聞社・通信社名 ② 日付 |

全文引用である必要はない（要約可）。ただし原文の意図を歪めないこと。
`evidence_refs.cited_elements` に読み上げられた要素を記録し、`completeness` で充足を判定する（`DATA_MODEL.md` §6）。

### 3.2 `new_argument` の判定材料（条項 4.2.2）

**新しい議論に該当する**
- Defense / Summary で初めて出たPlan・Advantage・Disadvantage
- Defense / Summary で初めて出た新しいAttackの証拠資料
- 相手に反論機会が著しく限られた段階での新規主張

**新しい議論ではない（正当な比較）**
- 既出議論のより深い角度からの比較
- 細かい証拠比較（総括での、否定ディフェンスへの再々反論にあたる議論など）
- 「相手の議論を認めたとしても、私たちの◯◯には劣る」型の比較

**Summary の新 Evidence の境界（v08）**
- Summary で初出の Evidence でも、**既出論点どうしを深く比較するだけ**なら
  Rule State `ADMISSIBLE_NEW_EVIDENCE_FOR_COMPARISON` として扱える。ただし A/B/C のノード値を上げない
- 立論または Defense で欠けていた Observation / Link / Impact を Summary の Evidence で初めて成立させるものは
  **`INADMISSIBLE_LATE_REPAIR`**（`JUDGE_LOGIC.md` §3.3）
- どちらか境界で confidence が低ければ AI 参考判定は `REVIEW_REQUIRED`（`SUMMARY_EVIDENCE_BOUNDARY`）

**例外**: 否定立論③にアタックに該当する議論が含まれていた場合、
肯定アタック⑦でそこへ反論することは許される。フラグの説明文にこの可能性を書き添える。
Rule State Engine では⑦のイベントが③のノードを target にしていれば `ADMISSIBLE`
（規則表の `condition = 'target.stage_no = 3'`、`rule_ref = '4.2.2'`）。Gold Dataset の罠 T2。

---

## 4. 立論の証明構造（条項 2.1.1 / 2.1.2）

条項が定める**証明構造は3つ**である。v09 はこれを `node_type` の A / B / C に写す（v09 §3.2・§9.5）。

| Issue | `A_OBSERVATION` | `B_LINK`（`link_order` 1..n） | `C_IMPACT` | 主な Attack（`attack_type`） |
| --- | --- | --- | --- | --- |
| AFF Advantage | 現状分析 / inherency / necessity | Planのeffect / solvency / process | importance / significance / impact | `NOT_NECESSARY` / `NO_EFFECT` / `NOT_IMPORTANT` / `VALUE_TURN` |
| NEG Disadvantage | 現状分析 / uniqueness | Planからのeffect / link / process | importance / significance / impact | `NOT_UNIQUE` / `NO_EFFECT` / `NOT_IMPORTANT` / `VALUE_TURN` |

`node_type` は **4値**（A / B / C ＋ `OTHER`。Plan 説明・進行・手続き等で原則採点対象外）。
Evidence / Warrant は**ノードではない**。A/B/C が成立する理由の質を表す Support Quality タグ
（`EVIDENCE` / `WARRANT` / `RELEVANCE` / `BURDEN`）として、`argument_node_scores` の level 理由に保存する。
Judge Sheet の Probability が Evidence を含むため、独立係数として二重評価しないためである（`ARGUMENT_MODEL.md` §1）。
引用の記録（3.2.1 の充足判定）は `evidence_refs`。

P1 で実装した `ArgumentRole`（v05 の5値 `present` / `effect` / `importance` / `evidence` / `other`）は、
P4.2 で `NodeType` 4値へ一括で書き換えた。`legacy_role` は作らない（`ARGUMENT_MODEL.md` §1）。

AD・DAとも**各側最大2**（`maxIssuesPerSide = 2`）。見かけ2つでも中身が3つ以上なら、主要な2つ以外は無視される
（3件目以降は `INADMISSIBLE_EXTRA_ISSUE` / `extra_issue` の候補）。

---

## 5. Attack / Defense / Summary の制約

| ステージ | できること | できないこと |
| --- | --- | --- |
| ⑤ NEG Attack | AD証明への攻撃（not necessary / no effect / not important）、Value turn | 新Disadvantageの追加、Case flip |
| ⑦ AFF Attack | DA証明への攻撃（not unique / no effect / not important）、Value turn | 新Advantageの追加、⑤への再反論 |
| ⑨ AFF Defense | ADの再構築、比較の観点提示 | 新Plan・新AD、③への新Attack |
| ⑩ NEG Defense | DAの再構築、比較の観点提示 | 新DA、①への新Attack、⑨への再々反論 |
| ⑪ AFF Summary | 要約、比較、細かい証拠比較 | 新Plan・新AD、③への新Attack |
| ⑫ NEG Summary | 要約、比較、細かい証拠比較 | 新DA、①への新Attack |

表の `allowsAttack`（⑤⑦）/ `allowsDefense`（⑨⑩）/ `allowsComparison`（⑨〜⑫）は `henda-20.json` の `StageDef` と一致する。

機械可読化の規則（v09 §3.3）：

- Attack は相手 AD/DA の **A/B/C のどこを攻撃しているかを必ず持つ**。主種別は `NOT_NECESSARY` / `NOT_UNIQUE` / `NO_EFFECT` /
  `NOT_IMPORTANT` / `VALUE_TURN`。`EVIDENCE` / `RELEVANCE` / `BURDEN` は任意ノードへの Support Quality 攻撃として持てる
  （`ARGUMENT_MODEL.md` §2.4）。
- Defense は親 Attack へ `parent_event_id` で紐づけ、自陣ノードの再構築として記録する。親 Attack と無関係な新規論点ずらしは回復として扱わない。
- Dropped は「応答機会があり、`coverage_status = complete` で、Defense で応答しなかった」場合だけ成立する。
  `missing` / `partial` のステージから自動導出しない（`JUDGE_LOGIC.md` §4.1）。
- Summary は既出議論の要約・比較・weighing を行う。新 Attack、新 AD/DA、新 Plan は禁止候補。
- Summary で初出の Evidence は comparison-only か Late Repair かで扱いが分かれる（§3.2）。
- ⑦で直前⑤への再反論を行う等、スピーチ役割を先取りするものは `INADMISSIBLE_PREMATURE_REBUTTAL` 候補（③由来の例外あり。§3.2）。
- 表の「Case flip」（Value turn を超えて相手の Case を自陣の利益に反転させる）は立論での仕事であり、Attack 以降に現れたら
  `new_argument` 候補と `INADMISSIBLE_NEW_ADVANTAGE` / `INADMISSIBLE_NEW_DA` として扱う。`RuleFlagType` に `case_flip` という値は無い。
- **境界事例は AI が理由と confidence を出し、人間が confirm / reject できる。AI だけで human ballot から除外しない。**

---

## 6. 質疑応答（条項 2.1.9）

- 質問側は必ず疑問型で発言する。進行の決定権は質問側にある。
- 応答が長い・的外れな場合、質問側が遮って次の質問へ移ってよい。
- ⑥・⑧では原則として相手のAttackについて質問する（立論との矛盾に関わる場合は立論も可）。
- タイマーが鳴った後は応答を待たずに終了。

質疑の記録は `QUESTION` / `ANSWER` ノードとして保持し、
Attackの対象を特定する材料として使う（フローシートの細いQ&A列を省略しない）。

応答は `ANSWERS` リンクの `effect_kind` として `admits`（前提を認めた）/ `declines_to_answer`（答えをずらした・答えなかった）を
持てる（任意。`ARGUMENT_MODEL.md` §2.3）。AI 参考判定では既定 `qa_effect_mode = cited_only` で、質疑の Concession / Clarification は
Rule State `NEEDS_CITATION` として記録し、後続スピーチで明示的に引用されたときだけ P/V へ反映する。
これはルール文書で一意に決まらないため**校正対象**とする（v09 §10.5）。

---

## 7. 判定（条項 4.2 / 4.3）

- ジャッジは必ずどちらかに勝ちを投じる。**引き分けは存在しない**。
- どう検証しても優劣がつけられない例外的な場合のみ、推定（presumption）により**否定側の勝ち**。
- Decision Making Chart: `Probability(Hi/Lo)` × `Value(Large/Small)` = `Strength(Strong/Weak/None)`
- 比較: AFF勝ち = AD1+AD2 > DA1+DA2 / NEG勝ち = DA1+DA2 ≧ AD1+AD2
- Voting Issue: 投票を最も決定した論点を1つ挙げる。挙げられないなら判定を再考する。
- Communication Points: 1〜5の**整数のみ**（0や0.5は不可）。平均が3。5と1は例外的。
  **勝敗とは別枠**。発音・訛りそのものを勝敗理由にしない。

本アプリ側の規則（v09 §10.10〜10.11。条項の外）：

- `Strength = None` とした Issue には**残存リスクの記述（`residual_note`）を必ず書く**。「無視できる」で終わらせない。
  Zod の refine と DB の CHECK で担保する。
- Strength は `Probability × Value` の写像だが、公式表示と人間 Ballot は Strong / Weak / None の語彙だけを持ち、数値へ置換しない。
  AI 側の候補は常に「AI参考判定」と表記する（`JUDGE_LOGIC.md` §1.1）。
- **判定は1ジャッジ1票。** パネル結果はビューで多数決を導出し、少数意見を消さない。`panel_size` は奇数。
  票が揃うまで（`ballots_cast < panel_size`）パネルの勝者は出さない（`JUDGE_LOGIC.md` §14）。

### 7.1 Communication Pointsの減点事由（条項 4.3.1）
- 試合態度が悪い（私語・異音での妨害、ジャッジの試合指揮に従わない、大声での助言）
- 質疑の際のマナーが悪い
- 相手側の証拠資料の閲覧に協力しない

減点があっても最低1点を下回らない。**減点は人が入力する。AIは提案しない。**

AI が音声から観測できるのは聞き取りやすさ・速度・間・無応答などに限り、暫定の点（`comm_points_suggested`）として出せる。
アイコンタクト・マナー・証拠閲覧への協力は人が確認する。話者別の Delivery（Fluency / Intelligibility / Clarity / Persuasiveness）は
学習用（L3）であり、勝敗にも Probability / Value / Strength にも入れない。判定理由の `delivery` 段落が Voting Issue / Strength の理由に
使われていれば `communication_in_content` を candidate で立てる。自動で除外しない（`JUDGE_LOGIC.md` §7）。

---

## 8. チェアパーソン定型句辞書

コードに埋め込まず、rulesetの `chairCues` として外部定義する。
`kind` は `ChairCueKind` の **5値**（`stage_start` / `prep` / `speech_start` / `debate_end` / **`self_introduction`**。v09 §13.1）。
`stage_start` だけが `stageNo`（1件以上。質疑は2件）を持ち、それ以外は `stageNo: []`（refine）。
12ステージすべてに `stage_start` の定型句があることも refine で検査する。

| 定型句（部分一致） | `kind` | 対応ステージ | 備考 |
| --- | --- | --- | --- |
| `We will now have a brief introductions from the negative side members` | `self_introduction` | — | 開会・自己紹介ラウンドの境界（§1.1）。`match_events(kind='self_introduction')`。v09 で追加 |
| `Affirmative Constructive Speech` | `stage_start` | 1 | |
| `Questions from the Negative` | `stage_start` | 2 または 8 | **文言が重複。直前ステージと経過時間で判別** |
| `Negative Constructive Speech` | `stage_start` | 3 | |
| `Questions from the Affirmative` | `stage_start` | 4 または 6 | **文言が重複。同上** |
| `Negative Attack Speech` | `stage_start` | 5 | |
| `Affirmative Attack Speech` | `stage_start` | 7 | |
| `Affirmative Defense Speech` | `stage_start` | 9 | |
| `Negative Defense Speech` | `stage_start` | 10 | |
| `Affirmative Summary Speech` | `stage_start` | 11 | |
| `Negative Summary Speech` | `stage_start` | 12 | 最終スピーチ |
| `preparation time` | `prep` | 準備時間 | 1分／2分は前後のステージで決まる |
| `Please say your name and start` | `speech_start` | 直後がスピーチ開始 | 計測開始点の手掛かり |
| `The debate is now over` | `debate_end` | 試合終了 | 以降は判定対象外 |

> **ここを取り違えると、以降のフロー全体が1ステージずれる。**
> 質疑の文言だけで判別してはいけない。必ず直前に確定したステージと経過時間の両方を使う。

質疑の文言は実際の読み上げ（"… from the Negative Side"）より短い形で照合する。`henda-20.json` の `pattern` と
`ruleset.test.ts` がこの短形で固定しているので、v09 §8.2 の表もこれに合わせてある。

計測開始は「スピーチ担当者が起立し、名前を告げた直後」（条項 2.2.2）。
名前を告げない場合は原則やり直しになるため、名乗りの有無も記録する（`stage_segments.name_announced`）。

---

## 9. rulesetに入れない情報

以下は試合単体の解析に不要なので、rulesetには入れない。

- 予選運営方法、パワー・ペアリング、予選通過基準（第1章）
- 褒賞、ベスト・ディベーター賞の集計（1.3）
- オンライン大会の通信障害時の特別措置（2.2.9 / 4.2.5）
- 証拠資料の閲覧・取り調べの運用（3.2.3）

必要になった時点で別のrulesetモジュールとして足す。
