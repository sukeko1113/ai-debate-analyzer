# ACCEPTANCE.md — 受け入れ基準と品質ゲート

## 0. なぜ基準を二分するのか

このプロジェクトの実装はクラウド上のコーディングエージェントが担う。
**エージェントは音を聞けない。** テストが通ることと、実際に正しい位置の音が鳴ることは別である。

したがって受け入れ基準を、
**(A) 機械が判定できるもの**と **(B) 人が耳と目で確かめるしかないもの** に分ける。
(B) は、CIが緑でも「完了」にしない。**「人の確認待ち」として報告する。**

**実 Supabase Storage を必要とする検証は、すべて H 表に置く。**
クラウドセッションは実 Supabase に接続しない（`DEV_ENVIRONMENTS.md` §4）ため、
「Storage が要る」と「機械で確かめられない」は、この案件では同じ意味になる。
M 表に置くと、stub で通ったことを実物で通ったと読み違える。

本書は v09 §18 と付録G-2 に追随している（2026-09-06）。v09 §18.1 の表は本書 M1〜M43 の上位集合ではなく、
P3 / P4 の実装で足した M9 / M12 / M27〜M43 は v09 に対応行が無いが有効である。v07 以降の行は M44〜M61。

| エージェントが検証できる | 検証できない |
| --- | --- |
| 型・スキーマ・状態遷移・集計・分岐 | 音が鳴るか、区間再生が意図した位置か |
| fixtureに対する検出精度 | 発言が聞き取れるか（audibility） |
| アンカー照合（純粋関数・音声不要） | ステージ境界が実音と一致しているか |
| API契約・権限・不変条件 | 判定・解説の妥当性 |
| 出力ファイルの生成と構造 | 逐語の忠実さ（フィラーが残っているか） |
| 人手の状態が再解析で消えないこと | |

---

## 1. 機械検証（CIで自動）

