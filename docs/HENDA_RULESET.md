# HENDA_RULESET.md — 大会ルールと機械可読化の対応

対象: 第20回 全国高校生英語ディベート大会 大会ルール（HEnDA審査委員会）
ruleset id: `henda-20` / version: 大会ルールの改定日（例 `2025-11-28`）

このファイルは「どの条項を、どこまで機械で扱うか」の対応表である。
**ルール本文をコードやプロンプトに埋め込まない。** 条項番号と要約で参照する。

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

スピーチ合計42分。準備時間とチェアパーソンのアナウンスも**別イベントとして保持する**（捨てない）。

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

---

## 3. 機械可読化するルールとフラグ

すべて**候補フラグ**であり、自動で判定から除外しない。

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

### 3.1 `evidence_incomplete` の必須要素（条項 3.2.1）

| 資料種別 | 必須要素 |
| --- | --- |
| 事実・統計データ | ① 出典（白書・官庁統計・法律名等） ② 年度 |
| 専門家の証言・分析 | ① 氏名 ② 肩書・権威 |
| 新聞記事・ニュース | ① 新聞社・通信社名 ② 日付 |

全文引用である必要はない（要約可）。ただし原文の意図を歪めないこと。

### 3.2 `new_argument` の判定材料（条項 4.2.2）

**新しい議論に該当する**
- Defense / Summary で初めて出たPlan・Advantage・Disadvantage
- Defense / Summary で初めて出た新しいAttackの証拠資料
- 相手に反論機会が著しく限られた段階での新規主張

**新しい議論ではない（正当な比較）**
- 既出議論のより深い角度からの比較
- 細かい証拠比較（総括での、否定ディフェンスへの再々反論にあたる議論など）
- 「相手の議論を認めたとしても、私たちの◯◯には劣る」型の比較

**例外**: 否定立論③にアタックに該当する議論が含まれていた場合、
肯定アタック⑦でそこへ反論することは許される。フラグの説明文にこの可能性を書き添える。

---

## 4. 立論の証明構造（条項 2.1.1 / 2.1.2）

各Issueは3つのroleに分解して保存する。

| Issue | `present` | `effect` | `importance` |
| --- | --- | --- | --- |
| AFF Advantage | 現状分析 / inherency / necessity | Planのeffect / solvency / process | importance / significance / impact |
| NEG Disadvantage | 現状分析 / uniqueness | Planからのeffect / link / process | importance / significance / impact |

AD・DAとも**各側最大2**。見かけ2つでも中身が3つ以上なら、主要な2つ以外は無視される。

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

---

## 6. 質疑応答（条項 2.1.9）

- 質問側は必ず疑問型で発言する。進行の決定権は質問側にある。
- 応答が長い・的外れな場合、質問側が遮って次の質問へ移ってよい。
- ⑥・⑧では原則として相手のAttackについて質問する（立論との矛盾に関わる場合は立論も可）。
- タイマーが鳴った後は応答を待たずに終了。

質疑の記録は `QUESTION` / `ANSWER` ノードとして保持し、
Attackの対象を特定する材料として使う（フローシートの細いQ&A列を省略しない）。

---

## 7. 判定（条項 4.2 / 4.3）

- ジャッジは必ずどちらかに勝ちを投じる。**引き分けは存在しない**。
- どう検証しても優劣がつけられない例外的な場合のみ、推定（presumption）により**否定側の勝ち**。
- Decision Making Chart: `Probability(Hi/Lo)` × `Value(Large/Small)` = `Strength(Strong/Weak/None)`
- 比較: AFF勝ち = AD1+AD2 > DA1+DA2 / NEG勝ち = DA1+DA2 ≧ AD1+AD2
- Voting Issue: 投票を最も決定した論点を1つ挙げる。挙げられないなら判定を再考する。
- Communication Points: 1〜5の**整数のみ**（0や0.5は不可）。平均が3。5と1は例外的。
  **勝敗とは別枠**。発音・訛りそのものを勝敗理由にしない。

### 7.1 Communication Pointsの減点事由（条項 4.3.1）
- 試合態度が悪い（私語・異音での妨害、ジャッジの試合指揮に従わない、大声での助言）
- 質疑の際のマナーが悪い
- 相手側の証拠資料の閲覧に協力しない

減点があっても最低1点を下回らない。**減点は人が入力する。AIは提案しない。**

---

## 8. チェアパーソン定型句辞書

コードに埋め込まず、rulesetの `chairCues` として外部定義する。

| 定型句（部分一致） | 対応ステージ | 備考 |
| --- | --- | --- |
| `Affirmative Constructive Speech` | 1 | |
| `Questions from the Negative` | 2 または 8 | **文言が重複。直前ステージと経過時間で判別** |
| `Negative Constructive Speech` | 3 | |
| `Questions from the Affirmative` | 4 または 6 | **文言が重複。同上** |
| `Negative Attack Speech` | 5 | |
| `Affirmative Attack Speech` | 7 | |
| `Affirmative Defense Speech` | 9 | |
| `Negative Defense Speech` | 10 | |
| `Affirmative Summary Speech` | 11 | |
| `Negative Summary Speech` | 12 | 最終スピーチ |
| `preparation time` | 準備時間 | 1分／2分は前後のステージで決まる |
| `Please say your name and start` | 直後がスピーチ開始 | 計測開始点の手掛かり |
| `The debate is now over` | 試合終了 | 以降は判定対象外 |

> **ここを取り違えると、以降のフロー全体が1ステージずれる。**
> 質疑の文言だけで判別してはいけない。必ず直前に確定したステージと経過時間の両方を使う。

計測開始は「スピーチ担当者が起立し、名前を告げた直後」（条項 2.2.2）。
名前を告げない場合は原則やり直しになるため、名乗りの有無も記録する。

---

## 9. rulesetに入れない情報

以下は試合単体の解析に不要なので、rulesetには入れない。

- 予選運営方法、パワー・ペアリング、予選通過基準（第1章）
- 褒賞、ベスト・ディベーター賞の集計（1.3）
- オンライン大会の通信障害時の特別措置（2.2.9 / 4.2.5）
- 証拠資料の閲覧・取り調べの運用（3.2.3）

必要になった時点で別のrulesetモジュールとして足す。
