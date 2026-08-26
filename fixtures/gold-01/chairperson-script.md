# Chairperson Script & Timeline — Gold Dataset v01

音声を組み立てるための台本。**チェアパーソンのアナウンスも音声に含める。**
Pass S（ステージ推定）が定型句を手がかりにするため、これが無いと境界推定を検証できない。

## 話者一覧

| 座席 | 名前 | 担当ステージ（条項 2.2・4人チーム） |
| --- | --- | --- |
| A1 | Mina | ① 立論、② 応答 |
| A2 | Ken | ⑦ アタック、⑧ 応答、**⑥（本来は A3。violation #5）** |
| A3 | Sara | ⑥ 質疑（**実際は Ken が行う**）、⑨ ディフェンス |
| A4 | Tomo | ④ 質疑、⑪ 総括 |
| N1 | Rui | ③ 立論、④ 応答 |
| N2 | Hana | ⑤ アタック、⑥ 応答 |
| N3 | Yuji | ⑧ 質疑、⑩ ディフェンス |
| N4 | Emi | ② 質疑、⑫ 総括 |

- Chairperson: Ms. Ito
- AFF: Northshore High School / NEG: Riverbend High School

## タイムライン（合計 42分00秒）

チェアパーソンのアナウンス時間は計時に含めない。
下表の `start` は**スピーチ計時の開始時刻**（名乗り直後）である。

| # | ステージ | start | 長さ | end | 話者 |
| --- | --- | --- | --- | --- | --- |
| ① | AFF Constructive | 00:00 | 4:00 | 04:00 | A1 Mina |
| — | Preparation Time | 04:00 | 1:00 | 05:00 | — |
| ② | Questions from the Negative | 05:00 | 2:00 | 07:00 | N4 → A1 |
| ③ | NEG Constructive | 07:00 | 4:00 | 11:00 | N1 Rui |
| — | Preparation Time | 11:00 | 1:00 | 12:00 | — |
| ④ | Questions from the Affirmative | 12:00 | 2:00 | 14:00 | A4 → N1 |
| — | Preparation Time | 14:00 | 2:00 | 16:00 | — |
| ⑤ | NEG Attack | 16:00 | 3:00 | 19:00 | N2 Hana |
| ⑥ | Questions from the Affirmative | 19:00 | 2:00 | 21:00 | **A2 Ken** → N2 |
| ⑦ | AFF Attack | 21:00 | 3:00 | 24:00 | A2 Ken |
| ⑧ | Questions from the Negative | 24:00 | 2:00 | 26:00 | N3 → A2 |
| — | Preparation Time | 26:00 | 2:00 | 28:00 | — |
| ⑨ | AFF Defense | 28:00 | 3:00 | **31:00** | A3 Sara |
| ⑩ | NEG Defense | 31:20 | 3:00 | 34:20 | N3 Yuji |
| — | Preparation Time | 34:20 | 2:00 | 36:20 | — |
| ⑪ | AFF Summary | 36:20 | 3:00 | 39:20 | A4 Tomo |
| ⑫ | NEG Summary | 39:20 | 3:00 | 42:20 | N4 Emi |

> **⑨ の時間超過（violation #9）**
> ベルは **31:00 ちょうど**に鳴る。Sara はその後 **約20秒**話し続け、**31:20** に終わる。
> 条項 2.2.3 の10秒を超えているので、`over_time` の対象は `31:10` 以降である。
> 以降のステージは 20 秒ずれる。**正解データの時刻はこのずれを反映させること。**

## アナウンス台本

`[ ]` は音声に含めない指示。定型句は D1 チェアパーソンスクリプトに準拠する。

### 開始

> Good afternoon, and welcome to the 1st round of this practice debate tournament.
> My name is Ito and I will be the chairperson for this debate round.
> The resolution of this debate is: The Republic of Meridia should abolish tourist visa requirements for all countries.
> On the Affirmative side, we have Northshore High School.
> And on the Negative side we have Riverbend High School.

### 各ステージ

| 前 | アナウンス |
| --- | --- |
| ① | We will now begin this round with the Affirmative Constructive Speech for 4 minutes. Are you ready? Please say your name and start! |
| 準備 | Thank you, speaker. We will now have 1 minute preparation time. |
| ② | Preparation time has ended; we will now have Questions from the Negative Side for 2 minutes. Are you ready? Please say your name and start! |
| ③ | Question time has ended; we will now hear the Negative Constructive Speech for 4 minutes. Are you ready? Please say your name and start! |
| 準備 | Thank you, speaker. We will now have 1 minute preparation time. |
| ④ | Preparation time has ended; we will now have Questions from the Affirmative side for 2 minutes. Are you ready? Please say your name and start! |
| 準備 | Question time has ended; we will now have 2 minutes preparation time. |
| ⑤ | Preparation time has ended; we will now hear the Negative Attack Speech for 3 minutes. Are you ready? Please say your name and start! |
| ⑥ | Thank you! We will now have Questions from the Affirmative side for 2 minutes. Are you ready? Please say your name and start! |
| ⑦ | Question time has ended; we will now hear the Affirmative Attack Speech for 3 minutes. Are you ready? Please say your name and start! |
| ⑧ | Thank you! We will now have Questions from the Negative side for 2 minutes. Are you ready? Please say your name and start! |
| 準備 | Question time has ended. We will now have 2 minutes preparation time. |
| ⑨ | Preparation time has ended; we will now hear the Affirmative Defense Speech for 3 minutes. Are you ready? Please say your name and start! |
| ⑩ | Thank you. We will now hear the Negative Defense Speech for 3 minutes. Are you ready? Please say your name and start! |
| 準備 | Thank you! We will now have 2 minutes preparation time. |
| ⑪ | Preparation time has ended; we will now hear the Affirmative Summary Speech for 3 minutes. Are you ready? Please say your name and start! |
| ⑫ | Thank you! We will now hear the final speech of this round, the Negative Summary Speech for 3 minutes. Are you ready? Please say your name and start! |

### 終了

> Thank you, debaters. The debate is now over. You all did a great job.

## Pass S にとっての手がかり

| 手がかり | 状態 |
| --- | --- |
| 定型句 | 12ステージすべてに配置済み |
| 「Please say your name and start」 | 各スピーチ直前に配置済み。計時開始点の目印 |
| 名乗り | 全12ステージで「My name is ...」を発話する |
| 公式時間 | 上表のとおり |

> **②⑧ と ④⑥ は文言が重複する。**
> 「Questions from the Negative Side」は ② と ⑧、
> 「Questions from the Affirmative side」は ④ と ⑥ で同じである。
> **直前に確定したステージと経過時間の両方**を使わなければ判別できない。
> ここを取り違えると以降のフロー全体が1ステージずれる。

## 準備時間の扱い

準備時間は無音ではなく、**小さな話し声と紙をめくる音**が入る。実際の試合を再現するため。
`prep_segments` として保持し、判定対象外とする。

## 音声化の設定

| 項目 | 値 |
| --- | --- |
| 形式 | mono / 64 kbps / mp3 |
| 想定サイズ | 約 20 MB（42分） |
| 話者の声 | 8名＋チェアパーソンで最低4種類を使い分ける |
| ベル | ⑨ の 31:00 に明確な音を入れる |

> **TTS 音声は明瞭すぎるため、`audibility` の検証には使えない。**
> 検証できるのはステージ区分・時刻照合・論点構造・ルール検査・集計・出力まで。
> 聞き取りやすさに関わる部分は、許諾を得た実試合で人が確認する（`ACCEPTANCE.md` §4.1）。