| # | 対象 | 指標 | 合格条件 |
| --- | --- | --- | --- |
| M1 | ruleset整合 | 12ステージ・担当者表・時間の一貫性 | **壊したfixtureで必ず失敗すること** |
| M2 | スキーマ | Zod検証、JSON Schema生成の一致 | `schemas/` の再生成で差分ゼロ |
| M3 | ジョブ | 状態遷移、冪等性、部分再実行 | 同じ冪等キーで二度実行しても結果が変わらない |
| M4 | アンカー照合 | 合成fixtureでの時刻誤差 | 中央値0.5秒以内。被覆率0.6未満なら書き換えなし |
| M5 | ステージ推定 | 境界誤差とステージ誤分類 | 誤差2秒以内、**誤分類ゼロ** |
| M6 | ルール検査 | 15種フラグ（`HENDA_RULESET.md` §3）のPrecision / Recall | **Recall 0.9以上**（違反10件中9件以上）＋ **罠4件で誤検出ゼロ**。Precisionの値も記録する |
| M7 | Issue抽出 | AD/DAラベル一致、A/B/C（`node_type`）の抽出と `OTHER` の比率 | Gold Dataset v01 で初回計測した一致率を**基準値として記録する。CI のゲートにはしない**（下回ったら人がレビューする。v09 §18.1） |
| M8 | Flowリンク | `ATTACKS`→Claim、`DEFENDS`→Attackの一致率 | 同上（基準値の記録。ゲートにしない） |
| M9 | 判定の対称性 | AFF/NEG反転入力（`gold-01-mirror`） | **判定が対称に反転すること** |
| M10 | 出力 | 成果物の生成、根拠なし段落の不在 | **根拠なし段落ゼロ** |
| M11 | 人手の保存 | 再解析前後の `human_*` 件数 | **減っていたら失敗** |
| M12 | サーバ権威 | LLM応答スキーマに id / label / reviewStatus が無い | 含まれていたら失敗 |
| M13 | データ保護 | 音声・映像拡張子、大容量ファイル、実名らしき文字列 | 検出したら失敗 |
| M14 | 許諾 | `consent_recorded_at` が null でジョブ作成 | **`409 CONSENT_REQUIRED`** |
| **M15** | **ロック不変条件** | 根拠segmentに `audibility = unknown` が残る状態でロック | **`409 AUDIBILITY_UNRESOLVED`。`pendingSegmentIds` が返る** |
| **M16** | **audibilityの書き手** | ジョブ／解析経路から `audibility` を書こうとする | **DBのCHECKで失敗する** |
| **M17** | **DB接続方式** | `postgres.js` の `prepare` 設定、`supabase-js` のDB利用 | `prepare: false` であること（静的検査）。DBアクセスに `supabase-js` を使っていないこと。加えて **CI から Supavisor 6543 へ接続するスモークテスト**が通ること（prepared statement を使う経路が失敗する。v09 §17.6） |
| **M18** | **RLS** | 他人のmatchへのアクセス | **アプリの分岐を外してもRLSで見えないこと** |
| **M19** | **楽観ロック** | `expectedVersion` の省略／不一致 | 省略は `400`、不一致は `409 VERSION_CONFLICT` |
| **M20** | **保持と削除** | A→B→C→D の順序、`edit_logs` の伏せ字化 | 順序違反が拒否される。B削除後に本文が `edit_logs` にも残らない |
| **M21** | **ノードの根拠** | `segmentIds` 0件でのノード作成 | API `422 NODE_WITHOUT_SEGMENT` ＋ DB遅延制約で失敗 |
| **M22** | **effectiveness の分離** | 判定の集計コードが `judge_flow_links` 以外から `effectiveness` / `comparison` を読んでいない | 静的検査。`flow_links` / `summary_links` への直接参照と `SELECT *` があったら失敗（v09 §12.6） |
| **M23** | **effectiveness の書き手** | ジョブ・解析経路から `effectiveness_human` を書こうとする | DBのCHECKで失敗する |
| **M24** | **役割優先UI** | 解析・観戦画面のコンポーネントから `display_name` への参照 | 参照があったら失敗（登録画面と公式出力を除く） |
| **M25** | **HPの隔離** | 判定の集計コードがHPモジュール（`schema/learning.ts`）を import している | import があったら失敗。逆方向（HP→判定）も検査。判定側は `judge_flow_links` しか読めない |
| **M26** | **比較の根拠** | `source='debater'` の `ComparisonAxis` に `segmentIds` が空 | Zod検証で失敗 |
| **M27** | **保存パスの組み立て** | `{match_id}/{sha256}.{ext}` が sha256 と mime から決まる | `filename` を使っていないこと。mime→ext が4値とも一致 |
| **M28** | **登録の3分岐** | 新規 / 既存 / purge後の再利用 | `created`(201) / `already_exists`(200) / `restored`(200)。**並行INSERTの23505を捕捉して既存を返す** |
| **M29** | **upsert の決め手** | 署名発行時の `upsert` | `purged_at` 入りなら `true`、新規なら `false`。**リクエストからは受け取らない** |
| **M30** | **メディアの認可** | 非メンバー／`viewer` からのアクセス | 非メンバーは **404**（存在を漏らさない）、`viewer` の書き込みは **403** |
| **M31** | **`matchIdFrom`** | `GET /media/{id}/playback-url`（idがmatchでない） | 他人のmatchのメディアで **404**。渡し忘れは500になるため回帰で検出する |
| **M32** | **`media_sources` のRLS** | 他人のmatchのメディア | **アプリの認可分岐を外してもRLSで見えないこと** |
| **M33** | **入力規約** | mimeがenum外／`byteSize` が 50MB 超 | どちらも `400 VALIDATION_FAILED` |
| **M34** | **SHA-256** | 既知の入力に対するハッシュ | 既知の値と一致すること |
| **M35** | **supabase-js の隔離** | `@supabase/supabase-js` の import 元 | `packages/core/src/storage/**` と `packages/core/src/auth/**` 以外からの import があったら失敗（静的検査） |
| **M36** | **ジョブの状態遷移** | 逆行（`succeeded`→`running`）、終了状態からの再遷移 | **DBのトリガで失敗する**。アプリの分岐を外しても通らないこと |
| **M37** | **HTTP冪等** | 同じ `Idempotency-Key` での `POST /jobs` 再送 | 200 ＋ `Idempotent-Replay: true`。**行が増えないこと** |
| **M38** | **DB側の冪等キー** | 同じ冪等キーでの二度目の作成、並行INSERT | 既存を 200 で返す。**`target_stage_no` が NULL の kind でも重複しない**（`NULLS NOT DISTINCT`）。23505 を捕捉 |
| **M39** | **ジョブの認可** | 他人のジョブへの `retry` / `cancel` | **404**（403だと存在が漏れる）。`matchIdFrom` 忘れは持ち主でも404になるため正常系が回帰になる |
| **M40** | **`transcription_jobs` のRLS** | 他人のmatchのジョブ | **アプリの認可分岐を外してもRLSで見えないこと** |
| **M41** | **内部APIの境界** | `X-Job-Secret` / `Authorization: Bearer` の照合、システム actor | 秘密の不一致・欠落は **401**。**JWTでは通らない**。`sub` がシステム actor の JWT は **401**。`pg_policies` の式が `system_actor_id()` を参照し、**UUIDリテラルが直書きされていない** |
| **M42** | **部分再実行** | `failed` 1件の `retry` | 他ジョブの `status` / `attempt` / `metrics` が変わらないこと |
| **M43** | **metrics の永続化** | `succeeded` 時の `metrics` | `provider_id` / `model` / 所要時間 が行に残る（メモリ上だけに持たない） |
| **M44** | **unheard の引用** | 根拠segmentに `audibility = unheard` が残る状態でロック | **`409 UNHEARD_CITED`。`unheardSegmentIds` が返る** |
| **M45** | **effect_kind の方向** | `DEFENDS` に `no_link`、`COMPARES` に `effect_kind` を付ける | CHECK制約と `422` で拒否される |
| **M46** | **Pass A の時刻精度** | 合成fixtureに対する単語境界の誤差 | 中央値0.3秒以内、95パーセンタイル1.0秒以内（`TRANSCRIPTION.md` §2） |
| **M47** | **環境依存の混入** | リポジトリ内の絶対パスと OS 固有パス | 検出したら失敗（ローカル開発の再発防止） |
| **M48** | **12ステージ外の区間** | `stage_no` と `event_id` の両方が NULL、または両方が非 NULL | **DBのCHECKで失敗する** |
| **M49** | **12ステージ外の引用** | `stage_no` を持たない区間を判定根拠に引く | **`422 NON_STAGE_SEGMENT_CITED`** |
| **M50** | **欠損ステージの引用** | `coverage_status ≠ complete` の区間を根拠に引いた状態でロック | **`409 GAPPED_STAGE_CITED`。`gappedStageNos` と `segmentIds` が返る** |
| **M51** | **欠損ステージの DROPS** | `coverage_status ≠ complete` のステージを to とする `DROPS` | 導出されない。`stage_coverage_gap` が立つ |
| **M52** | **ステージ長の検査** | 規定時間の2倍を超えるステージ、規定時間を超える単一 segment | `stage_duration_anomaly` / `segment_duration_anomaly` が立つ |
| **M53** | **話者ラベルの混入** | provider が返した話者ラベルの保存、`align_words` の `speaker` 列 | 列が存在しない。取り込みコードに参照があったら失敗（静的検査） |
| **M54** | **座席結び付け** | 名乗り区間が未特定のまま `seat_binding_status` を `human_confirmed` にする | **`400 VALIDATION_FAILED`**（`details` に理由。専用コードは作らない。v09 §14.2） |
| **M55** | **Strength=None の根拠** | `residualNote` が空の `None` | Zod検証で失敗。DB の CHECK でも失敗 |
| **M56** | **判定理由の根拠** | 根拠segmentを持たない段落、`ground` が未設定の段落 | 生成されない。生成されたら CI で失敗 |
| **M57** | **バロットの一意性** | 同一ジャッジの2票目 | **`409 BALLOT_DUPLICATE`** |
| **M58** | **パネル人数** | `panel_size` が偶数 | **`400 VALIDATION_FAILED`**（`details` に理由。v09 §14.2） |
| **M59** | **少数意見の保存** | パネル結果の導出後に、多数と異なるバロットが消えていないか | 件数と判定理由が保存されている。`panel_result.dissenting` に id が残る |
| **M60** | **伝達評価の混入** | `ground = 'delivery'` の段落を Voting Issue の理由に使う | `communication_in_content` が `candidate` で立つ。**自動除外はしない** |
| **M61** | **ロック検査の分離** | 判定の集計コードが `judge_lock_guard` を import している | import があったら失敗（静的検査。v09 §12.4） |
| **M62** | **AI と Ballot の権限分離** | `app_ai_worker` から `judge_decisions` / `judge_issue_assessments_human` への INSERT / UPDATE | **DB で拒否される**（P12.4。G9） |
| **M63** | **AI 参考判定の再現性** | 同じ入力・同じ `scoring_config` で `recalculate` を2回 | `official_decision_support` の内容が差分ゼロ |
| **M64** | **REVIEW_REQUIRED の不変条件** | `winner_suggestion = REVIEW_REQUIRED` と `review_reasons` の対応 | `REVIEW_REQUIRED` のときだけ `review_reasons` が1件以上（Zod の refine と DB の CHECK） |

