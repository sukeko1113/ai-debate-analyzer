# P1 キックオフ指示文

## 前提（これが済んでいないと始められない）

1. PR #1 が `main` にマージされている
2. v05 の文書一式が `main` に入っている
   （`docs/BASIC_DESIGN_v05.md`、`docs/ARGUMENT_MODEL.md`、更新された `CLAUDE.md` / `docs/TASKS.md` / `docs/DATA_MODEL.md` / `docs/ACCEPTANCE.md` / `docs/JUDGE_LOGIC.md` / `docs/PRIVACY_RETENTION.md`）
3. **新しいセッション**を開いている（P0 のセッションを使い回さない）
4. 環境セレクタが `☁ ai-debate-analyzer` / `</> ai-debate-analyzer` / `⑂ main`

---

## 貼る内容（ここから）

このリポジトリの `CLAUDE.md` と、次の文書を先に読んでください。

- `docs/TASKS.md` の P1
- `docs/ARGUMENT_MODEL.md` の §1・§2・§5（議論の4構成要素、やりとりの種別、比較の4軸）
- `docs/HENDA_RULESET.md`（全体）
- `docs/BASIC_DESIGN_v05.md` 第13章（コアスキーマ）
- `docs/ACCEPTANCE.md` §1（機械検証の一覧）

**今回やるのは P1 だけです。P2 以降には進まないでください。**

### P1 の範囲

`packages/core` の中だけで完結します。DBもAPIもUIも作りません。

1. `packages/core/src/ruleset/` に `henda-20` を定義する
   - 12ステージ（type / side / 時間 / 直後の準備時間）
   - 担当者表（4人チーム・3人チームの両方。`HENDA_RULESET.md` §2）
   - 語数上限600・150 wpm・終了後10秒・AD/DA各側最大2・コミュニケーション点1〜5
   - チェアパーソン定型句辞書（`HENDA_RULESET.md` §8）
   - 証拠資料の必須読み上げ要素（`HENDA_RULESET.md` §3.1）
2. Zod でドメインスキーマを定義する
   `Ruleset` / `Issue` / `ArgumentNode` / `FlowLink` / `RuleFlag` /
   `ComparisonAxis` / `JudgeRun` / `JudgeDecision`
3. P0 で作った `REGISTRY` に足して `schemas/*.json` を生成する

### 受け入れ基準

`docs/TASKS.md` の P1 に書いてあります。特に次を確認できるまで完了としないでください。

1. **壊した ruleset でテストが失敗すること。** 少なくとも次の7通りを試してください。
   - ステージが11個しかない
   - 時間の合計が42分にならない
   - 担当者表に穴がある（あるステージの `seat4` が空）
   - `stage_no` が重複している
   - `side` と `type` が矛盾している（例：`AFF_ATTACK` なのに `side: 'NEG'`）
   - `chairCues` が空
   - `maxIssuesPerSide` が 2 以外
2. `schemas/` の再生成で差分ゼロ
3. `winner` に引き分けを入れると**型エラー**になる（実行時エラーではなく）
4. `commPoints` に 0 / 0.5 / 6 を入れるとバリデーションエラー
5. `ArgumentNode.role` が `present` / `effect` / `importance` / `evidence` / `other` の5値
6. `effect_kind` の語彙が `ARGUMENT_MODEL.md` §2 の表と一致している
7. `ComparisonAxis` で `source: 'debater'` かつ `segmentIds` が空だと失敗する（M26）

### やってはいけないこと

- **大会ルールの本文をコードやコメントに埋め込む。** 条項番号と要約で参照してください
- **定型句辞書をコードにハードコードする。** ruleset の一部（データ）として外部定義してください
- **DBのマイグレーションを作る。** P1 は `packages/core` だけです
- **API・UI・ステージ推定・転写に手を出す。** すべて P2 以降です
- `fixtures/gold-01/` を前提にする。**まだ存在しません。**
  P1 のテストは手書きの小さな fixture で書いてください

### 設計上の注意（過去に決めた判断）

- **質疑の定型句は文言が重複します。** 「Questions from the Negative」は②と⑧、
  「Questions from the Affirmative」は④と⑥で同じ文言です。
  `chairCues` の1エントリが複数のステージ番号を持てる形にしてください。
  1対1にすると P6 で作り直しになります。
- **Zod が唯一の定義です。** JSON Schema は生成物であり、手書きしません。
  P11 で DB の enum を作るときも、この Zod 定義から導きます。
- **定数はリテラル型で固定してください。** `maxIssuesPerSide: z.literal(2)` のように、
  ルールを型で強制する箇所です。実装の都合で緩めないでください。

**まず実装計画を提示してください。**
何をどの順で作り、各受け入れ基準をどのテストで確認するかを示してから、
承認を得たうえで手を動かしてください。

完了報告は `docs/ACCEPTANCE.md` §2.1 の形式で書いてください。
確認していないものを「確認しました」と書かないでください。

## 貼る内容（ここまで）

---

## 計画が返ってきたら見るところ

- [ ] 壊した ruleset のテストが **7通り**あるか（1〜2通りで済ませていないか）
- [ ] `chairCues` が **1エントリ→複数ステージ**を持てる形になっているか
- [ ] `role` が5値、`effect_kind` が `ARGUMENT_MODEL.md` §2 と同じ語彙か
- [ ] 定型句辞書が**データとして**外に出ているか（コードに埋まっていないか）
- [ ] DBマイグレーションを作ろうとしていないか
- [ ] `gold-01` に依存していないか
- [ ] `winner` の引き分けが**型エラー**として検出されるか（実行時ではなく）

## P1 の後

- P2（API基盤と試合登録）へ。ただし P-1（Gold Dataset）の進捗を確認してから
- Gold Dataset は **P6 の着手までに**必要
