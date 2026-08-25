# JUDGE_LOGIC.md — 判定支援とサーバ権威

## 0. このアプリが判定に対してすること・しないこと

| する | しない |
| --- | --- |
| 公式Decision Making Chartの各欄に**候補**を出す | 勝敗を決める |
| 候補の根拠として、時刻付きの発言を示す | 候補を確定として保存する |
| ルール違反の**候補**を提示する | 違反を自動で判定から除外する |
| 集計（AD合計 vs DA合計）をサーバで計算する | 独自の点数体系を作る |
| 判定理由のドラフトを書く | ドラフトを最終文書として確定する |

---

## 1. Decision Making Chart

公式Judge Sheetの構造をそのまま中心に置く。

| 欄 | 公式表現 | アプリの支援 |
| --- | --- | --- |
| 1. List of issues | AD1 / AD2 / DA1 / DA2（各側最大2） | 主要論点だけを確定。3つ目以降は `extra_issue` として除外候補 |
| 2. Probability | `Hi` / `Lo` | 事実と証拠で構築され、Attack後もどこまで成立したかを候補提示 |
| 3. Value (Impact) | `Large` / `Small` | 重要性がどこまで説明・防御されたかを候補提示 |
| 4. Strength | `Strong` / `Weak` / `None` | Probability × Value の総合。**人が確定** |
| 5. Compare | AD合計 と DA合計 | AFF勝ち: AD1+AD2 > DA1+DA2 / NEG勝ち: DA1+DA2 ≧ AD1+AD2 |
| 6. Voting Issue | ラベル1つ | 投票を最も決定した論点。候補と根拠時刻を提示 |
| New Argument check | Yes / No | 後半の新規議論で判定が汚染されていないか |
| Communication | 1〜5の整数 | **勝敗とは別枠**。減点事由は人が入力 |
| Best Debater | 1名 | **候補を出さない。人が入力する** |

### 1.1 数値へ置換しない

`Hi/Lo`・`Large/Small`・`Strong/Weak/None` を0〜100点に変換しない。
「砂山」「HP」「残存率」のような可視化は、**学習・観戦用の補助表示としてのみ**使い、
公式Judge Sheetの判定ロジックと混ぜない。

内部で比較演算が必要な場合も、順序関係（`Strong` > `Weak` > `None`）だけを使い、
差の大きさを数値化しない。

### 1.2 引き分けは存在しない

- `winner` は `AFF` か `NEG` の二択。スキーマで引き分けを表現できないようにする。
- どう検証しても優劣がつけられない例外的な場合のみ、推定により**否定側の勝ち**。
- この既定値をAIに自動適用させない。**人が「優劣がつけられない」と判断したときだけ**提示する。

---

## 2. サーバ権威の原則

判定に関わる状態を、AIやクライアントが直接書けるようにしてはならない。

| 対象 | 原則 | 理由 |
| --- | --- | --- |
| Issue key（AD1等）、node id | **サーバが割り当てる。AIに生成させない** | AI生成のキーは重複・揺れが起き、履歴の同一性が壊れる |
| `confirmed` / `excluded` | **サーバのAPIだけが書ける** | クライアント直書きを許すと改竄経路になる |
| AD合計とDA合計の比較 | **サーバで計算する** | 判定の再現性を保つ |
| AIの出力 | **必ず `suggested` 層に入る** | AIが確定状態を作れないことを構造で保証する |
| ruleset版・モデル版 | **実行時にサーバが記録する** | どのルールとモデルで作られた判定かを追える |

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

`HENDA_RULESET.md` §3 の9種すべてに共通する規則。

1. AIは `status = 'candidate'` でしか作れない。
2. `candidate` のフラグは**判定に一切影響しない**（集計から除外しない）。
3. 人が `confirmed` にして初めて、対象ノードが `excluded` へ遷移できる。
4. `rejected` にしたフラグも削除しない。「なぜ除外しなかったか」も記録に残す。
5. フラグの `rationale` には、**根拠となる発言の時刻**を必ず含める。

### 3.1 New Argument の説明文に書くこと

- どのステージで初出したか
- 過去のどのステージにも見当たらないこと（探した範囲を明示する）
- **例外の可能性**（否定立論③にアタック相当が含まれていた場合は、⑦での反論が許される等）

「新しい議論です」と断定しない。「初出に見えます。次を確認してください」と書く。

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
| `DROPS` | 反論も応答もされないまま残った | システム導出 | `CLAIM` / `ATTACK` |

**方向違反はDBのCHECKまたはAPIバリデーションで弾く。**
`ATTACK → ATTACK`（アタックへのアタック）は原則存在しない。
それらしいリンクが出たら、Defense の取り違えを疑う。

### 4.1 `DROPS` の導出

- 対象ノードに、後続ステージからの `ATTACKS` も `QUESTIONS` も付いていない
- かつ、相手側のSummaryでも触れられていない

導出は自動でよいが、**`suggested` で出す**。人が確認して `confirmed` にする。

---

## 5. ロック不変条件（v04で追加）

`judge_decisions.locked_at` を立てられるのは、次をすべて満たすときだけ。
**API（`POST /judge/decision/lock`）とDBトリガの両方で検査する。**

1. `winner` / `voting_issue` / `comm_aff` / `comm_neg` / `reason` が埋まっている
2. `voting_issue` に対応する `issues.review_status = 'confirmed'`
3. **判定根拠として引用された全 segment の `audibility` が `clear` / `partial` / `unheard` のいずれかに人間確定されている**
4. `rule_flags` に `status = 'candidate'` が残っていない（Phase B）

### 5.1 「判定根拠として引用された segment」の定義

`judge_decisions` → `issues`(`confirmed`) → `argument_nodes`(`confirmed`) → `node_segments`
で辿れる segment の集合。`DATA_MODEL.md` §8 の `judge_cited_segments` ビューで求める。

### 5.2 なぜ 3 が要るのか

`audibility = unknown` は「**まだ人が聞いていない**」を意味する。
これを許すと、**AIの文字起こしを人間が聞いたものとして判定に使ってしまう**。
本設計が最も避けたい事故が、ちょうどここで起きる。

- 未確定が残る場合は `409 AUDIBILITY_UNRESOLVED`。
  `details.pendingSegmentIds` を返し、UIはそこへ直接ジャンプする。
- **Judge Viewで `unknown` の本文を隠さない。** 隠すとレビュー前は何も読めなくなる。
  「未確認」と明示して見せ、ロックで止める。

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
- 減点事由（試合態度、質疑のマナー、証拠閲覧への非協力）は**人が入力する**。AIは提案しない。
- 速度（150 wpm）と語数（600語）は候補フラグとして出すが、**自動減点しない**。

---

## 8. ロック後の扱い

- `locked_at` が入った `judge_decisions` は、以後変更できない（`409 DECISION_LOCKED`）。
- 変更が必要な場合は、**新しい `judge_decisions` を作る**。古い行は消さない。
- エクスポートは `locked` 済みの判定からのみ行う。下書きからは出力しない。
- 同じ `judge_decision_id` ＋ 同じ `template_version` からは、何度でも同じ生成物が出る（G7）。

---

## 9. 出力する2種類のJudge Sheet

| 版 | 内容 | 用途 |
| --- | --- | --- |
| **公式版** | 公式レイアウトに近いシート。根拠時刻の欄なし | 印刷・提出 |
| **拡張版** | 各欄に根拠時刻とEvidenceRefを併記 | 振り返り・研修・監査 |

公式版は印刷しても崩れないよう、用紙・余白・表幅を固定する。
**公式様式の画像・PDFを同梱しない**（付録Eの確認が取れるまで）。