M62〜M64 は v09 §18.1 の表に無いが、§12.5・§14.6・§13.4 の不変条件から起こした（G9 / G10 の機械側）。

### 1.1 テストで手を抜かない

- テストを削除して通す、`skip` する、閾値を緩めて通す、はしない。通らない理由を報告する。
- M1・M15・M16・M18・M21・M23・M26・M30・M32・M33・**M14・M36・M40・M41**・
  **M44・M45・M48・M49・M50・M54・M55・M57・M58・M62** は
  **negative test**（「拒否されること」を確かめるテスト）である。
- M22・M24・M25・M35・M47・M53・M61 は **静的検査**（コードの依存関係を見る）である。実行時テストでは検出できない。
- M7・M8 は基準値の記録であり CI のゲートではない。下回ったら人がレビューする（閾値を緩めて通すのとは違う）。
- **M36・M40 の negative test は、例外の検査ごとに `withActor` を開き直すか
  `tx.savepoint()` を使う。** postgres.js のトランザクションは1つ失敗すると全体が中断し、
  `rejects` で受けたはずの例外が外へ抜ける（`HANDOFF.md` 件13）。
- **DBの中身を確かめるときは `app_server` 接続 ＋ `withActor`。読みも書きも。**
  所有者接続は FORCE RLS で 0 行のまま静かに成功する（`HANDOFF.md` 件12・件27）。
