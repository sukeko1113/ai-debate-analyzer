# Gold Dataset v01 — Motion

## Motion

> **The Republic of Meridia should abolish tourist visa requirements for all countries.**

## この論題について

**すべて架空である。** Meridia、Solera、Verano、引用される統計・専門家・新聞は、
いずれも実在しない。実在の政策論題を避けたのは、Gold Dataset を将来教材として公開したときに、
**内容そのものが議論を呼ばないようにする**ためである。

## 架空世界の設定（原稿を書くときの共通前提）

| 項目 | 設定 |
| --- | --- |
| Meridia | 人口約 480 万人の島嶼国。観光と漁業が主産業 |
| GDP に占める観光 | 12% |
| 年間訪問者 | 約 120 万人（2024年度） |
| ビザ | 全 190 か国のうち約 60% に事前ビザを課す。申請に約3週間、費用 45 ドル |
| Solera | 隣国。2021年に同様の措置を実施した先例 |
| Verano | Meridia の旧市街。世界遺産。既に受入限界に近い |
| Kestrel Bay | 地方の漁村。観光が雇用の柱 |

## Plan（肯定立論①の冒頭で提示）

> The Republic of Meridia will abolish tourist visa requirements for the nationals of
> all countries, starting from the next fiscal year. Tourist stays of up to 90 days
> will be permitted without prior application.

- プランは立論冒頭で述べる（条項 2.1.1.1）
- 立論後にプランを変更・追加しない

## Issue の骨格

### AD1 — Tourism Revenue（肯定側 Advantage 1）

| role | 内容 |
| --- | --- |
| `present` | 60% の国からの入国にビザが要る。申請に3週間・費用も発生し、断念する層がいる。域内平均より観光客シェアが低い |
| `effect` | 障壁が消える → 訪問者が増える。隣国 Solera が 2021 年に同措置を取り、2年で 34% 増 |
| `importance` | 観光は GDP の 12%。地方雇用が依存している |
| `evidence` | Meridia 観光庁統計、Solera 入国管理白書、Chen 教授 |

### AD2 — International Exchange（肯定側 Advantage 2）

| role | 内容 |
| --- | --- |
| `present` | 若年層の海外接触が少ない。短期交流もビザ摩擦で限定的 |
| `effect` | 訪問者増 → 対面接触・リピート・姉妹都市提携が増える |
| `importance` | 長期的な相互理解と教育効果 |
| `evidence` | 弱い。意図的に薄くしてある |

> **AD2 は意図的にやや弱くしてある。** NEG が `not_important` で攻撃でき、
> 最終比較で「経済 vs 治安」という価値の対立が立つ。
> すべての Issue を等しく強くすると、比較の練習にならない。

### DA1 — Security and Public Health（否定側 Disadvantage 1）

| role | 内容 |
| --- | --- |
| `present` | ビザ審査が事前スクリーニングとして機能。健康申告も申請時に取っている |
| `effect` | 事前審査が消える → 犯罪歴のある入国者・健康申告なしの入国が増える |
| `importance` | 2019 年の域内アウトブレイクの再来 |
| `evidence` | 内務省治安年報、Alvarez 医師 |

### DA2 — Pressure on Local Communities（否定側 Disadvantage 2）

| role | 内容 |
| --- | --- |
| `present` | Verano 旧市街は既に受入限界。住民の苦情が増加 |
| `effect` | 訪問者急増 → オーバーツーリズム → 住民流出・家賃上昇・遺産の損耗 |
| `importance` | 不可逆な文化遺産の喪失 |
| `evidence` | Verano 市議会報告書、Meridia Daily |

## 架空の証拠一覧

| ID | 出典 | 種別 | 必須要素 | 使う場面 |
| --- | --- | --- | --- | --- |
| `E1` | Meridia Tourism Authority Statistics, fiscal year 2024 | 事実・統計 | 出典・年度 | AD1 present / effect |
| `E2` | Solera Government Immigration White Paper, 2023 | 事実・統計 | 出典・年度 | AD1 effect |
| `E3` | Professor Chen, tourism economist, University of Meridia | 専門家 | 氏名・肩書 | AD1 importance |
| `E4` | Meridia Ministry of Interior Security Report, 2024 | 事実・統計 | 出典・年度 | DA1 present |
| `E5` | Dr. Alvarez, Director of the Meridia Institute of Public Health | 専門家 | 氏名・肩書 | DA1 effect / importance |
| `E6` | Verano City Council Report, 2024 | 事実・統計 | 出典・年度 | DA2 全般 |
| `E7` | Meridia Daily, November 12, 2024 | 新聞記事 | 社名・日付 | DA2 importance |

## AFF / NEG 反転版（gold-01-mirror）

M9（判定の対称性）のため、AD と DA を入れ替えた版を機械的に生成する。

- AD1 ↔ DA1、AD2 ↔ DA2 として、話者と Stage の対応も入れ替える
- 反転版で判定が対称に反転しなければ、プロンプトかスキーマに偏りがある
- 反転版には違反・罠を仕込まない（RuleFlag の測定は正版だけで行う）

## 仕込む違反と罠

`ACCEPTANCE.md` §4.4 を正本とする。違反10件・罠4件。