- **negative test は、守りを外したときに落ちなければ意味がない。** 一つずつ外して確かめる
  （P2 で実施した手順が `HANDOFF.md` 件22 にある）。
  正しいデータで通るだけのテストは、ルールを守れているかを検証していない。

---

## 2. 人間検証（必須）

| # | 対象 | 確認方法 | 誰が |
| --- | --- | --- | --- |
| H1 | 再生位置 | 任意の時刻へシークして、その位置の音が鳴るか（10箇所） | 開発者または利用者 |
| H2 | ステージ境界 | 12境界すべてを実音で確認 | 利用者 |
| H3 | audibility | 聞き取れない箇所の判断が妥当か | ジャッジ |
| H4 | 逐語の忠実さ | フィラー・言い直し・沈黙が残っているか | 利用者 |
| H5 | 判定支援の妥当性 | Decision Chart候補とVoting Issue候補が納得できるか | HEnDA経験者 |
| H6 | 解説の妥当性 | 教材として使えるか、判定理由とアドバイスが分離されているか | HEnDA経験者・指導者 |
| H7 | 公式版Judge Sheetの印刷 | 用紙・余白・表幅が崩れないか | 利用者 |
| H8 | 削除後の見え方 | 削除済みの層が「削除済み」と明示されているか | 利用者 |
| **H9** | **署名トークンでのアップロード** | 実 Supabase で1本上げる（署名がバケットのポリシーを迂回するか） | 開発者 |
| **H10** | **署名URLの期限切れ** | 期限切れ後にアクセスできないこと | 開発者 |
| **H11** | **ファイル本体の経路** | APIサーバを通過していないこと（ネットワークログで確認） | 開発者 |
| **H12** | **欠損と不明瞭の区別** | 「記録が無い」「聞き取れなかった」「応答しなかった」が画面上で別物として見えるか | ジャッジ |
| **H13** | **座席の結び付け** | 自己紹介の名乗りと担当宣言から、8名の座席が矛盾なく決まるか | 利用者 |
| **H14** | **少数意見の読み取り** | パネル画面で、多数と異なる判定理由が同じ重みで読めるか | HEnDA経験者 |
| **H15** | **Review Gate の表示** | `REVIEW_REQUIRED` のとき、なぜ止まったか・どの発言を確認するかが具体的に示されるか | ジャッジ |

> **H1 は「区間」ではなく「時刻」で確かめる。** P3 の時点では `stage_segments` も
> `transcript_segments` も無く、「区間」の元データが存在しない。
> 区間再生そのものの確認は P10（`TRANSCRIPTION.md` §7.2）で行う。

> **H9 が 403 になった場合は、バケットのポリシーを緩めず報告すること。**
> 「動かないから権限を広げた」は、第二のセキュリティ境界を自分で外すことになる。

### 2.1 報告の書き方

```
P7 実装完了（CI: 緑）
  機械検証: M1, M5, M19 合格
  人の確認待ち: H2（12境界を実音で確認してください）
  ※ 音声の再生位置は当方では確認できていません
```

「動作を確認しました」と書かない。**確認していないものを確認したと書かない。**

---

## 3. 品質ゲート

| ゲート | 内容 | 通過条件 |
| --- | --- | --- |
| **G1 取り込み** | 音声が入り、再生できる | 実音声1本で、人が任意の時刻へシークして10箇所の再生位置を確認（H1）＋ H9・H10・H11 |
| **G2 時刻** | アンカー照合が機能する | 合成fixtureで誤差中央値0.5秒以内（M4） |
| **G3 ステージ** | 12ステージを安定して切れる | 誤分類ゼロ（M5）＋実試合1本で人が全境界を承認（H2） |
| **G4 逐語** | 判定材料を落としていない | 実試合1本で、重要論点の聞き落としがないことを人が確認（H4） |
| **G5 フロー** | 議論の矢印が追える | リンク一致率を記録（M8）＋人が実試合1本で承認 |
| **G6 判定** | Judge Sheetが埋まり、理由が説明できる | **HEnDA経験者2名**が判定理由の説明可能性を承認（H5） |
| **G7 再現** | 同じ確定版から同じ資料が出る | 2回生成して差分ゼロ。保持レベル B 以降を削除した試合は対象外（`410 RETENTION_PURGED`） |
| **★G0 縦切り貫通** | 合成試合1本が最後まで通る | §3.2 |
| **G8 実試合突き合わせ** | 許諾済みの実試合1本で、設計が現実に耐える | 座席が担当者表から矛盾なく決まる（H13）。欠損・不明瞭・未応答が別物として記録される（H12）。HEnDA経験者が判定理由を承認する。★G0 の後、CI の外で人が行う（v09 §17.2.1 の10手順） |
| **G9 評価エンジン分離** | AI参考判定と Human Ballot が構造的に混ざらない | AI ロールの human ballot write 拒否（M62）、Strength = P × V が L2 に閉じている、L3 → Human 集計の import なし（M25・M61） |
| **G10 Review Gate** | 不確かな勝敗を AI が断定しない | Value turn 反転・重大 UNVERIFIABLE・Voting 候補競合の fixture で `REVIEW_REQUIRED`（M64）。★G0 の後（P12.3） |

### 3.1 KPIの置き方

**Winner一致率だけを最重要KPIにしない。**
人間ジャッジ同士でも判断は割れる（予選は2名のジャッジで票が割れれば引き分け扱いになる）。

重視するのは、**どのFlowを見て、どのIssueをVoting Issueとしたかを説明できること**である。
Winner一致率は記録するが、これを上げるためにプロンプトを調整しない。
調整すると「当たるが理由が説明できない」方向へ進む。

### 3.2 ★G0 縦切り貫通ゲート

Phase Aの終わりに置く。**合成試合1本が、取り込みからWord出力まで最後まで通ること。**

1. `gold-01.mp3` を取り込み、12ステージを確定できる。**自己紹介ラウンドから座席を結び付けられる**（P7.5）
2. Transcriptを人がレビューし、`audibility` を全区間に設定できる
3. AD1 と DA1 を A/B/C に分けて作り、Attack / Defense を矢印でつなげる。clash_events と Rule State が付く（P11.5 / P11.6）
4. AI 参考判定（P/V/Strength と Net sum。AD1 vs DA1）が出る（P12.1）。Decision Chartを人が埋め、Voting Issueを選び、**ロックできる**
5. 判定理由メモのWordが出る（AI 参考判定と人間 Ballot が明示分離）
6. 同じ判定からもう一度出して差分ゼロ

列は4 Issue ぶん先に入っているが、**機能は AD1 / DA1 だけ**で通す（v09 §17.2）。
Voting Issue の counterfactual（P12.2）、Value turn Gate（P12.3）、Rule State の全分岐（P15）、パネル（P22）は G0 の条件ではない。

**ここを通るまでPhase Bへ進まない。**
「全機能の20%」ではなく「全工程を細く1本」を先に作る。
通ったら、実試合1本で同じ流れを人が試す（G8）。

### 3.3 評価エンジンの校正フェーズ（v08。Phase C 前）

AI 参考判定の閾値と写像（`scoring_config`）は実試合で校正する。Gold Dataset では校正できない（§4.1）。
3フェーズに分け、Phase 3 の数値だけを製品性能として扱う（v09 §18.1.1）。P24.5（Calibration harness）でデータ分割を固定する。

| フェーズ | 試合数 | 変えてよいもの | 位置づけ |
| --- | --- | --- | --- |
| 1. Pilot | 10 | ルーブリック、event 種別、Rule State、データ構造の欠陥修正 | **この段階の勝敗一致率を製品性能として公表しない** |
| 2. Calibration | 30〜50 | **`scoring_config` のみ**（カテゴリ写像、閾値、`chain_rule` 等）。ルーブリックや DB 構造を変えたら Phase 1 へ戻る | 校正 |
| 3. Hold-out | 20〜30 | 何も変えない。報告のみ | 性能の報告 |

| 指標 | Phase 3 の目標 |
| --- | --- |
| AI 参考勝敗 vs 多数票 | 80% 以上 |
| P / V / Strength セル一致 | 各 75% 以上 |
| Human Voting Issue が AI 上位2候補に含まれる | 70% 以上 |
| Communication 提案が人間点 ±1 | 80% 以上 |
| Attack target / type / Rule State の κ | 0.6 以上 |
| Delivery 平文化再採点による Strength 変動 | 10% 以内、Voting Issue 不変 |
| Review Gate | Value turn・重大欠損等の見逃し率を別途報告 |

`human_disagreement = 少数票 / 総票数` と AI の margin は別変数として保存し、4-1 を機械的に「僅差」と扱わない。
§3.1 の「Winner 一致率を上げるためにプロンプトを調整しない」は、ここでも効く。

---

## 4. Gold Dataset v01（合成試合）

CIで回帰を取るには、**公開できる正解データ**が要る。
実試合の音声と氏名はリポジトリに置けないため、架空の試合を作る。

| 手順 | 内容 | 成果物 |
| --- | --- | --- |
| 1. 論題を作る | 実在の政策論題を避け、架空だが構造が明確な論題を1つ | `motion.md` |
| 2. 原稿を書く | 12スピーチ分の英語原稿。AD2つ、DA2つ、Attack、Defense、Summary。**立論は600語未満** | `speeches/01〜12.md` |
| 3. 違反を仕込む | New Argument 1件、語数超過 1件、担当者違反 1件、証拠要素の欠落 2件 | `violations.json` |
| 4. 音声化 | TTSで読み上げ、チェアパーソンのアナウンスと準備時間を挟んで42分に組み立てる | `gold-01.mp3`（mono 64kbps） |
| 5. 正解を作る | 正解transcript（原稿そのもの）、正解ステージ境界、正解Flow、正解RuleFlag、正解Judge Sheet、正解判定理由 | `gold/*.json` |
| 6. 固定する | 音声のsha256を記録し、CIで同一性を確認 | `gold-01.sha256` |

### 4.1 合成データの限界を承知しておく

- **TTS音声は明瞭すぎるため、audibility の検証には使えない。**
  実際の高校生の英語・訛り・声量・会場の雑音は再現できない。
- Gold Datasetで検証できるのは、ステージ区分・時刻照合・論点構造・ルール検査・集計・出力まで。
- 聞き取りやすさに関わる機能（audibility、Communication、実運用でのASR精度）は、
  **許諾を得た実試合で人が確認する**。その結果はリポジトリではなく、別管理の検証記録に残す。

### 4.2 AFF/NEG反転版

M9のため、Gold Dataset から **ADとDAを入れ替えた反転版 `gold-01-mirror`** を機械生成する。
反転版で判定が対称に反転しなければ、プロンプトかスキーマに偏りがある。

### 4.3 Phase Aで使う範囲

Phase Aでは、列は4 Issue ぶん先に入れるが、**機能は AD1 と DA1 だけ**を使う（v09 §17.2）。
AD2 / DA2 と RuleFlag の正解データはGold Datasetに含めておくが、検証は★G0 の後（P14 / P15 / P12.2 / P12.3）で行う。

### 4.4 違反10件と罠4件（v05.1で確定）

**違反だけを仕込んだデータセットでは Recall しか測れない。**
「すべてにフラグを立てる」検出器が Recall 1.0 を取ってしまう。
したがって Gold Dataset には、**違反に見えるが違反ではないもの**を併せて仕込む。

#### 違反10件（検出すべきもの）

| # | type | 場所 | 仕込み方 | 難度 |
| --- | --- | --- | --- | --- |
| 1 | `new_argument` | ⑫ NEG Summary | AD1への新しい攻撃。⑤には無かったもの | 高 |
| 2 | `extra_issue` | ① AFF Constructive | Advantageを3つ出す | 中 |
| 3 | `over_word_limit` | ③ NEG Constructive | 640語 | 低 |
| 4 | `over_speech_rate` | ⑤ NEG Attack | 3分で500語＝167 wpm | 低 |
| 5 | `speaker_role_mismatch` | ⑥ AFF Questions | A3の担当をA2が話す | 低 |
| 6 | `evidence_incomplete` | ① 観光庁統計 | 年度を言わない | 中 |
| 7 | `evidence_incomplete` | ⑤ Alvarez医師 | 肩書を言わない | 中 |
| 8 | `own_calculation` | ① AD1 Importance | 独自計算を宣言せず、元データも読み上げない | 中 |
| 9 | `over_time` | ⑨ AFF Defense | ベル後15秒話し続ける | 低 |
| 10 | `premature_rebuttal` | ⑦ AFF Attack | ⑤否定アタックへの再反論を先走る | 高 |

10件にした理由は、**Recall 0.9 という閾値が意味を持つようにする**ため。
5件だと 5/5 = 1.0 か 4/5 = 0.8 しかなく、0.9 が閾値として機能しない。

#3 は 640語 ÷ 4分 = 160 wpm なので `over_speech_rate` も同時に立つ。
**1つの欠陥が2つのフラグを生むのは実際の試合でも起きる**ので、正解データに両方を記録する。

#### 罠4件（検出してはいけないもの）

| # | 内容 | 期待する動作 | 根拠 |
| --- | --- | --- | --- |
| T1 | ⑪ AFF Summaryで、既出論点のより深い比較を出す | `new_argument` を出さない | 条項4.2.2（正当な比較） |
| T2 | ⑦ AFF Attackで、③否定立論に含まれていたアタック相当への反論 | `premature_rebuttal` を出さない | 条項2.1.4（例外） |
| T3 | ①で出典・年度・肩書を完備した引用 | `evidence_incomplete` を出さない | 条項3.2.1 |
| T4 | ① AFF Constructiveを592語にする | `over_word_limit` を出さない | 条項2.1.10 |

**T2が最も効く。** ⑦には本物の違反（#10・⑤への再反論）と正当な例外（T2・③内のアタックへの反論）を
**両方**入れる。区別できるかを測る。

---

### 4.5 v05で追加する正解データ

Gold Dataset に次を含める。すでに原稿を書いていれば、追記で足りる。

| 追加 | 内容 |
| --- | --- |
| A/B/C のラベル | 各 Claim が `A_OBSERVATION` / `B_LINK`（`link_order`）/ `C_IMPACT` / `OTHER` のどれか（v05 の4構成要素 `present` / `effect` / `importance` / `evidence` からの写しは `ARGUMENT_MODEL.md` §1） |
| Attack の対象と種別 | どの `node_type` を `effect_kind` 何で攻撃したか。対応する `clash_events.attack_type` |
| 正解 `effectiveness` | 各やりとりが `strong` / `partial` / `none` のどれか（AI候補との一致率を測る） |
| Summary の比較軸 | `magnitude` / `probability` / `timeframe` / `value` のどれを使い、どちらに有利としたか（`summary_links`） |

`effectiveness` の正解は、AIの候補精度を測るためだけに使う。
**判定の正解データではない**（判定の正解は Judge Sheet 側にある）。

### 4.6 Gold Dataset v02 で足すもの（v07。★G0 の後）

v01 は「正しく作られた試合」を検証するデータだった。実試合が示したのは、正しく作られていない入力のほうが多いということである
（v09 付録 G-2）。v02 では v01 の6手順に加えて次を仕込む。手順そのものは変えず、仕込む内容だけを足す。

| 追加する要素 | 仕込み方 | 検証する対象 |
| --- | --- | --- |
| 開会・自己紹介ラウンド | 8名が順に名乗り、担当を宣言する2〜5分の区間を先頭に置く | `stage_no` が NULL の区間の保持（M48）、座席結び付け（H13）、判定根拠にできないこと（M49） |
| ステージ丸ごとの欠損 | ⑩と⑪に相当する範囲を無音または雑音に差し替える。正解データには `missing` と記録する | `coverage_status`、`stage_duration_anomaly`（M52）、DROPS 抑止（M51）、`409 GAPPED_STAGE_CITED`（M50） |
| 境界の脱落 | ⑨〜⑪のチェアパーソンのアナウンスを1箇所削り、Pass S が境界を落とす状況を作る | ステージ長の妥当性検査、人が引き直せること |
| 代替手段による攻撃 | 「既存の制度で足りる」型の攻撃と、それへの「適用範囲が狭い」という再反論を1組入れる | `effect_kind` の `alternative_solves` / `alt_limited` |
| 対象へ届かない攻撃 | 「対象者の大半が要件を満たさない」型の攻撃を1件入れる | `effect_kind` の `not_solvent` |
| 質疑での譲歩 | 質疑で相手が前提を認める応答を1件、答えをずらす応答を1件入れる | ANSWERS の `admits` / `declines_to_answer` |
| 3人のパネル | 同じ試合に対する3件のバロットを正解として作る。うち1件は結論が異なり、Voting Issue も違う | パネル結果の導出、少数意見の保存（M59）、`BALLOT_DUPLICATE`（M57） |
| 伝達評価の混入 | 「声が通っていて説得力があったので AD2 は強く残った」という段落を判定理由の正解に1件入れる | `communication_in_content` が candidate で立ち、自動除外されないこと（M60） |
| Strength=None | DA2 を None とし、残存リスクの記述を正解に含める | `residualNote` 必須の検証（M55） |
| Review Gate | Value turn の採否で勝者が変わる Issue を1件入れる | `REVIEW_REQUIRED`（M64。P12.3） |

**v01 を捨てない。** v02 は v01 の置き換えではなく追加である。v01 は「きれいな試合が正しく処理されること」を検証し続ける。
欠損入りのデータだけになると、正常系の回帰が薄くなる。**CI は両方を回す。**
