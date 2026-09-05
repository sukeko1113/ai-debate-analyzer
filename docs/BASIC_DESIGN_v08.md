# AI英語ディベート解析・ジャッジ支援

**基本設計書 v08**

実試合で検査した基盤に、HEnDA Judge Sheet準拠のAI Decision Support評価エンジンを統合する

2026年9月5日

> **v08の結論**
> v07で、実試合が示した欠損・自己紹介・複数バロット・表現力混入をスキーマまで取り込んだ。v08では、その上に「AIはどの基準でProbability / Value / Strengthを候補化し、どのclashをVoting Issue候補とし、どこで人間確認へ止まるか」という評価エンジンを統合する。
>
> 判定支援を三層に分ける。L1はHEnDA Judge Sheetと同じ語彙を使うOfficial Judge Layer、L2はA/B/Cノード・Support Quality・Attack/Defenseイベント・Rule State・counterfactualを持つInternal Analysis Layer、L3はHPとデリバリー分析を持つLearning Layerである。**Strength = Probability × Value** とし、Evidence/Warrantを独立係数として二重評価しない。
>
> AIは人間バロットを確定しない。内部数値を使ってAI Decision Supportを生成し、UIでは常に「AI参考判定」と表示する。Value turnの採否で勝者が変わる、Voting Issue候補が競合する、重大なUNVERIFIABLE/coverage gapが勝敗へ影響し得る場合は **REVIEW_REQUIRED** とし、自動断定を止める。
>
> v08は、評価を派手に自動化する版ではなく、「何を計算してよいか／何を公式表示に出してよいか／どこで止まるか」をDB・Zod・API・画面・受け入れ基準まで一貫させる版である。

**v07からの主な変更：**三層評価アーキテクチャ／Strength=P×V／A-B-C＋Support Quality／離散尺度＋scoring_config／clash_event台帳／Rule State Engine／Voting Issue二候補＋counterfactual leverage／Value turn Review Gate／Summary新Evidenceのcomparison-only化／AI Decision Supportと人間Ballotの完全分離／3フェーズ校正・ホールドアウト検証

## 0. v08で何を変えたか

### 0.0 v08で統合する評価エンジン

v08の入力は「英語ディベート AIジャッジ クライテリア・定量評価設計 v04」である。v07までの音声・Flow・Ballot基盤を捨てず、次のように役割を分けて統合する。

| 層 | v08での責任 | 既存v07との接続 |
|---|---|---|
| L1 Official Judge Layer | Judge Sheet語彙、AI参考Net sum、Voting Issue候補、Review Gate | judge_runs / judge_decisions と分離。人間Ballotは従来どおり |
| L2 Internal Analysis Layer | A/B/C、Support Quality、clash events、Rule State、P/V内部値 | argument_nodes / flow_links にスコアとイベントを追加 |
| L3 Learning Layer | HPタイムライン、話者別delivery | Debate Evolution / HP Viewを拡張 |

v07では「過程の記録は判定に入れない」としていた。v08ではこの文言を精密化する。**人間の公式バロットを自動計算するためには使わない**、という一線は維持する。一方、AIの参考判定（Decision Support）はL2の内部分析から決定的に計算してよい。AI参考判定と人間確定バロットを別テーブル・別画面・別APIに置くことで混同を防ぐ。

### 0.0.1 v08で確定する十二点

1. Strengthは独立軸ではなく `P × V`。
2. Evidence / Warrant / Relevance / BurdenはSupport QualityとしてProbabilityの理由に置く。
3. 論点をA=Observation、B=Link 1..n、C=Impactに分ける。
4. AIはカテゴリを出し、数値写像はscoring_configが行う。
5. Attack/Defense/Concession/Comparison等をclash_eventsに保存する。
6. 採用可否はRule State Engineで管理する。
7. Summaryの新Evidenceはcomparison-only。欠けた立証の後付けはINADMISSIBLE_LATE_REPAIR。
8. Voting Issueはsurvival_candidateとclash_candidateの二候補方式。
9. clash_candidateはconstructive_end snapshotへ戻すcounterfactualで算出する。
10. Value turnはimpact_directionをL2に持ち、勝敗が変わる場合はREVIEW_REQUIRED。
11. AI Decision Supportとhuman ballotは別保存し、AIがhuman ballotを書けないようにする。
12. 10試合pilot→30〜50試合calibration→別20〜30試合hold-outを品質ゲートへ組み込む。


v06は、v05が決めたことをスキーマまで貫通させる版だった。v07は視点が違う。書かれていることの整合ではなく、書かれていないことを実試合で探した版である。目的・正本・クラウド完結の方針・4パス構成・サーバ権威・保持レベル・判定に入れない一線は、いずれも変えない。

### 0.1 実試合1本で何が起きたか（v07から継承）

検査に使った資料は四つである。試合の書き起こし（話者特定済み）、論点フローシートと対立構造図、判定理由、審査委員長講評。いずれも第13回全国高校生英語ディベート大会 決勝（肯定側 竹園高校／否定側 藤島高校、論題：日本は積極的安楽死を合法化すべきである）のものである。

| 観点 | 実試合で観測されたこと | v06の設計 | v07の判断 |
|---|---|---|---|
| 担当者表 | 8名の座席（A1〜A4／N1〜N4）が①〜⑫のすべてで矛盾なく決まった。②の応答者＝①の立論者、④の質問者＝⑪の総括者、といった対応がすべて一致した | §8.3で担当者表を持っている | **設計どおり。**変更しない。むしろ§8.3の価値が実証された |
| 話者分離 | 自動話者分離の出力（Speaker 0〜15）は、同一人物が複数IDへ分割され、別人が同一IDへ統合されており、そのままでは使えなかった | §6.4で「話者分離は不要」 | **「不要」から「使わない」へ。**取り込み経路そのものを塞ぐ（§6.4） |
| 名乗り | 座席と氏名の対応は、12ステージの前にある開会・自己紹介ラウンドでしか取れなかった | 12ステージのみを保持。自己紹介は「アナウンス等」に埋もれる | **新設。**match_events に self_introduction を足し、名乗り区間を座席へ結び付ける（§3.5・§8.6） |
| 欠損 | 31:34〜41:59 の10分25秒が1区間として出力され、⑩否定ディフェンスと⑪肯定総括の本文が丸ごと失われていた | segment単位の audibility はあるが、ステージ単位の欠損を表す場所が無い | **新設。**stage_segments に coverage_status を持たせ、DROPS導出とロックの両方で扱う（§8.5・§9.3・§10.3） |
| 判定 | 5人の審判による4対1の分割判定だった | judge_decisions が1試合1件の前提 | **変更。**判定は1ジャッジ1票（バロット）。パネル結果はビューで導出する（§10.7） |
| 評価軸 | 審査委員長は、表現力と共感（vivid image、sympathy）を肯定側の勝因として語った。客観的な判定理由はそれを自律性の論証とSolvencyの再反論に置き換えて評価している | Communicationは勝敗と別枠、とだけ書いてある | **検出する。**判定理由の各段落に根拠種別を持たせ、伝達評価が内容判定の根拠になっていたら候補フラグを立てる（§10.6・§11.2） |
| リスクの扱い | 審査委員長はDAのリスクを「ほぼ無視できる」と述べた。客観的な判定理由は「ゼロではなく、大幅に低減された確率」として秤量すべきだとしている | Strength=None を根拠なしで置ける | **変更。**Strength=None には残存リスクの記述を必須にする（§10.1・§13.3） |
| 攻撃の型 | 主要な攻撃が「鎮静で足りるから安楽死は不要」「対象患者の85〜90%はせん妄で制度に乗らない」だった。前者は代替手段による代替可能性、後者は計画が対象へ届かないことの指摘である | effect_kind の値域にどちらも無い | **追加。**ATTACKSに alternative_solves と not_solvent、DEFENDSに alt_limited を足す（§9.6） |
| 質疑 | 「うつ病の患者に合理的な判断ができるのか」を肯定側が質疑で繰り返し問うたことが、審査委員長の講評でDA1の評価理由として名指しされた | ANSWERS の effect_kind は常に NULL | **限定解禁。**ANSWERSに admits / declines_to_answer を許す（§9.6） |

> **合成データでは出なかった、ということ自体が結論である**
> 付録GのGold Dataset v01は、TTSで作った明瞭な音声を、正解が分かっている形で組み立てる。この作り方では、上の表の右側4行は原理的に発生しない。欠損は仕込まなければ起きず、審判は1人しかおらず、講評は存在せず、攻撃の型は原稿を書いた人間の語彙を超えない。
> したがって「実試合で検証する」は、G0を通した後の確認作業ではなく、設計を書くための入力である。v08以降も、機能を足す前に実試合を1本読む。

### 0.2 v07で確定した九点（前版・参照用）

| # | 実試合が示した欠落 | v07の確定 |
|---|---|---|
| 1 | 座席と氏名の唯一の対応源である開会・自己紹介ラウンドが、どのテーブルにも入らなかった | match_events.kind に self_introduction を追加。transcript_segments.stage_no を NULL 可とし、NULL のときは event_id を必須にする（§3.5・§12.1） |
| 2 | §16.3が「名乗り区間を人が印付けする」と書いているのに、その印を持つ列が無かった | match_members に intro_segment_id / name_source / seat_binding_status を追加。保持レベルCの伏せ字対象がこの区間に確定する（§8.6・§16.3） |
| 3 | ステージ2つ分の本文が欠落しても、それを表す状態が無かった | stage_segments に coverage_status（complete / partial / missing）と coverage_note を追加（§8.5・§12.1） |
| 4 | 欠損ステージから DROPS が導出され、「応答しなかった」という誤った判定材料が生まれる | coverage_status ≠ complete のステージからは DROPS を導出しない。stage_coverage_gap を立てる（§9.3） |
| 5 | 欠損ステージの区間を根拠に引いたまま判定をロックできた | 409 GAPPED_STAGE_CITED を新設（§10.3・§14.2） |
| 6 | 10分25秒が1区間として出てきても機械が気づかなかった | ステージ長の妥当性検査を Pass S の後段に入れ、stage_duration_anomaly を立てる（§8.5） |
| 7 | 5人審判の4対1を記録できなかった | judge_decisions を1ジャッジ1票のバロット表として意味を確定し、UNIQUE(match_id, decided_by) を張る。パネル結果は判定ビューで導出する。matches に panel_size（奇数）を追加（§10.7） |
| 8 | Strength=None と判定理由の根拠種別に、書く場所が無かった | IssueAssessment に residualNote（Strength=None のとき必須）、JudgeDecision に compareNote と reasonGrounds を追加（§10.1・§11.2・§13.3） |
| 9 | 実試合の主要な攻撃と、質疑での譲歩が effect_kind で表せなかった | ATTACKSに alternative_solves / not_solvent、DEFENDSに alt_limited、ANSWERSに admits / declines_to_answer を追加（§9.6・§13.2） |

> **v07でも動かさない一線** 上の九点はいずれも記録の形の話である。勝敗を決めるのは judge_decisions の Probability / Value / Strength だけであり、coverage_status も reasonGrounds も residualNote も、判定を計算するために使わない。§12.4のビュー分離もそのまま維持する。新しく足した列のうち、判定の集計コードが読んでよいのは judge_decisions 自身の列だけである。

### 0.3 v06で確定した八点（参照用）

以下はv06で埋めた断絶である。v07では変更していないが、実装時にはv07の九点と合わせて一続きの要件として扱う。

| # | v05で実装を止めていた点 | v06の確定 |
|---|---|---|
| 1 | §9.5でroleにevidenceを足したのに、§13.2のZodは4値のままだった | ArgumentNode.role を present / effect / importance / evidence / other の5値に確定。otherの基準も明記（§9.5・§13.2） |
| 2 | §9.6のeffect_kind・effectivenessが、§12.1のflow_linksにも§13.2のFlowLinkにも無かった | 4列（effect_kind / effectiveness_ai / effectiveness_human / effectiveness_set_by）を確定。方向ごとの値域も定める（§9.6・§12.1・§13.2） |
| 3 | ComparisonAxisという型が受け入れ基準にだけ現れ、定義がどこにも無かった | summary_linksテーブルとComparisonAxis / SummaryLinkのZodを新設（§9.8・§12.1・§13.2） |
| 4 | 許諾の保管場所が無く、CONSENT_REQUIRED 409を実装できなかった | matchesに許諾4列を追加し、consent_scopeにexpert_referenceを含める（§12.1・§13.2・§16.2） |
| 5 | lock_versionを持つ表がtranscription_jobsだけで、楽観ロックの規約と食い違っていた | lock_versionを持つ表を列挙して確定する（§12.1・§14.1） |
| 6 | audibility=unheardのsegmentを根拠に引いたまま判定をロックできた | unheardを根拠に引いた判定はロックできない。UNHEARD_CITED 409を新設（§10.3・§14.2） |
| 7 | 実装・検証できない受け入れ基準が7件あり、参照と節番号が5箇所崩れていた | prepare検証・Pass A精度・RLS・HP隔離・キャッシュ・閾値を書き直し、第17章の節番号を修復（第17・18章） |
| 8 | 開発をWeb版で完結させる前提だったが、音声・Docker上のSupabase・実プロバイダのキーはいずれもクラウドセッションで扱いにくい | 主戦場をローカルの開発機へ移し、CLIとデスクトップアプリを併用する。Web版は補助（§17.6） |

> **v06で最も重要な一線** v05で足した情報は、判定に一切入らない。勝敗を決めるのは従来どおりjudge_decisionsのProbability / Value / Strengthだけである。effectiveness・比較軸・HPバー・熟練者コメントは、いずれも「なぜそう判定したか」を説明するためのものであって、判定を計算するためのものではない。v06では、この隔離をCIの静的検査だけに委ねない。判定の集計コードが読むのは列を絞ったビューjudge_flow_linksだけとし、effect_kindとeffectiveness_*にはSQLレベルで到達できない構成にする（§12.4）。

### 0.4 v02〜v07の主要決定（履歴）

| 項目 | v02 | v03 | v04 | v05 | v06 | v07 |
|---|---|---|---|---|---|---|
| 実行形態 | ローカル先行 | 最初からWeb | 変更なし | 変更なし | 変更なし | 変更なし |
| DBアクセス | 未定 | service role（矛盾） | Supavisor経由のPostgres接続 | 変更なし | 変更なし | 変更なし |
| 転写 | 差し替えの概念 | 2パス／4パス混在 | 4パス（A/S/B/C） | 変更なし | 変更なし | ＋ステージ長の妥当性検査を後段に追加 |
| API | 未定 | 未定 | API_SPEC.mdで確定 | 変更なし | ＋UNHEARD_CITED / CONSENT_REQUIRED を実装可能に | ＋GAPPED_STAGE_CITED / BALLOT_DUPLICATE |
| 判定の確定 | 人が確定 | 人が確定 | ＋ロック不変条件 | ＋判定に入らない情報の明示 | ＋unheardを引いた判定はロックできない | ＋1ジャッジ1票。パネル結果はビューで導出 |
| 議論の粒度 | AD/DAの塊 | 3論点に分解 | 変更なし | 4構成要素＋やりとりの効果 | ＋4構成要素と効果をスキーマへ反映 | ＋実試合に出た攻撃の型を値域へ追加 |
| 判定過程 | — | — | — | Debate Evolution View | 変更なし | ＋Clash View（導出） |
| 比較 | COMPARESリンク | 同左 | 同左 | 4軸を比較理由として保持 | ＋ComparisonAxisを型として定義 | ＋Compare欄と残存リスクの記述を必須化 |
| 音声の欠け | — | — | audibility（区間単位） | 変更なし | ＋unheardの引用を禁止 | ＋ステージ単位の欠損（coverage_status） |
| 話者 | 話者分離を想定 | 同左 | 担当者表から導出 | 変更なし | 変更なし | ＋自己紹介ラウンドからの座席結び付け。分離出力は取り込まない |
| 個人情報 | 一般的な注意 | 許諾とGit規約 | 保持レベルA〜E | ＋役割優先UI（匿名化と両立） | ＋許諾の保管場所とlock_versionを確定 | ＋名乗り区間の特定を列として保持 |
| ロードマップ | Phase 0〜7 | P0〜P16 | Phase A / B | ＋Phase C（参照DB） | ＋節番号の修復と実行環境の再定義 | ＋実試合検証を設計入力として常設（付録H） |

### 0.5 v02〜v07から変えないこと

以下は確定した設計思想であり、v07でも動かさない。実装の都合でこれらを曲げたくなった場合は、コードを変える前に本書を改訂する。

- 本アプリの第一目的は、自動で勝敗を当てることではない。発言を確認可能な形で記録し、公式形式のフローシートを作り、ジャッジシートの判定材料を整理し、勝敗の過程と理由を時刻付き根拠で説明できる資料を作ることである。
- 正本は第20回全国高校生英語ディベート大会ルール、HEnDA Judge Sheet、HEnDA Flow Sheetである。独自の採点体系を先に作らない。
- AIは候補を出し、人が確定する。自動処理が人間確認済みの状態を作ることはない。
- Strong / Weak / None などの**公式表示**を、独自の100点満点へ置換しない。L2の内部数値はAI Decision Supportの説明・校正に限り、公式人間バロットとは分離する。
- ジャッジが試合中に聞き取れなかった発言を、後から原稿や証拠資料で補って判定に使わない。
- 開発・検証・デプロイはクラウドで完結する。特定のPCに依存する工程を作らない。
- 実試合で観測された事実を、合成データの都合で設計から外さない。合成データで再現できない事象は、再現できないという事実のほうを記録する（付録H）。

## 1. クラウド完結の定義と、その帰結

### 1.1 「特定のPCに依存しない」を三条件で定義する

この要件は曖昧に扱うと守れない。次の三条件をすべて満たす状態を「クラウド完結」と呼ぶ。

| 条件 | 内容 | 設計上の帰結 |
|---|---|---|
| (a) 交換点はGitHubだけ | ソースコード、設計書、fixture、CI定義のすべてがリポジトリに入っている。ローカルにしか存在しないファイルを前提にしない。 | 手元のExcelやメモに書いた仕様は存在しないものとして扱う。指示書もリポジトリに置く。 |
| (b) 実装・テスト・デプロイがクラウドで閉じる | 誰がどこで書くかは問わない。GitHub Actionsが検証し、Vercelが配信する。人がPCでビルドする工程を必要としない。開発をローカルで行うこと自体はこの条件に反しないが、手元にしかないファイルや絶対パスをリポジトリの前提にしない（§17.6）。 | PyInstaller、Inno Setup、Windows専用テストのような工程を持ち込まない。 |
| (c) 実行時に管理者PC固有の環境を要求しない | サーバ側にffmpeg.exeやffplay.exeを置かない。OS固有のパスや事前インストール済みバイナリに依存しない。 | 音声処理はブラウザの標準機能か、必要な場合のみブラウザ内WebAssemblyで行う。 |

### 1.2 なぜローカル版を先に作らないのか

v02は、42分の音声処理・ffmpeg・細かい区間再生がwhosaid-editorのWindows資産と相性がよいことを理由に、ローカル先行を推奨していた。技術的な相性についてはそのとおりである。問題は別のところにある。

whosaid-editorのCLAUDE.mdは、リポジトリの位置がC:\dev\01配下であること、作業前に.venvを有効化する必要があること、ffmpegとffplayがWinGetで導入済みであること、pytestでは一部のテストが黙ってスキップされるため個別実行が必要であることを前提としている。これは、人がその机に座っていて、画面を見ながら確かめられる状況を織り込んだ設計である。開発をローカルに置く場合でも、この構図は変わらない。エージェント自身が実行して結果を確認できる形にそろえないと、実装は進むのに検証だけが滞る。だから判定者はCIに置き、手元の環境を前提にした工程を作らない（§17.6）。

> **誤解を避けるための注記** ローカル処理そのものを否定しているのではない。録音を外部に出せない案件では、whosaid-editorをローカルで使い、その作業JSONを本アプリへ取り込む経路を正式にサポートする（§6.7）。禁止するのは「本アプリの動作が特定のPC環境に依存すること」であって、「ユーザーが手元で前処理すること」ではない。

### 1.3 AIコーディングエージェントに検証できないこと

この設計で最も注意すべき点は、開発を担うエージェントが音を聞けないことである。テストが通ることと、実際に正しい位置の音が鳴ることは別である。受け入れ基準を作る前に、この境界を明示しておく。

| 対象 | エージェント
による検証 | 確かめる主体と方法 |
|---|---|---|
| 型・スキーマの整合、状態遷移、集計、ルール検査の分岐 | 可能 | CI（単体テスト・fixture回帰） |
| fixtureに対する検出精度（New Argument、担当者違反、語数超過など） | 可能 | CI（正解付き合成データ） |
| アンカー照合の正しさ | 可能 | CI（テキストと単語時刻のfixtureのみで完結する。音声は不要） |
| Word / PDF / JSONの生成と構造 | 可能 | CI（生成物のパースと必須項目チェック） |
| 音が鳴るか、区間再生が意図した位置か | 不可能 | 人が再生して確認 |
| 発言が聞き取れるか（audibility） | 不可能 | 人が耳で確認 |
| 話者が誰か | 不可能 | 人が確認。ただし本アプリではステージ確定により大部分が自動決定（§6.4） |
| ステージ境界が実音と一致しているか | 不可能 | 人が波形と音で確認 |
| 判定・解説の妥当性 | 不可能 | HEnDA経験者によるレビュー |

> **最も起きやすい失敗** エージェントは「テストが通った」を「正しく動いた」として報告しがちである。音に関わる機能は、テストが通っても人が耳で確認するまで完了としない。第17章の受け入れ基準はこの前提で書いてある。

## 2. 目的・利用者・成果物

### 2.1 目的（v02からの継承）

HEnDA方式の英語ディベート試合を、あとから検証できる議論データに変換する。入力は録音・録画された試合であり、ユーザーは音声を聴き、必要なら映像を確認しながら、AIが提案した文字起こし・論点構造・判定案を修正し確定する。

> **設計原則** 「AIがジャッジの代わりに決める」ではなく、「人間ジャッジが何を聞き、どの議論を追い、なぜその判定に至ったかを、再現可能な形にする」。

### 2.2 主な利用者

- HEnDA大会・県大会等のジャッジ：フロー作成と判定理由の整理
- 顧問・指導者：試合後の振り返り、選手への説明、ジャッジ研修
- 高校生・初心者：動画を見ながらフローの書き方と判定の考え方を学ぶ
- 大会運営者：許諾を得た試合の記録・教材化・ジャッジ間比較
- 研究・開発：AI解析と人間ジャッジの一致／不一致の検証

### 2.3 1試合から生成する7成果物（v08で再整理）
v08ではAI参考判定と人間Ballotを成果物として分離するため、1試合から生成する成果物を7系統に整理する。

| No. | 成果物 | 役割 | 形式 |
|---|---|---|---|
| 01 | タイムスタンプ付き逐語／準逐語記録 | 発言を原音へ戻して確認。話者・side・stage・coverageを保持 | 画面／JSON／Word |
| 02 | デジタルFlow Sheet | A/B/C、Evidence、Attack / Defense / Summary、Rule Stateの対応 | 画面／JSON／Word |
| 03 | AI Decision Support Sheet | 内部P/V/Strength、公式カテゴリ候補、Net sum、Voting Issue二候補、Review Gate | 画面／JSON／Word（参考判定表記） |
| 04 | Human Judge Sheet / Ballot | 人が確定したProbability / Value / Strength、Winner、Voting Issue、Communication | 画面／Word |
| 05 | 判定理由メモ | 残存論点、崩れたリンク、決定的clash、比較、時刻根拠 | Word／JSON |
| 06 | 試合解説・学習レポート | Debate Evolution、Clash、HP、学習ポイント | Word／画面 |
| 07 | 検証・ジャッジ間比較 | AI提案・人間修正・scoring_config・複数Ballot一致/不一致 | 画面／JSON |

PDF化はサーバでは行わない。公式Judge Sheetに近い出力はWord側で用紙・余白・表幅を固定し、必要ならユーザー側でPDF化する。
### 2.4 MVPの対象外

- リアルタイム公式判定の完全自動化
- AIの判定を人間の最終判定より優先する運用
- 3Dキャラクター等の観戦ゲーム演出
- 公開動画の無断ダウンロード機能
- 複数ジャッジの同時共同編集（Phase後半で検討）

## 3. HEnDA公式形式を正本とする

### 3.1 1試合の12ステージ

| No. | Stage | 日本語 | 時間 | 解析上の役割 |
|---|---|---|---|---|
| ① | AFF Constructive | 肯定立論 | 4分 | Plan ＋ Advantage（最大2） |
| ② | Questions from NEG | 否定側質疑 | 2分 | 直前のAFF立論を確認・検証 |
| ③ | NEG Constructive | 否定立論 | 4分 | Disadvantage（最大2） |
| ④ | Questions from AFF | 肯定側質疑 | 2分 | 直前のNEG立論を確認・検証 |
| ⑤ | NEG Attack | 否定アタック | 3分 | AFF Advantageの証明を攻撃 |
| ⑥ | Questions from AFF | 肯定側質疑 | 2分 | 原則NEG Attackを確認・検証 |
| ⑦ | AFF Attack | 肯定アタック | 3分 | NEG Disadvantageの証明を攻撃 |
| ⑧ | Questions from NEG | 否定側質疑 | 2分 | 原則AFF Attackを確認・検証 |
| ⑨ | AFF Defense | 肯定ディフェンス | 3分 | AFF Advantageを再構築 |
| ⑩ | NEG Defense | 否定ディフェンス | 3分 | NEG Disadvantageを再構築 |
| ⑪ | AFF Summary | 肯定総括 | 3分 | 双方を要約・比較しAD ＞ DAを主張 |
| ⑫ | NEG Summary | 否定総括 | 3分 | 双方を要約・比較しDA ＞ ADを主張 |

準備時間は①後1分、③後1分、④後2分、⑧後2分、⑩後2分。スピーチ計34分と準備時間計8分で、公式フォーマットの42分は「計時対象の合計」である。チェアパーソンのアナウンスと入退場はこの42分に含まれないため、実際の録音は45〜50分になる。アプリは計時対象の12ステージをstage_segmentsに、準備時間とアナウンスをmatch_eventsに、それぞれ別イベントとして保持する（§12.1）。トークン量とストレージの見積りは実ファイル長（既定50分）で行う（§19.1）。

### 3.2 立論の内部構造
Advantage / Disadvantage はいずれも最大2つ。v07のPresent / Effect / Importance / Evidenceという4構成要素を、v08では**3ノード＋Support Quality**へ統合する。Judge SheetのProbabilityがEvidenceを含むため、Evidenceを独立係数として二重加点しないためである。

| ノード | AFF Advantage | NEG Disadvantage | 主なAttack |
|---|---|---|---|
| A. Observation | 現状に問題がある / Necessity / Inherency | 現状では悪影響が起きていない / Uniqueness | NOT_NECESSARY / NOT_UNIQUE |
| B. Link 1..n | Plan → Effect / Solvency / Process | Plan → DA / Link / Process | NO_EFFECT / alternative_solves / not_solvent |
| C. Impact | 利益の重要性・規模・期間・不可逆性 | 被害の重要性・規模・期間・不可逆性 | NOT_IMPORTANT / VALUE_TURN |

各A/B/CにはSupport Qualityを付ける。

- `EVIDENCE`: 出典・媒体・年・専門家肩書・原文開示・独自計算の適切性
- `WARRANT`: EvidenceからClaimへつなぐ論理の妥当性
- `RELEVANCE`: 当該Evidenceが対象Claimを直接支えるか
- `BURDEN`: その主張に必要な立証責任を満たしているか

Support Qualityはスコアの別係数にしない。A/Bノードの0〜4カテゴリを決める理由として保存する。CはValue（Impact）の内部評価に対応する。
### 3.3 Attack / Defense / Summaryの制約
- Attackは相手AD/DAのA/B/Cのどこを攻撃しているかを必ず持つ。主種別は NOT_NECESSARY / NOT_UNIQUE / NO_EFFECT / NOT_IMPORTANT / VALUE_TURN。EVIDENCE / RELEVANCE / BURDENは任意ノードへのSupport Quality攻撃として持てる。
- Defenseは親Attackへ `parent_event_id` で紐づけ、自陣ノードの再構築として記録する。親Attackと無関係な新規論点ずらしは回復として扱わない。
- Droppedは「応答機会があり、coverageがcompleteで、Defenseで応答しなかった」場合だけ成立する。missing/partial stageから自動導出しない（v07の欠損原則を維持）。
- Summaryは既出議論の要約・比較・weighingを行う。新Attack、新AD/DA、新Planは禁止候補。
- Summaryで初出のEvidenceでも、**既出論点どうしを深く比較するだけ**なら `ADMISSIBLE_NEW_EVIDENCE_FOR_COMPARISON` として扱える。ただしA/B/Cのノード値を上げない。
- 立論またはDefenseで欠けていたObservation / Link / ImpactをSummaryのEvidenceで初めて成立させるものは `INADMISSIBLE_LATE_REPAIR` とする。
- 否定アタック後の肯定アタック⑦で直前⑤への再反論を行う等、スピーチ役割を先取りするものは `INADMISSIBLE_PREMATURE_REBUTTAL` 候補とする。
- 境界事例はAIが理由とconfidenceを出し、人間がconfirm/rejectできる。AIだけでhuman ballotから除外しない。
### 3.4 機械可読化するルール（v03で追加）

v02はスピーチ順とAD/DA構造までを機械可読化の対象としていた。大会ルールを読み直すと、判定に直結し、かつ確定transcriptから機械的に確認できる規定が他にもある。これらをruleset packに含める。

| ルール | 出典 | 機械化の内容 | 出力フラグ |
|---|---|---|---|
| スピーチ担当者表（A1〜A4／N1〜N4、3人／4人チーム別） | 2.2 | 各ステージの発言者が担当表と一致するかを照合 | speaker_role_mismatch |
| 立論600語・平均150 wpm上限 | 2.1.10 | 確定transcriptから語数と発話速度を算出 | over_word_limit / over_speech_rate |
| 終了後10秒ルール | 2.2.3 | ステージ終了時刻＋10秒以降の発話を判定対象外候補に | over_time |
| AD/DAは各側最大2 | 2.1.1.3 / 2.1.2.1 | 3つ目以降を主要2つ以外として除外候補に | extra_issue |
| 新しい議論の禁止 | 4.2.2 | Defense / Summaryでの初出要素を検出 | new_argument |
| 引用時に必ず述べる事項（出典・年度・氏名・肩書等） | 3.2.1 | 証拠引用の直前に必須要素が読み上げられているかを確認 | evidence_incomplete |
| 独自計算による推定値の扱い（2025年追加） | 3.2.1.1 | 「自分で計算した」宣言と、元データの出典読み上げの有無を確認 | own_calculation |
| コミュニケーション点1〜5 | 4.3 | 勝敗判定と分離して記録。減点事由は人が入力 | （勝敗と非連動） |

> **重要** これらはすべて候補である。自動で判定から除外しない。大会ルール4.2.2は「新しい議論であるかどうかの判断は、相手チームからの抗議の有無に左右されず、ジャッジが行う」と明記している。アプリはジャッジの注意を向けるだけで、判断を代行しない。

### 3.5 12ステージの外側（v07で追加）

実試合の書き起こしは、①肯定立論の前に開会と自己紹介が置かれていた。8名全員が順に立ち、名前と担当（constructive speaker / attack / defense / summary）を述べている。この区間は計時対象ではなく、判定材料でもない。しかし設計上は無視できない。座席（A1〜N4）と氏名を結び付ける情報が、試合を通してここにしか無いからである。

| 区間 | 実試合での例 | 保持先 | 判定での扱い |
|---|---|---|---|
| 開会・自己紹介 | 00:12〜05:30 前後。8名が順に名乗る | match_events（kind='self_introduction'）＋ transcript_segments（stage_no は NULL、event_id を持つ） | 判定材料にしない。根拠として引用できない |
| チェアパーソンのアナウンス | 「We will now have a brief introductions from the negative side members.」 | match_events（kind='announcement'） | 同上。ステージ境界の手掛かりとしてのみ使う |
| 準備時間 | ①後1分、③後1分、④後2分、⑧後2分、⑩後2分 | match_events（kind='prep'） | 同上 |
| スピーチ冒頭の名乗り | 「My name is ○○. I'm a constructive speaker from the affirmative side.」 | transcript_segments（stage_no あり）＋ match_members.intro_segment_id | 保持レベルCで伏せる対象（§16.3） |

> **なぜ transcript_segments に入れるのか**
> 別テーブルにすると、名乗り区間の削除・伏せ字・時刻照合を二重に実装することになる。実際に消す必要があるのは自己紹介ラウンドの本文であり、そこを別の系統に置くと保持レベルCの削除が片方だけ通る事故が起きる。
> したがって stage_no を NULL 可にし、NULL のときは event_id を必須にする（CHECK制約）。判定の根拠として引けるのは stage_no が 1〜12 の区間だけ、という規則も同じ制約で書ける。

> **名乗りは二か所にある** 自己紹介ラウンドの名乗りと、各スピーチ冒頭の名乗りである。実試合では両方に氏名が入っていた。座席の結び付けには前者を使い、保持レベルCで伏せる対象には両方を含める。片方だけ伏せると、音声を消していない限り復元できてしまう。

### 3.6 評価の三層アーキテクチャ（v08で追加）

```text
音声・逐語記録
   ↓
L2 Internal Analysis Layer
  A/B/C + Support Quality
  clash_events + Rule State
  constructive snapshot
   ↓                 ↘
L1 AI Decision Support   L3 Learning / HP
  P/V/Strength             HP timeline
  Net sum                  delivery
  Voting Issue candidates
  Review Gate
   ↓
Human Ballot（別系統。人が確定）
```

L1の名称に「Official」を含めるのは、**HEnDA公式語彙へ写像する層**という意味であり、AIの出力が公式判定になるという意味ではない。UIでは必ず「AI参考判定」と表示する。人間の`judge_decisions`は別系統であり、AI処理から直接INSERT/UPDATEできない権限制御を行う。

内部分析値は次の目的にのみ使用する。

1. AI参考Decision Supportの再現可能な計算。
2. Voting Issue候補とcounterfactualの説明。
3. 学習・観戦用HP。
4. 校正・研究。

人間バロットのwinner/Probability/Value/Strengthを、内部数値から自動確定するためには使わない。

## 4. システム構成（確定）

### 4.1 技術スタック

| 層 | 採用 | 理由 |
|---|---|---|
| フロントエンド | Next.js（App Router）＋ React ＋ TypeScript | ai-english-debateと同一。AIコーディングエージェントの参照実装が安定しており、古い書き方が混入しにくい |
| 型・検証 | Zod | スキーマを唯一の定義とし、JSON Schemaを生成物として出す |
| DB | Supabase PostgreSQL（東京 ap-northeast-1） | リージョンは作成後変更できないため作成時に指定 |
| DB接続 | postgres.js ＋ Supavisor（transaction mode / 6543） | Data APIを使わないための正規経路。prepared statementは使えないためprepare: falseが必須（§4.2） |
| クエリ層 | Drizzle ORM ＋ drizzle-kit | 型がスキーマから出る。マイグレーションSQLをリポジトリに残せる |
| ストレージ | Supabase Storage（非公開バケット） | 署名付きURLとTUS resumable uploadを使う |
| 認証 | Supabase Auth | MVPはメール招待制。学校アカウントとRLSはPhase後半 |
| ホスティング | Vercel（Fluid compute） | Next.jsとの適合。実行時間上限を前提にジョブを設計する（§4.4） |
| API | Next.js Route Handler ＋ defineHandler | 全エンドポイントを同じ形で書く。認可・検証・楽観ロック・監査を一箇所に集約（第14章） |
| CI | GitHub Actions | 型・lint・単体・スキーマ検証・fixture回帰。音声を要するテストは入れない |
| 文書生成 | docx（npm） | 既存の文書生成資産と同じ。サーバでのPDF化は行わない |
| 転写 | TranscriptionProvider アダプタ | Pass A（単語時刻）とPass B（逐語）で別providerを許す（第6章） |
| 解析・判定支援LLM | サーバ側からのみ呼ぶ | APIキーをクライアントに出さない。出力は必ずsuggested層に入る |

### 4.2 DB接続方式（v04で確定）

v03には矛盾があった。「Data APIを無効にする」と書きながら、「service role keyでDBへアクセスする」とも書いていた。supabase-jsからのDBアクセスはPostgREST、つまりData API経由なので、この二つは両立しない。実装を始めた時点で必ず手が止まる。

| 用途 | 経路 | 認証情報 |
|---|---|---|
| DB読み書き | Next.js Server → Supavisorプーラー（transaction mode / 6543）→ Postgres | DATABASE_URL（専用ロール app_server） |
| マイグレーション | CI → session mode（5432）または direct connection | DIRECT_URL（app_migrator） |
| Storage | サーバから署名URL発行・削除 | SUPABASE_SERVICE_ROLE_KEY |
| Auth | JWT検証、招待などの管理操作 | SUPABASE_SERVICE_ROLE_KEY |
| ブラウザ | Auth（ログイン）と Storage（TUSアップロード）のみ | NEXT_PUBLIC_SUPABASE_ANON_KEY |

> **実装で必ず踏む三つの落とし穴**
> 1. transaction mode（6543）は prepared statement を使えない。postgres.js では prepare: false を必ず指定する。指定を忘れると本番でだけ落ちる。
> 2. マイグレーションは session mode / direct（5432）で流す。transaction modeでは CREATE INDEX CONCURRENTLY などが通らない。
> 3. postgres スーパーユーザーで接続するとRLSが素通りする。専用ロール app_server（NOSUPERUSER / NOBYPASSRLS）を作り、各リクエストのトランザクション冒頭で SET LOCAL app.actor_id を発行する。

service role key の用途は Storage と Auth に限定する。DBアクセスには使わない。これにより「ブラウザからDBへ到達する経路が存在しない」という状態を、設定ではなく構成で保証できる。

### 4.2.1 Supabaseプロジェクトは既存と分ける

ai-debate-matchが使っている既存プロジェクトに相乗りしない。保持するデータの機微度、削除・保持ポリシー、RLSとストレージポリシーの設計がいずれも違うためである。新規プロジェクトも東京リージョン、Data APIは無効のままとする。

### 4.3 実行時間の制約とジョブ粒度

Vercel FunctionsはFluid computeで全プラン既定300秒である。Hobbyはこの300秒が上限でもあり、引き上げられない。Pro / Enterpriseは800秒まで（さらに1800秒がベータ）。本アプリはHobbyでも動くことを前提にするため、300秒を超えるジョブを作らない。42分の音声を1回の同期呼び出しで処理する設計にしてはならない。

> **ジョブ粒度の原則**
> 1ジョブ＝2〜4分の音声、または純粋な計算処理とする。300秒以内に確実に終わる粒度に割る。
> 失敗したジョブだけを再実行できるようにする。全体をやり直さない。
> ジョブは冪等にする。同じ入力で二度走っても結果が壊れない。

### 4.4 環境変数

| 変数 | 用途 | 公開範囲 |
|---|---|---|
| NEXT_PUBLIC_SUPABASE_URL | Supabaseプロジェクト | クライアント可 |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | 認証のみ | クライアント可 |
| SUPABASE_SERVICE_ROLE_KEY | Storage と Auth の管理操作。DBには使わない | サーバのみ |
| DATABASE_URL | DB読み書き（Supavisor transaction mode / 6543・app_server） | サーバのみ |
| DIRECT_URL | マイグレーション（session mode / 5432・app_migrator） | CIのみ |
| TRANSCRIBE_A_PROVIDER / TRANSCRIBE_A_KEY | Pass A（単語時刻） | サーバのみ |
| TRANSCRIBE_B_PROVIDER / TRANSCRIBE_B_KEY | Pass B（逐語） | サーバのみ |
| ANALYSIS_MODEL / ANALYSIS_KEY | 論点抽出・判定支援 | サーバのみ |
| RULESET_DEFAULT | 既定のruleset id（例：henda-20） | サーバのみ |
| JOB_CRON_SECRET | Vercel Cronからのジョブ実行認可 | サーバのみ |

## 5. メディアの入力・保管・再生

### 5.1 入力の原則

- 必須入力は音声（mp3 / m4a / wav）。動画は任意の付随情報として扱う。
- 動画しか手元にない場合は、ブラウザ内で音声を抽出してからアップロードする（§5.4）。サーバにffmpegを置かない。
- 公開動画の無断ダウンロード機能は実装しない。利用権限が確認できる入力経路のみを提供する。

### 5.2 ファイルサイズと料金プランの関係

この制約は設計に直接効くため、数字で確定させておく。制約は二つあり、混同しやすい。第一に、Supabase Storageのグローバル上限（ファイル単体の上限）は、Freeプランでは50MBを超えて設定できない。Proプラン以上では最大500GBまで設定できる。第二に、Freeプランの総ストレージ容量は1GBである。1試合20〜30MBなので、Freeのままで保管できるのは30〜50試合が目安になる。あわせてFreeはDB容量500MB、1週間の無活動でプロジェクトが一時停止、アクティブプロジェクトは2つまでという制約がある。また6MBを超えるファイルはresumable upload（TUS）を使うことが推奨されており、専用ストレージホストを使うと大きなファイルの転送性能が上がる。

| 入力 | 42分あたりの概算サイズ | Freeプランで通るか |
|---|---|---|
| 音声 mono 64 kbps（mp3 / m4a） | 約20 MB | 通る |
| 音声 mono 96 kbps | 約30 MB | 通る |
| 音声 stereo 128 kbps | 約40 MB | 通る（上限に近い） |
| 動画 mp4（720p 中程度） | 300 MB〜1 GB | 通らない。Pro以上が必要 |

> **入力規約（確定）** MVPの入力規約は「音声・mono・64〜96 kbps・50 MB以下」とする。この規約なら、Supabase Freeプランのままでも1試合が最後まで通る。ただし総容量1GBは30〜50試合で埋まるため、保持レベルAの削除運用（§16.3）を最初から回すか、早期にProへ移る。動画を保管したい場合はPro以上を要求する。なおGeminiは音声を16 kbpsへダウンサンプルするため、ビットレートを上げてもPass Bの転写品質には効かない。64ではなく96 kbpsを選ぶ理由は、人が聴いてaudibilityを判定するためである。

### 5.3 保管とアクセス

- バケットは非公開。パスは media/{match_id}/{sha256}.{ext}。
- DBにはURLを保存しない。保存するのはパス、source_sha256、duration_ms、mime、bitrate、channels。
- 再生用の署名URLは短命（既定15分）とし、必要になった時点でサーバが発行する。
- 6MBを超えるアップロードはTUS resumable uploadを使い、直接ストレージホスト（project-id.storage.supabase.co）へ送る。

### 5.4 動画からの音声抽出

動画しかない場合、ブラウザ内でffmpeg.wasmを使い、16 kHz mono・64 kbpsの音声に変換してからアップロードする。この処理はユーザーの端末で走るが、特定のPCを要求するものではない。ブラウザさえあれば、どの端末でも同じように動く。

| 論点 | 決定 |
|---|---|
| SharedArrayBufferの要求 | 対象ページにCOOP / COEPヘッダを設定する。Next.jsのheaders設定で該当ルートのみに限定する |
| 対応する入力サイズ | 2 GB未満。これを超える動画は、ユーザー側で音声を書き出してから読み込ませる |
| 失敗時 | 抽出に失敗した場合は音声ファイルの直接指定へ誘導する。サーバ側でのフォールバック変換は行わない |
| 元動画の保管 | 任意。保管しない場合でも、再生位置は元動画のタイムコードと一致させる |

### 5.5 同一性の判定

同じ音声に対する再解析なのか、別の音声なのかを機械的に判定できるようにする。

- source_sha256：Web Cryptoでストリーミング計算した元ファイルのSHA-256。
- duration_ms と mime：補助的な一致確認に使う。
- whosaid-editorが持つBLAKE2b 64bitの音声指紋は、インポート時に import_meta.original_fingerprint として保持するだけとし、アルゴリズムは移植しない。

### 5.6 区間再生

ここはwhosaid-editorの操作感をそのまま持ち込む。ただし実装はブラウザ標準のメディア要素で行い、ffplayに相当するものは持たない。

| 機能 | 実装 | 既定値 |
|---|---|---|
| 区間再生 | HTMLMediaElement の currentTime を区間先頭に置き、区間末尾で停止 | — |
| 前後の余白 | 区間の前後に余白を付けて鳴らす | 前1.0秒／後0.5秒 |
| 前後の確認 | 5秒前から／この先30秒 | whosaid-editorと同じ |
| キーボード操作 | Space：再生停止、↑↓：区間移動、Tab：未確認の次へ、Ctrl+S：保存 | 同上 |
| 再生速度 | 0.75 / 1.0 / 1.25 / 1.5 | 1.0 |

## 6. 転写パイプライン（確定）

### 6.1 解くべき問題

v02は「エンジンは差し替え可能にする」とだけ書いていた。実務上の要点は二つである。長尺を処理しきれるか、そして時刻が信用できるか。v03はここで2パスと4パスの表記が割れていた。v04は4パス（Pass A / S / B / C）に統一する。

whosaid-editorはこの二つ目で苦労しており、Geminiのタイムスタンプがドリフトする既知の問題に対して、按分補正（redistribute_times）と細切れ行の連結（merge_consecutive）で凌いでいる。その後、本文はGeminiの逐語モード、時刻はfaster-whisperの単語時刻という役割分離に到達した。同プロジェクトの技術方針書は、この分離が効いている理由を明確に書いている。whisperは時刻を測る物差しとしてしか使っていないため、whisperがフィラーを落としても本文からフィラーが消えることは構造的にない。

本アプリはこの結論をクラウドへ移す。ただし、クラウドでfaster-whisperを常時動かすのは第1章の三条件と相性が悪い。そこで、単語時刻を返すAPIをPass Aのproviderとして扱い、照合ロジックだけを自前で持つ。

### 6.2 4パス構成

| パス | 目的 | 入力 | 出力 | 実行単位 |
|---|---|---|---|---|
| Pass A<br>アライン | 時刻の物差しを作る | 音声全体 | 単語と時刻の列 | 1ジョブ（provider側が長尺を処理） |
| Pass S<br>ステージ推定 | 12ステージ境界の候補を作る | Pass A出力＋定型句辞書＋公式時間 | 境界候補と信頼度 | 1ジョブ（純粋計算） |
| Pass B<br>逐語転写 | 判定に使う本文を作る | 音声＋ステージの時間範囲 | ステージ単位の逐語テキスト | 12ジョブ（ステージ単位） |
| Pass C<br>照合 | 本文と実測時刻を突き合わせる | Pass A出力＋Pass B出力 | 区間ごとの確定時刻と被覆率 | 1ジョブ（純粋計算） |

> **Pass Bをステージ単位に割る三つの効果**
> 1. 1回の呼び出しが3分前後の音声に収まり、関数の実行時間内で確実に終わる。
> 2. モデルに与える時間範囲が短くなるため、タイムスタンプのドリフトの絶対量が小さくなる。
> 3. 失敗したステージだけを再実行できる。42分をやり直さなくてよい。

### 6.3 Pass Bの実装前提（Gemini）

Gemini APIは音声を1秒あたり32トークンとして扱う（1分＝1,920トークン）。実ファイル50分の試合は約96,000トークンに相当する。1プロンプトあたりの音声長は最大約9.5時間であり、50分は余裕で収まる。また、MM:SS形式で範囲を指定した転写を要求できる。Geminiは入力音声を16 kbpsへダウンサンプルし、多チャンネルは1チャンネルへ統合する。

- 音声はFiles APIへ1回だけアップロードし、以降はfile URIを使い回す。ステージごとに音声を切り出さない（＝ffmpegが不要になる）。
- 各ステージの呼び出しでは、Pass Sが決めた範囲をMM:SSで指定し、その範囲の逐語転写だけを求める。
- 逐語モードの指示（フィラー・言い直しを残す、整文しない）を必ず含める。
- コンテキストキャッシュを使えるproviderでは利用する。ただしキャッシュはGemini固有の機能であり、§6.6のprovider契約には含まれない。providerがcapabilities.contextCacheをtrueと宣言した場合にのみ、キャッシュ利用の確認を受け入れ基準に含める（§17.3 P8）。キャッシュが効かない場合の入力トークン量は§19.1で見積もる。

### 6.4 Pass Aのprovider要件と、話者分離が不要な理由

| 要件 | 内容 | 必須 |
|---|---|---|
| 単語単位の時刻 | word / start / end の列を返す | 必須 |
| 長尺対応 | 42分以上を1リクエストで受ける、または非同期ジョブとポーリングを提供する | 必須 |
| URL入力 | 署名付きURLを渡せる（ファイル本体をサーバ経由で中継しない） | 推奨 |
| 話者分離 | 話者ラベルを返す | 使わない（返ってきても取り込まない） |
| 単語時刻の精度 | 合成fixtureに対する単語境界の誤差が、中央値0.3秒以内・95パーセンタイル1.0秒以内 | 必須 |

> **設計上の重要な差分**
> whosaid-editorが解いていた最大の難問は「誰が言ったか」だった。会議では発言順が決まっていないため、声質クラスタと人手の突き合わせが必要になる。
> HEnDAは違う。発言順は12ステージで固定され、どのスピーチを誰が担当するかは大会ルール2.2の担当者表で決まっている。したがってステージ境界さえ確定すれば、話者はほぼ自動的に決まる。
> 本アプリは、話者割当に使っていた人手を「どの論点に対する発言か」の確定に振り向ける。これが本アプリとwhosaid-editorの役割の違いであり、UIの重心の違いでもある。
> 話者分離を「不要」から「使わない」へ変えた理由（v07） 実試合の書き起こしでは、自動話者分離の出力が Speaker 0〜15 の16ラベルに割れていた。8名の試合である。同一人物が複数のIDへ分割され、別人が同一のIDへ統合されており、そのままでは座席の割当に使えなかった。実際に座席が決まったのは、開会の自己紹介で述べられた氏名と、大会ルール2.2の担当者表を突き合わせた経路である。①→②の応答、④の質問者と⑪の総括者、⑥の質問者と⑨のディフェンス担当が、いずれも矛盾なく一致した。
> 問題は、分離出力が「不要」なだけなら害が無いのに対し、実際には害があることである。誤ったラベルが画面に出れば、人はそれを起点に確認を始めてしまう。担当者表から導出した割当のほうが正確なのに、AIが付けたラベルと食い違ったときに、どちらを信じるかという判断が発生する。したがってv07では、providerが話者ラベルを返しても取り込まない。align_words に speaker 列を作らず、§6.7のインポート経路でも speakers[] は座席への対応づけの入力としてのみ使い、ラベルそのものを保存しない。
> 精度を必須要件に入れた理由（v06） v05まで、Pass Aのprovider要件は単語時刻・長尺対応・URL入力・話者分離の4項目だけで、精度の閾値がなかった。一方でP6は「境界誤差2秒以内」、G2は「誤差中央値0.5秒以内」を要求している。時刻の物差しであるPass Aに精度要件がないまま、その物差しを使う工程に精度を求めると、達成不能な受け入れ基準になる。§6.1で挙げたタイムスタンプのドリフトは既知の問題なので、provider選定の段階で測る。

### 6.5 Pass Cのアンカー照合

whosaid-editorのanchor.pyは、正規化した本文と実測の単語列を区間ごとの時間窓の中で突き合わせ、一致した文字の時刻から区間の始まりと終わりを引き直す。全文どうしをdifflibに掛ける方式は52分の会議で66秒かかり、区間ごとに窓を切ると0.16秒で済むという実測がある。速さ以上に効くのは、窓の外にある同じ語句への誤マッチが構造的に起きなくなることである。

> **移植方針** anchor.pyは純粋関数だけで書かれており、音声もモデルも要らず、テキストと単語のfixtureだけでテストできる。したがってTypeScriptへ移植したうえで、CIで完全に検証できる。音声系ロジックのうち、エージェントが自力で正しさを確認できる数少ない部分である。移植時は元実装のMITライセンス表記を残す。

- 窓幅：区間の推定時刻 ± 30秒を既定とする。
- 正規化：NFKC、記号落とし、大文字小文字の統一。元の位置へ戻る写像表を保持する。
- 被覆率が閾値（既定0.6）未満の区間は「照合できなかった」として返し、時刻を書き換えない。
- 補間による時刻推定は行わない。whosaid-editorが線形補間を試作したうえで不採用としている。

### 6.6 TranscriptionProvider インタフェース

```ts
// packages/core/src/transcription/provider.ts

export type WordToken = {
  word: string;
  startMs: number;
  endMs: number;
  confidence?: number;
};

export type AlignResult = {
  words: WordToken[];
  providerId: string;
  model: string;
  durationMs: number;
};

export type StageTranscriptResult = {
  stageNo: number;         // 1..12
  text: string;            // 逐語。整文しない
  lines: { startMs: number; endMs: number; text: string }[];
  providerId: string;
  model: string;
};

export interface AlignProvider {          // Pass A
  readonly id: string;
  align(input: { signedUrl: string; durationMs: number }): Promise<AlignResult>;
}

export interface StageTranscribeProvider { // Pass B
  readonly id: string;
  readonly capabilities: { contextCache: boolean };
  prepare(input: { signedUrl: string }): Promise<{ handle: string }>;
  transcribeRange(input: {
    handle: string;
    startMs: number;
    endMs: number;
    verbatim: true;
  }): Promise<StageTranscriptResult>;
}
```

契約テストを1本用意し、どのproviderを差しても同じ形の結果が返ることをCIで確認する。テストにはネットワークを使わないstub providerを用いる。capabilitiesは、provider固有の機能をインタフェース側で宣言するための枠である。contextCacheはその最初の項目で、コンテキストキャッシュがGemini固有の機能であるために設けた。契約テストは「宣言した機能が実際に使えること」までは検査しない。使えることの確認は、宣言がtrueのproviderに限って受け入れ基準に入る（§17.3 P8）。

### 6.7 whosaid-editor 作業JSONの取り込み

ローカルで前処理を済ませたユーザーのために、.speakers.json（schema 5）を正式な入力として受け付ける。これによりPass A・Pass Bを省略でき、録音を外部へ送らずに本アプリの解析・判定支援だけを使う運用が成立する。

| whosaid-editor（schema 5） | 本アプリ | 備考 |
|---|---|---|
| segments[].start / end | transcript_segments.start_ms / end_ms | 秒→ミリ秒 |
| segments[].text | text_ai（text_edited が true なら text_human） | 人手修正を人手として引き継ぐ |
| segments[].reviewed | import_meta.whosaid_reviewed（role_statusには写さない） | 話者割当を人が確認した印。本アプリの座席確定とは別物 |
| segments[].time_reviewed | time_status：true→human_verified | 同上 |
| segments[].orig_start / orig_end | ai_start_ms / ai_end_ms | AIが出した元の時刻を残す |
| segments[].cluster / chunk | import_meta | 参考情報として保持のみ |
| speakers[] | 取り込み時に人がAFF/NEG・A1〜N4へ対応づける | 名簿と競技上の役割は別物 |
| source_sha256 | media_sources.source_sha256 | 同一音声かどうかの検証に使う |
| audio_fingerprint（BLAKE2b） | import_meta.original_fingerprint | アルゴリズムは移植しない |
| edit_log | edit_logs へ追記型で移送 | 履歴を切らない |

取り込み後もPass AとPass Cは任意で実行できる。時刻だけを検証したい場合に使う。取り込んだ人手確認済みの状態は、再解析で上書きしない。

role_statusを写さない理由（v06で修正） v05は segments[].reviewed が true なら role_status を human_confirmed にすると書いていた。これは§7.1の第一原則「自動処理が人が確認した印を立てることは決してない」に正面から反する。whosaid側のreviewedは「話者割当を人が確認した」印であり、本アプリのrole_statusは「ステージと発言者（A1〜N4）の割当」を指す。同じ表の下の行が「speakers[]は取り込み時に人がAFF/NEG・A1〜N4へ対応づける」と書いているとおり、その対応づけは取り込み時点ではまだ行われていない。したがって取り込み直後のrole_statusはai_suggestedのままとし、人が座席へ対応づけた時点でhuman_confirmedになる。v05が写し先に書いていた bulk_applied は、§7.2のrole_statusの値域（ai_suggested / rule_derived / human_confirmed）に存在しない値だったため削除した。time_reviewedからtime_statusへの写しは、どちらも「人が時刻を耳で確かめた」印なので従来どおり残す。

## 7. レビュー状態モデル

### 7.1 whosaid-editorから継承する絶対原則

whosaid-editorのCLAUDE.mdは、壊してはならない設計原則を明示している。本アプリはドメインが違うが、原則はそのまま効く。

> **三つの絶対原則**
> 1. 自動処理が「人が確認した」印を立てることは決してない。✓（人が耳で聴いて確定）と△（一括適用で埋めただけ）の区別が製品価値そのものである。
> 2. 短い相づちやフィラーを自動削除しない。会議では同意の意思表示が消えるからだが、ディベートではさらに直接的で、「答えなかった」「沈黙した」「聞き返した」こと自体が判定材料になる。
> 3. 点検・提案は本体データを自動で書き換えない。提案の適用は人の操作であり、適用結果はレビュー状態の意味論を壊さない。

### 7.2 4軸の状態

会議の議事録では「誰が言ったか」の1軸で足りたが、本アプリは判定に使うため軸を分ける。ひとつの区間について、次の4軸を独立に持つ。

| 軸 | 値 | 意味 | 誰が設定できるか |
|---|---|---|---|
| text_status | ai_draft / human_edited | 本文がAI出力のままか、人が直したか | human_editedは人のみ |
| time_status | unverified / derived / human_verified | unverified＝AI出力のまま、derived＝アンカー照合で引き直した、human_verified＝人が耳で確かめた | human_verifiedは人のみ |
| audibility | unknown / clear / partial / unheard | 人のレビューで実際に聞き取れたか | 人のみ |
| role_status | ai_suggested / rule_derived / human_confirmed | ステージと発言者の割当。rule_derived＝ステージ確定と担当者表から導出 | human_confirmedは人のみ |

v02は「Machine recognition / Human audibility / Debate meaning」の3層として同じ趣旨を書いていた。v03はそれをカラムに落とし、どの層をどの主体が書けるかまで確定させた。v04ではDBのCHECK制約でも担保する。transcript_segmentsにaudibility_set_byを持ち、audibilityがunknown以外ならこの列が必須である。ジョブや解析経路からはこの列を書けないため、AIはaudibilityをunknownから動かせない。

### 7.2.1 unknown の扱い（v04で確定）

unknownは「聞こえない」ではなく「まだ人が聞いていない」である。ここを曖昧にすると、本設計が最も避けたい事故が起きる。

| 場面 | 扱い |
|---|---|
| 解析View | 本文を表示する |
| Judge View | 本文を表示する。ただし「未確認」と明示する |
| 判定のロック | 根拠として引用されたsegmentにunknownが1件でも残っていたら、ロックできない |

Judge Viewでunknownの本文を隠す設計も考えられるが、それではレビュー前に何も読めず、作業が始められない。だから隠さず、ロックの段階で止める。またunknownへ戻すAPIは用意しない。clear / partial / unheardのいずれかを人が選んだ時点で、二度とunknownには戻らない。

### 7.3 Judge View と 解析View

大会ルールは、発音や速度のためにジャッジが聞き取れなかった箇所を、試合後に原稿や証拠資料を読んで補って判定してはならないとしている。この規定を画面で表現する。

| ビュー | audibility = unheard の区間 | 用途 |
|---|---|---|
| Judge View | 本文を表示しない。「聞き取れなかった」と表示する | 判定作業。ジャッジが実際に得た情報だけを見る |
| 解析View | 本文を表示する（unheardの印付き） | 研修・解説・研究。何が起きていたかを確認する |

判定理由メモとJudge Sheetの生成はJudge Viewの内容のみを根拠にする。解説レポートは両方を使えるが、その場合は根拠がJudge View外であることを明示する。

### 7.4 再解析しても人手の結果を壊さない

- AI出力は *_ai 列、人手の結果は *_human 列に分けて持つ。表示は COALESCE(human, ai)。
- 再転写・再解析は *_ai 列だけを更新する。*_human 列には触れない。
- edit_logs は追記型。削除や上書きをしない。
- 再解析の前後で、human_verified / human_confirmed / human_edited の件数が減っていないことをテストで確認する。

## 8. ステージ自動区分

### 8.1 三つの信号を組み合わせる

| 信号 | 内容 | 強さ |
|---|---|---|
| チェアパーソンの定型句 | 「Affirmative Constructive Speech」「Negative Attack Speech」等の宣言 | 強い。ただし大会差と言い換えがある |
| 公式時間 | 4分／3分／2分と準備時間1分・2分の並び | 中程度。単独で決めない |
| 「Please say your name and start」直後の名乗り | 各スピーチは名乗りから計測が始まる | 強い。境界の先頭を特定しやすい |

### 8.2 定型句辞書（D1チェアパーソンスクリプトより）

辞書はコードに埋め込まず、ruleset packの一部として外部定義する。大会ごとの言い換えに差し替えで対応するためである。

| 定型句（部分一致） | 対応 | 備考 |
|---|---|---|
| Affirmative Constructive Speech | ①開始 | — |
| Questions from the Negative Side | ②または⑧ | 直前ステージで判別 |
| Negative Constructive Speech | ③開始 | — |
| Questions from the Affirmative side | ④または⑥ | 直前ステージで判別 |
| Negative Attack Speech | ⑤開始 | — |
| Affirmative Attack Speech | ⑦開始 | — |
| Affirmative Defense Speech | ⑨開始 | — |
| Negative Defense Speech | ⑩開始 | — |
| Affirmative Summary Speech | ⑪開始 | — |
| Negative Summary Speech | ⑫開始 | 最終スピーチ |
| preparation time | 準備時間 | 1分／2分は前後のステージで決まる |
| Please say your name and start | スピーチ開始直前 | 計測開始点の手掛かり |
| The debate is now over | 試合終了 | 以降は判定対象外 |

> **注意** 「Questions from the Affirmative side」は④と⑥の両方で同じ文言が使われる。「Questions from the Negative」も②と⑧で重なる。文言だけでは区別できないため、直前に確定したステージと経過時間の両方を使って決める。ここを取り違えると、以降のフロー全体が1ステージずれる。

### 8.3 担当者表による検証

大会ルール2.2の担当表をrulesetに入れておくと、ステージ確定後に発言者の妥当性を機械的に確認できる。間違ったスピーカーがスピーチした場合、次のスピーチが終わった後に判明すると反則負けになる規定があるため、指導・研修上の価値も高い。

| ステージ | 肯定 4人 | 肯定 3人 | 否定 4人 | 否定 3人 |
|---|---|---|---|---|
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

### 8.4 出力は候補、確定は人

- Pass Sは境界候補と信頼度を返す。信頼度が低い境界は画面で強調する。
- 人は波形と音を確認しながら境界をドラッグで微調整し、確定する。
- 確定後、担当者表から発言者が導出され、role_status は rule_derived となる。人が確認すれば human_confirmed になる。

### 8.5 ステージ長の妥当性検査（v07で追加）

実試合の書き起こしには、31:34〜41:59 の10分25秒がひとつの区間として現れていた。この区間には⑨肯定ディフェンス（3分）だけが割り当てられており、その後ろにあるはずの⑩否定ディフェンスと⑪肯定総括の本文は、どこにも存在しなかった。区切りを落としたのか、音声そのものが失われていたのかは、出力を見ただけでは分からない。

分からなくてよい。分かるべきなのは「おかしい」ことのほうであり、それは機械的に検出できる。rulesetは各ステージの規定時間を持っているので、確定したステージの実測長と突き合わせればよい。

| 検査 | 条件 | 立てるフラグ |
|---|---|---|
| 長すぎる | 実測長 > durationSec + graceSec の2倍 | stage_duration_anomaly |
| 短すぎる | 実測長 < durationSec の1/3 | stage_duration_anomaly |
| 単一区間が長すぎる | ひとつの transcript_segment が、そのステージの durationSec を超える | segment_duration_anomaly |
| 合計が合わない | 12ステージの実測長合計と、公式の34分の差が3分を超える | stage_duration_anomaly（match単位） |

> **なぜ閾値を緩くするのか** 実測長は、名乗りとチェアパーソンの発話をどこで切るかで数十秒動く。厳しくすると常時フラグが立ち、誰も見なくなる。ここで捕まえたいのは「3分のスピーチが10分になっている」ような桁の違いであって、微差ではない。
> このフラグは判定に入らない。ステージ確定UI（画面C）で強調表示し、人が境界を引き直すか、欠損として記録するかを選ぶ。

### 8.6 座席と氏名の結び付け（v07で追加）

§8.3の担当者表は、ステージが確定すれば「その発言者が A1 なのか A3 なのか」を決める。決まらないのは「A1 が誰なのか」である。実試合ではそれを自己紹介ラウンドの名乗りから取った。この工程を設計に置く。

| 手順 | 内容 | 状態 |
|---|---|---|
| 1 | 自己紹介ラウンド（§3.5）の区間から、名乗りと担当の宣言を抽出する | seat_binding_status = ai_suggested |
| 2 | 宣言された担当（constructive / attack / defense / summary）と、担当者表の座席を対応づける | 同上 |
| 3 | 各スピーチ冒頭の名乗りと突き合わせ、矛盾がないことを確認する | 一致すれば rule_derived |
| 4 | 人が試合登録の名簿と照合して確定する | human_confirmed |

- 手順3は、実試合で実際に効いた検算である。①の立論者が②で応答し、④の質問者が⑪で総括した、といった対応が全ステージで一致することを確認する。一致しない場合は speaker_role_mismatch を立てる。
- 名乗りが聞き取れないスピーカーがいた場合、その座席の display_name は空のままにする。推測で埋めない。座席ラベルだけで解析・観戦画面は成立する（§9.9）。
- match_members に intro_segment_id（自己紹介での名乗り区間）、name_source（self_introduction / registration / unknown）、seat_binding_status を持つ。

> **保持レベルCとの接続** v06の§16.3は「名乗り区間を人が印付けし、その区間だけを伏せる」と書いていたが、その印を持つ列がどこにも無かった。intro_segment_id がその印である。加えて、各スピーチ冒頭の名乗り区間も同じ扱いで記録する。証拠として引用された専門家の氏名を消してはいけない、という区別は、この列があって初めて機械的に守れる。

## 9. デジタルフローシート

### 9.1 公式配置を踏襲する

紙のHEnDA Flow Sheetと行き来しやすいよう、独自の時系列表ではなく公式の配置を基本表示とする。各ボックスはクリックで原音・逐語記録・根拠へ戻れる。

> **フローの本質** フローシートはきれいな要約ではなく、主張と根拠、そしてどの反論がどの論点に当たったかを追跡するための記録である。AIは要約し過ぎず、ClaimとGround / Evidenceを分け、反論の矢印を明示する。

### 9.2 フローの内部データ

| オブジェクト | 主な項目 | 役割 |
|---|---|---|
| Issue | label（AD1 / AD2 / DA1 / DA2）、side、title | 主要論点。各側最大2 |
| ArgumentNode | kind、role（present / effect / importance）、text、stage_no、evidence_refs | Claim / Attack / Defense等の単位 |
| EvidenceRef | 引用内容、出典種別、出典要素の充足状況、transcript_segment_id | 根拠 |
| Question | type（confirmation / examination）、対象node | 質疑 |
| FlowLink | from_node、to_node、relation、confidence、review_status | 矢印 |
| SummaryLink | 総括で拾ったIssue、比較軸、相手Issueとの比較 | 最終比較 |
| RuleFlag | type、target、rationale、status | 判定除外候補 |

### 9.3 relation の語彙（確定）

| relation | 意味 | 許される方向 |
|---|---|---|
| ATTACKS | 相手の証明要素を攻撃する | Attack → Claim |
| DEFENDS | 自陣への攻撃に再反論する | Defense → Attack |
| EXTENDS | 既出の論点を維持・強調する | Summary / Defense → Claim |
| COMPARES | AD群とDA群を比較する | Summary → Issue |
| QUESTIONS | 質疑で確認・検証する | Question → Claim / Attack |
| ANSWERS | 質疑に応答する | Answer → Question |
| CITES | 証拠を参照する | Node → EvidenceRef |
| DROPS | 反論されず、応答もされないまま残った | from＝応答されなかったClaimまたはAttack、to＝応答義務のあった相手ステージの先頭ノード |

DROPSの方向を明記した理由（v06） v05のDROPSは「許される方向」欄に方向が書かれておらず「システムが導出」とだけあった。方向が定まらないと INVALID_LINK_DIRECTION 422 のテストが書けない。上表のとおり、応答されなかったノードをfrom、応答義務のあったステージの先頭ノードをtoとする。相手ステージにノードが1つも無い場合はリンクを作らず、rule_flagsに dropped を立てる。

あわせて、対象区間に audibility = unheard がある場合はDROPSを導出しない。「聞き取れなかった」と「応答しなかった」は設計上まったく別の事象であり、前者を後者として記録すると、大会ルールの趣旨に反した判定材料が生まれる。この場合はDROPSではなく audibility_gap を立て、人がどちらかを判断する（§20）。

欠損ステージからDROPSを導出しない（v07で追加） 同じ理屈が、ステージ単位の欠損にも当てはまる。実試合の書き起こしでは⑩否定ディフェンスと⑪肯定総括の本文が丸ごと失われていた。この状態でDROPSを導出すると、否定側は自陣のDA1・DA2をすべて放棄し、肯定側は総括を行わなかった、という記録が機械的に生成される。実際には両者とも話しているのに、である。
したがって、応答義務のあったステージの coverage_status が complete でない場合、そのステージを to とするDROPSは導出しない。代わりに stage_coverage_gap を立て、「この区間の記録が無いため、応答の有無を判断できない」ことを人へ示す。この区別は audibility_gap と分けて持つ。前者は記録が存在しない話であり、後者は記録はあるが聞き取れなかった話である。復旧の手段が違う（前者は音声の入れ直し、後者は聞き直し）。

> **三つを混ぜない** 「応答しなかった（DROPS）」「聞き取れなかった（audibility_gap）」「記録が無い（stage_coverage_gap）」は、いずれも画面上は同じ空白に見える。空白の理由が違えば、判定でできることも違う。DROPSだけが判定材料になり、他の二つは判定材料にならない。

### 9.4 AI提案の状態

| 状態 | 意味 | 表示 | 判定での扱い |
|---|---|---|---|
| suggested | AIが抽出・リンクしただけ | 灰色／点線 | 勝敗計算に自動確定しない |
| reviewed | 人間が原音・文脈を確認 | 青 | レビュー済みとして使用可 |
| confirmed | 人間がフロー上の意味まで確定 | 濃色／実線 | Judge Sheetの材料に使用 |
| excluded | New Argument等で判定から除外 | 赤取り消し線 | 解説には残すが勝敗に算入しない |

### 9.5 A/B/Cノード＋Support Quality（v08で再構成）
v07までは`argument_nodes.role`にpresent / effect / importance / evidence / otherを持たせていた。v08では評価エンジンと整合させ、議論の証明構造はA/B/Cへ寄せる。Evidence/Warrantはノードの「第4軸」ではなく、A/B/Cが成立する理由を説明するSupport Qualityとして扱う。

| node_type | 意味 | 既存roleとの対応 | 典型Attack |
|---|---|---|---|
| A / observation | 現状・前提・necessity / uniqueness | present | not_necessary / not_unique |
| B / link | effect / link / solvency / process | effect | no_effect / alternative_solves / not_solvent |
| C / impact | importance / significance / impact | importance | not_important / value_turn |
| support tag | evidence / warrant / relevance / burden | evidence_refs + support_tags | evidence_weak / relevance / burden |
| other | Plan説明、進行、手続き等でA/B/Cに該当しない | other | 原則採点対象外 |

**移行方針**：既存`role='evidence'`を削除して本文を失うのではなく、Evidence本文を`evidence_refs`または対象A/B/Cのsupport根拠segmentへ移す。v08新規データでは`argument_nodes.node_type=A/B/C/other`を正本とし、roleは互換読取用に段階廃止する。

Support Qualityタグは式に直接入らない。タグとrationaleは`argument_node_scores`のlevel理由として保存する。ASRや記録欠損でEvidenceを確認できない場合はlevelを自動で下げず`evidence_status=unverifiable`へ送る。
### 9.6 やりとりの種別と効果（v05で追加）
v07の`flow_links.effect_kind / effectiveness_*`は、Flow上の意味関係と人間の説明用として残す。一方、v08のAI Decision Supportで数値化する攻防は**`clash_events`を正本**にする。二つを混ぜない。

| 目的 | 正本 | 値 |
|---|---|---|
| Flow上で「何と何がつながるか」 | flow_links | ATTACKS / DEFENDS / COMPARES 等 |
| 説明用の効果コメント | flow_links.effectiveness_ai/human | strong / partial / none（従来互換。判定式には使わない） |
| AI参考判定の攻防計算 | clash_events | claimed_effect_cat / support_cat / recovery_cat / rule_state |

`clash_events`のattack_typeはA/B/CとSupport Qualityに合わせる。

- A: NOT_NECESSARY / NOT_UNIQUE
- B: NO_EFFECT（サブタイプ alternative_solves / not_solvent を持てる）
- C: NOT_IMPORTANT / VALUE_TURN
- Support: EVIDENCE / RELEVANCE / BURDEN

Defenseは親Attackを`parent_event_id`で参照する。`recovery_cat`はAttackの核心に答えたかを表し、論点ずらしはMinor以下にする。

質疑の`admits / declines_to_answer`はv07の記録を維持するが、初期設定では`NEEDS_CITATION`。後続スピーチで引用された場合にのみAI参考P/Vへ反映する（`qa_effect_mode=cited_only`）。

> **互換性の一線**
> `flow_links.effectiveness_human`は人間の説明メモであり、AI Decision Support計算には使わない。AI数値計算は`clash_events`＋`scoring_config`だけに限定する。これで「人のper-exchange評価」と「Issue単位のhuman ballot」の二重権威を避ける。
### 9.7 Debate Evolution View（v05で追加）
v08のDebate Evolutionは、`clash_events`と`argument_node_scores`のsnapshotから導出する。Flowの矢印だけでなく、各イベント前後のP/V/HPを追える。

| 時刻 | Stage | Issue / Node | Event | Rule State | AI category | P/HP変化 | Human review |
|---|---|---|---|---|---|---|---|
| 立論 | ① | AD1-B1 | construct | ADMISSIBLE | level 4 | P=.95 | confirmed |
| Attack | ⑤ | AD1-B1 | NO_EFFECT | ADMISSIBLE | Major×Adequate | HP低下 | reviewed |
| Defense | ⑨ | AD1-B1 | recovery | ADMISSIBLE | Substantial | 一部回復 | confirmed |
| Summary | ⑪ | AD1 vs DA1 | comparison | ADMISSIBLE_COMPARISON_MACRO | — | node値不変 | confirmed |

色分けはL3で、青=論点、赤=Attack、緑=Defense、灰=不採用/Drop、黄=UNVERIFIABLE、紫=Delivery。各イベントから元segmentへ戻れる。
### 9.8 Impact比較の4軸（v05で追加）

議論が成立しているかだけでなく、起きる結果がどれほど重大かも勝敗に影響する。SummaryのCOMPARESリンクに、比較の中身を持たせる。

| 軸 | 例 | 注意 |
|---|---|---|
| magnitude | 影響人数、金額、生命、失業 | 数字が大きいだけで自動勝利にしない |
| probability | 発生確率、因果の確かさ | Attack後にどれだけ残ったかを見る |
| timeframe | 短期か長期か | — |
| value | 生命、権利、教育、経済 | 価値判断の理由を明示する |

各軸は理由の記述であり、点数ではない。「Magnitude 8点 vs 5点」のような持ち方をしない。§10.1の「数値へ置換しない」がここにも及ぶ。

あわせて、その比較を誰が持ち出したかを区別する。大会ルールの運用では、比較基準が試合中に示されなかった場合、ジャッジ独自の判断で比較評価してよいとされている。ディベーター由来の比較は根拠segmentを必須とし、ジャッジ由来の比較はsegmentなしを許すかわりに、判定理由に「試合中に比較基準が示されなかったため、ジャッジの判断による」と明記する。

### 9.9 役割優先UI（v05で追加）

HEnDAでは各ステージの担当役割が固定されている。したがって解析・観戦画面では、選手名より先に競技上の役割を出す。

| 表示対象 | 原則 | 実装 |
|---|---|---|
| 役割 | 必須・主表示 | 「肯定立論」「否定Attack」等を常に明示 |
| 座席ラベル | 必須 | A1〜N4。ステージ確定後に担当者表から自動導出 |
| 選手名 | 任意表示 | 解析・観戦画面では省略可。必要なら役割の下に小さく |
| 公式出力 | 氏名を入れる | Best Debater欄など、公式Judge Sheetで氏名が要る箇所のみ |

> **これは見た目の話ではない** 保持レベルC（氏名の匿名化）と完全に噛み合う。最初から役割ラベルが主で動く画面なら、氏名を消しても何も壊れない。逆に選手名前提の画面を作ってから匿名化すると、表示が虫食いになる。解析画面のコンポーネントからdisplay_nameを参照しないことを、静的検査でCIに入れる。

### 9.10 Clash View（v08評価エンジンへ接続）
Clash Viewは主要Issueごとに、Constructive → Attack → Defense → Summaryを横断して「結局どうなったか」を見せる。v08では表示の背後で`clash_events`と`counterfactuals`を使う。

- 通常表示：双方のClaim、主要Attack、Defense、最終P/V/Strengthカテゴリ。
- 研修表示：constructive_end値、final値、clash_leverage、winner_flip。
- Review Gate：Value turn、Late Repair境界、UNVERIFIABLEがあれば理由コードを表示。
- Human BallotとAI Decision Supportを左右に並べ、同じIssueをどう見たか比較できる。

Clash View自体がhuman winnerを計算することはない。AI側の数値はDecision Supportの説明として表示する。
## 10. Judge Sheet と判定支援
### 10.1 三層分離と「AI参考判定」の位置づけ

v08ではJudge機能を三層に分離する。

| 層 | 保存対象 | 公式判定との関係 |
|---|---|---|
| L1 AI Decision Support | 内部P/V/Strength、カテゴリ、Net sum、Voting Issue候補、Review Gate | HEnDA語彙で参考判定を提示するが、人間バロットではない |
| L2 Internal Analysis | ノード採点、Support Quality、clash events、Rule State、snapshot | L1とL3の根拠。監査用 |
| L3 Learning | HP、色分け、delivery | 公式判定へ逆流させない |
| Human Ballot | 人が確定したHi/Lo、Large/Small、Strong/Weak/None、Winner、Voting Issue、Communication | 大会・研修での最終記録 |

> **不変条件** AIが`judge_decisions`または`judge_issue_assessments_human`を直接確定しない。AIは`suggested`系テーブルだけを書く。

### 10.2 HEnDA Judge Sheet対応

| Judge Sheet欄 | 公式表現 | AI Decision Support |
|---|---|---|
| Issues | AD1 / AD2 / DA1 / DA2 | 最大2件を同定。3件目以降はINADMISSIBLE_EXTRA_ISSUE候補 |
| Probability | Hi / Lo | L2から数値Pとカテゴリ候補を出す |
| Value | Large / Small | Impactノードから数値Vとカテゴリ候補を出す |
| Strength | Strong / Weak / None | **P × V** を計算しカテゴリ候補へ写像 |
| Compare net sum | AD vs DA | AI参考のAFF/NEG合計、margin、winner_suggestion |
| Voting Issue | AD1等 | survival_candidate / clash_candidate / confidence |
| New Argument check | Yes / No | Rule Stateで採用可能イベントだけが寄与しているか再検査 |
| Communication | 1〜5整数 | 音声由来の暫定提案。映像・マナーは人間確認 |
| Best Debater | 1名 | MVPではAI候補を出さない |

### 10.3 内部数値とカテゴリ写像

AIは原則として**カテゴリ＋根拠＋confidence**を出し、システムが数値へ写像する。初期値は校正前の設定であり、`scoring_config`で版管理する。

**A/Bノード 0〜4**

| level | 意味 | 初期値 |
|---:|---|---:|
| 4 | 出典の明示された具体的証拠と妥当なWarrantで十分に立証 | 0.95 |
| 3 | 概ね立証。軽微な飛躍・証拠弱さ・出典欠落 | 0.80 |
| 2 | 部分的に立証。重要前提欠落または関連性低 | 0.60 |
| 1 | 主張中心で根拠が薄い | 0.30 |
| 0 | 立証なし／反証済み | 0.05 |

**計算**

```text
P = chain_rule(A, B1, ..., Bn)
  初期値: weakest_link = min(A, B1, ..., Bn)
  代替: product（Phase 2で比較）

V = Impact C の magnitude（0..1）
Strength = P × V
HP = 10 × Strength   // L3のみ
```

初期カテゴリ閾値：P≥0.50→Hi、V≥0.50→Large、Strength≥0.40→Strong、0.10〜0.40→Weak、<0.10→None。閾値は校正対象であり、公式規則そのものとは記載しない。

### 10.4 Attack / Defense の離散尺度とイベント計算

`clash_events`にAttack / Defense / Concession / Clarification / Comparison / Value turn / Extensionを記録する。

| 尺度 | カテゴリ（初期数値） |
|---|---|
| claimed_effect | None 0 / Minor .25 / Moderate .50 / Major .75 / Decisive 1.0 |
| support | Unsupported .30 / Weak .50 / Adequate .75 / Strong 1.0 |
| recovery | None 0 / Minor .25 / Partial .50 / Substantial .75 / Full 1.0 |

Attackの内部ダメージは `r = claimed_effect × support`。ノード値pは `p × (1-r)`。Defenseは親Attackに対する`g`を使い `r' = r × (1-g)` として再計算する。AIはカテゴリを出し、小数演算はシステムのみが行う。

この数値はAI参考判定の内部モデルであり、人間Ballotへ直接コピーしない。人間は公式カテゴリを確認・確定する。

### 10.5 Rule State Engine / New Argument

v07のNew Argument detectorを、v08ではRule State Engineへ拡張する。`speech_no × event_type × condition → rule_state`をサーバが決定し、AIにはevent_type・target・理由・confidenceを出させる。

主要状態：

- `ADMISSIBLE`
- `ADMISSIBLE_REEMPHASIS`
- `ADMISSIBLE_COMPARISON_MICRO`
- `ADMISSIBLE_COMPARISON_MACRO`
- `ADMISSIBLE_NEW_EVIDENCE_FOR_COMPARISON`
- `NEEDS_CITATION`
- `INADMISSIBLE_NEW_ADVANTAGE / NEW_DA / NEW_PLAN`
- `INADMISSIBLE_NEW_ATTACK`
- `INADMISSIBLE_PREMATURE_REBUTTAL`
- `INADMISSIBLE_EXTRA_ISSUE`
- `INADMISSIBLE_OVERTIME`
- `INADMISSIBLE_LATE_REPAIR`
- `DROPPED`
- `UNVERIFIABLE`

**Summary Evidence規則**：`ADMISSIBLE_NEW_EVIDENCE_FOR_COMPARISON`は比較説明とVoting Issue理由づけには使えるが、A/B/Cノード値を上げない。欠けていた立証の新規完成は`INADMISSIBLE_LATE_REPAIR`。

**質疑**：初期設定`qa_effect_mode=cited_only`。質疑のConcession/Clarificationは`NEEDS_CITATION`として記録し、後続スピーチで明示的に引用された場合のみP/Vへ反映する。これはルール文書で一意に決まらないため校正対象とする。

### 10.6 Voting Issue：survival と clash leverage

Voting Issueを単純な`max(Strength)`にしない。

- `survival_candidate`: 最終時点で勝者側に残ったIssueのうちStrength最大。
- `clash_candidate`: 当該Issueのpost-constructive clashを取り除き、constructive_end snapshotへ戻したcounterfactualでmarginを最も動かすIssue。

```text
clash_leverage(i)
  = abs(margin_final - margin_counterfactual_no_clash(i))
```

counterfactualではIssue iのA/B/Cのみ立論終了時へ戻し、他Issueは最終値のままにする。勝者が反転すれば`winner_flip=true`。

- 二候補一致 → voting_issue_confidence=high
- 不一致 → 両候補を提示、confidence=low、人間確認
- decisive_event_idsを必ず添付
- 説明にfluent/vivid/impressive等のdelivery語彙が混じれば`communication_in_content`候補フラグ

### 10.7 Value turn Review Gate

Value turnはImpactのmagnitudeとdirectionを分離する。

- `impact_direction ∈ {+1, -1}` をL2に保存。
- L1の公式表示ではsigned scoreを出さず、StrengthのmagnitudeはP×Vのまま。
- `value_turn_mode=review_gate`をMVP既定値とする。
- turn適用あり/なしのcounterfactual net sumでwinnerが変わる場合、`winner_suggestion=REVIEW_REQUIRED`。
- winnerが変わらない場合はAI参考判定を出せるが、Value turn存在を明記。
- signed_net自動計算への移行はPhase 2以降の実データ校正後に再検討。

### 10.8 Decision Support の停止条件

次の場合、AIはAFF/NEGを断定せず`REVIEW_REQUIRED`を返す。

1. 重大な`UNVERIFIABLE`またはcoverage gapがmarginを変え得る。
2. Value turnの採否でwinnerが変わる。
3. survival_candidateとclash_candidateが競合し、説明confidenceが閾値未満。
4. SummaryのEvidenceがcomparisonかlate repairか境界でconfidenceが低い。
5. 採用状態未確定のイベントがNet sum/Voting Issueへ寄与している。

Review Gateは「モデルが弱いから失敗」ではなく、判断支援ツールが不確かな材料を公式らしく見せないための正常動作とする。

### 10.9 Communication / Delivery

Communication Pointsは公式チーム単位1〜5整数。AIが音声から観測できるのは聞き取りやすさ・速度・間・無応答などに限る。アイコンタクト、マナー、Evidence閲覧協力は人間確認。

学習用話者別Deliveryは別テーブルに保存する。

- Fluency 1〜5
- Intelligibility 1〜5
- Clarity / Organization 1〜5
- Delivery Persuasiveness 1〜5

これらはL1のP/V/Strengthへ入れない。判定理由のdelivery段落がVoting Issue/Strength理由へ使われていれば警告する。

### 10.10 人間Ballotとパネル

v07の複数ジャッジ設計を維持する。

- `judge_decisions`は1ジャッジ1票。`UNIQUE(match_id, decided_by)`。
- `judge_issue_assessments_human`に人が確定したP/V/Strengthカテゴリを保存。
- パネル結果はビューで多数決を導出し、少数意見を消さない。
- AI Decision Supportはジャッジ人数とは独立して1 run以上持てる。
- AIと人間、ジャッジ同士の一致・不一致を研究用に比較するが、AI値で人間票を上書きしない。

### 10.11 判定ロックの不変条件

人間Ballotをロックできる条件はv07を維持し、v08のルール状態を追加する。

- winner / voting_issue / Communication / reason が埋まっている。
- voting_issueのIssueがhuman-confirmed。
- 根拠segmentのaudibilityがclear/partialに人間確定。unheard不可。
- 根拠stageのcoverage_status=complete。gap引用不可。
- stage_no=NULL（自己紹介等）のsegmentを判定根拠にしない。
- `candidate`のRuleFlagが残っていない。
- `INADMISSIBLE_*`イベントを人間判定理由が根拠参照していない（明示的overrideを作る場合は理由必須）。
- Strength=Noneではresidual_note必須。

AIの`REVIEW_REQUIRED`は人間Ballotのロックを機械的に禁止しない。人間が内容を確認し、独立に判定できるためである。ただしUIはReview Gateの未確認を目立たせる。

### 10.12 サーバ権威

Issue/node id、Rule State、カテゴリ→数値写像、Net sum、counterfactual、Review Gate、scoring_config_versionはサーバ権威とする。AI・クライアントは直接確定値を書けない。AI出力は`suggested`領域へ入り、人間確定は別API・別権限で行う。
## 11. 解説資料の生成

### 11.1 標準構成
解説はconfirmed Flow、AI Decision Support、人間Ballotから生成し、両者を混同しない。

- 試合情報：Motion、日時、Round、AFF/NEG、ruleset版
- **AI参考判定**：P/V/Strength候補、Net sum、Voting Issue二候補、Review Gate（必ず参考表記）
- **人間Ballot**：Winner、Voting Issue、Communication、確定P/V/Strength
- 議論マップ：AD1 / AD2 / DA1 / DA2のA/B/C、Attack→Defense→Summary
- 勝敗を分けた場面：decisive_event_idsと時刻根拠
- Counterfactual：clash_candidateのmargin変化（研修/研究モードのみ）
- New Argument / Late Repair / Drop / UNVERIFIABLE等の注意点
- Communication / Delivery：内容判定とは別枠
- 指導用Advice：判定理由とは別枠
- 付録：確認済み文字起こし、Flow検証状態、scoring_config_version

AIと人間で結論が異なる場合、どちらかへ丸めず並記する。AIがREVIEW_REQUIREDなら「未判定」ではなく「AI参考判定は要確認」と記す。
### 11.2 判定理由とアドバイスを分ける

判定理由は試合内で実際に出た議論だけから作る。指導者としての改善提案や「こう言えばもっと強かった」は、別のAdvice欄へ分ける。この分離は、埼玉いなほカップに掲載されているジャッジ基準の三原則（公平性・客観性・説明責任）と、判定理由とアドバイスを区別して試合後に述べるという運用に直接対応する。

判定理由の根拠種別（v07で追加） 判定理由メモの各段落に、何に基づいて書かれた段落かを持たせる。実試合で、審査委員長の講評と客観的な判定理由が、同じ結論を別の根拠で説明していたためである。

| 種別 | 内容 | 判定の理由として使えるか |
|---|---|---|
| content | 議論の内容。主張・因果・根拠・残存 | 使える |
| comparison | 比較秤量。ADとDAをどの軸で比べたか | 使える |
| procedure | ルール適用。New Argument、担当者違反、時間超過 | 使える |
| delivery | 伝達。声量・速度・表現力・共感 | Communication欄でのみ使う。内容判定の理由に使うと candidate フラグが立つ（§10.6） |
| advice | 指導コメント。こう言えばもっと強かった | 判定理由に入れない。Advice欄へ分ける |

種別は段落の属性であって、文の禁止ではない。「否定側の説明が速すぎて論点の対応が追えなかった」は delivery であり、Communication の減点事由としては正当である。それを「したがってDA1は成立しなかった」の理由に接続したときに、初めてフラグが立つ。

### 11.3 根拠の必須化

- 解説の各段落は、少なくとも1つのtranscript_segment_idを参照する。
- 参照のない主張文は生成しない。生成された場合はCIで検出して落とす。
- Judge Viewに存在しない内容を根拠にした段落には、その旨を明示する。

## 12. データモデル
### 12.1 テーブル一覧（v08統合）

v07の記録・Flow・Ballotテーブルを残し、v04評価エンジンを**追加テーブルで接続する**。既存`argument_nodes`を議論内容の正本、`argument_node_scores`を時点別評価、`flow_links`を意味的なリンク、`clash_events`を時間順の攻防イベントとする。これにより内容構造と評価履歴を混ぜない。

| 層 | テーブル | 主なカラム / 役割 |
|---|---|---|
| 共通 | matches / match_members / media_sources / stage_segments / match_events / transcript_segments | v07の音声・座席・欠損・逐語基盤を継承 |
| Flow | issues | AD1〜DA2、side、title、review_status |
| Flow | argument_nodes | issue_id、node_type(A/B/C)、link_order、text、stage_no、review_status |
| Flow | evidence_refs | node_id、source_type、cited_elements、segment_id、completeness |
| Flow | flow_links | from_node、to_node、relation、review_status。意味的接続の正本 |
| L2 | criteria_catalog | code、kind(NODE_TYPE/SUPPORT_QUALITY/ATTACK_TYPE/RULE_STATE)、definition、rule_ref |
| L2 | argument_node_scores | node_id、snapshot_kind(constructive_end/final/event)、level、value、support_tags、rationale、segment_ids、confidence、evidence_status、impact_direction |
| L2 | clash_events | type、speech_no、speaker_id、target_argument_ids、target_node_id、attack_type、claimed_effect_cat、support_cat、recovery_cat、r_or_g、parent_event_id、rule_state、status、rationale、segment_ids |
| L2 | rule_state_table | speech_no、event_type、condition、rule_state、rule_ref、version |
| L2 | issue_snapshots | issue_id、snapshot_kind、a_value、b_values(jsonb)、c_value、captured_after_stage、scoring_config_version |
| L1 AI | scoring_config | version、node_map、claimed_effect_map、support_map、recovery_map、thresholds、chain_rule、qa_effect_mode、value_turn_mode、summary_evidence_mode |
| L1 AI | official_decision_support | match_id、flow_run_id、scoring_config_version、issues(jsonb)、aff_sum、neg_sum、margin、winner_suggestion、ai_confidence、voting_issue_candidates、counterfactuals、value_turn_gate、new_argument_check、comm_points_suggested、flags、explanation |
| L1 Human | judge_issue_assessments_human | judge_decision_id、issue_id、probability、value、strength、residual_note、segment_ids |
| L1 Human | judge_decisions | 1ジャッジ1票。winner、voting_issue、comm、best_debater、reason、reason_grounds、compare_note、decided_by、locked_at |
| L3 | hp_ledger | argument_id、event_id、seq、hp_before、hp_after、delta、p、v、reason、scoring_config_version |
| L3 | delivery_scores | speech_no、speaker_id、fluency、intelligibility、clarity、delivery_persuasiveness、wpm、word_count、rationale |
| 監査 | flow_runs / judge_runs / edit_logs / export_runs | モデル版・prompt版・人手編集・生成履歴 |

### 12.2 既存Flowとの統合規約（v08で確定）

1. `argument_nodes`は内容の正本であり、スコアを直接持たない。
2. `argument_node_scores`はappend-only snapshot。AI再解析で過去行を上書きしない。
3. `flow_links`は「何と何が関係するか」、`clash_events`は「いつ誰がどう攻撃・防御したか」。同じものとして統合しない。
4. Attack/Defense eventは可能な限り`target_node_id`を必須とする。論点全体攻撃だけはtarget_argument_idsで許可し、人間確認を促す。
5. `constructive_end` snapshotはcounterfactual Voting Issueのため必須。Stage 3終了後（両側立論完成後）を基準時点にする。
6. Rule Stateはイベント生成時のruleset versionとともに保存し、後のルール更新で過去試合の判定理由が変わらないようにする。

### 12.3 AI Decision SupportとHuman Ballotの分離

- `official_decision_support`は名前にofficialを含むが「公式語彙へ写像したAI参考判定」である。UI表示は必ずAI参考判定。
- `judge_decisions` / `judge_issue_assessments_human`だけが人間Ballot。
- DB roleを分け、AI workerはhuman ballot表へのINSERT/UPDATE権限を持たない。
- Human BallotはAI Decision Supportを参照できるが、accept-allで自動コピーする機能はMVPでは提供しない。各欄を人が確認する。

### 12.4 不変・追記の原則

- media_sources / align_wordsは不変。
- AI run、node score snapshot、clash_event、Decision Supportは版を持って追記する。
- 人間確定値をAI再実行で上書きしない。
- edit_logsは追記のみ。
- export_runsはどのhuman ballot / decision support / template versionから作ったかを保持する。

### 12.5 RLS・権限

v07のmatch単位RLSを維持する。追加で、AI処理用DB roleは`official_decision_support`・L2・L3へ書けるが、`judge_decisions`と`judge_issue_assessments_human`へは書けない。人間Ballot更新APIだけが後者へアクセスする。

### 12.6 判定モジュールが読める列を制限する

v07の`judge_flow_links`分離を維持し、v08ではAI Decision Support計算用に`ai_scoring_inputs`ビューを新設する。含めてよいのは、confirmedなA/B/C構造、admissibleなclash event、node score snapshot、Impact、scoring_configのみ。delivery_scoresとHPは含めない。

人間Ballot集計モジュールは`judge_decisions`だけを読み、AI Decision Support内部値を読まない。AI参考判定と公式パネル結果の逆流をSQLレベルで防ぐ。
## 13. コアスキーマ（確定）

スキーマの唯一の定義はZodとする。JSON Schemaはビルド時に生成し、docs/schemas/ へ出力する。手書きのJSON Schemaを別に持たない。

### 13.1 ruleset（henda-20）

```ts
// packages/core/src/ruleset/schema.ts
export const StageDef = z.object({
  no: z.number().int().min(1).max(12),
  type: z.enum([
    'AFF_CONSTRUCTIVE','NEG_QUESTIONS','NEG_CONSTRUCTIVE','AFF_QUESTIONS',
    'NEG_ATTACK','AFF_ATTACK','AFF_DEFENSE','NEG_DEFENSE',
    'AFF_SUMMARY','NEG_SUMMARY',
  ]),
  side: z.enum(['AFF','NEG']),
  durationSec: z.number().int().positive(),
  prepAfterSec: z.number().int().min(0),
  seat4: z.string(),           // 4人チームの担当（例 'A1'）
  seat3: z.string(),           // 3人チームの担当
  allowsNewIssue: z.boolean(), // 立論のみ true
  allowsAttack: z.boolean(),
  allowsDefense: z.boolean(),
  allowsComparison: z.boolean(),
});

export const Ruleset = z.object({
  id: z.literal('henda-20'),
  version: z.string(),                 // 例 '2025-11-28'
  maxIssuesPerSide: z.literal(2),
  constructiveMaxWords: z.literal(600),
  maxWordsPerMinute: z.literal(150),
  graceSecAfterBell: z.literal(10),
  communicationPoints: z.object({ min: z.literal(1), max: z.literal(5), integerOnly: z.literal(true) }),
  tieBreak: z.literal('NEG'),          // 優劣がつけられない例外時は否定側
  stages: z.array(StageDef).length(12),
  chairCues: z.array(z.object({
    pattern: z.string(),
    kind: z.enum(['stage_start','prep','name_call','match_end']),
    stageNo: z.array(z.number().int().min(1).max(12)),  // kind='stage_start' 以外は空配列
  })),
  evidenceRequirements: z.object({
    factData: z.array(z.string()),     // ['source','year']
    expert:   z.array(z.string()),     // ['name','credential']
    news:     z.array(z.string()),     // ['outlet','date']
  }),
});
```

### 13.2 flow

```ts
export const ReviewStatus = z.enum(['suggested','reviewed','confirmed','excluded']);

export const Issue = z.object({
  id: z.string(),                      // サーバ割当
  label: z.enum(['AD1','AD2','DA1','DA2']),
  side: z.enum(['AFF','NEG']),
  title: z.string().max(120),
  reviewStatus: ReviewStatus,
});

export const ArgumentNode = z.object({
  id: z.string(),
  issueId: z.string().nullable(),
  kind: z.enum(['CLAIM','ATTACK','DEFENSE','QUESTION','ANSWER','SUMMARY_POINT']),
  nodeType: z.enum(['A_OBSERVATION','B_LINK','C_IMPACT','OTHER']).nullable(), // v08正本
  linkOrder: z.number().int().positive().nullable(), // B_LINKの順序。その他はnull
  legacyRole: z.enum(['present','effect','importance','evidence','other']).nullable(), // v07移行読取用
  stageNo: z.number().int().min(1).max(12),
  text: z.string(),
  segmentIds: z.array(z.string()).min(1),   // 根拠時刻へ必ず戻れる
  reviewStatus: ReviewStatus,
}).refine(
  n => n.nodeType === 'B_LINK' ? n.linkOrder !== null : n.linkOrder === null,
  { message: 'linkOrderはB_LINKだけが持つ' }
);

export const FlowLink = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  relation: z.enum(['ATTACKS','DEFENDS','EXTENDS','COMPARES','QUESTIONS','ANSWERS','CITES','DROPS']),
  confidence: z.number().min(0).max(1),
  effectKind: z.enum([
    // ATTACKS
    'no_link','not_important','not_unique','evidence_weak','value_turn',
    'alternative_solves','not_solvent',                                    // v07
    // DEFENDS
    're_link','re_evidence','mitigate','concede','alt_limited',            // alt_limited は v07
    // ANSWERS（v07で限定解禁）
    'admits','declines_to_answer',
  ]).nullable(),                    // EXTENDS / COMPARES / QUESTIONS / CITES / DROPS では必ず null
  effectivenessAi:    z.enum(['strong','partial','none']).nullable(),
  effectivenessHuman: z.enum(['strong','partial','none']).nullable(),
  effectivenessSetBy: z.string().nullable(),   // 人が書いたときだけサーバが入れる
  reviewStatus: ReviewStatus,
}).refine(l => {
  const allowed: Record<string, readonly string[]> = {
    ATTACKS: ['no_link','not_important','not_unique','evidence_weak','value_turn',
              'alternative_solves','not_solvent'],
    DEFENDS: ['re_link','re_evidence','mitigate','concede','alt_limited'],
    ANSWERS: ['admits','declines_to_answer'],
  };
  const ok = allowed[l.relation];
  return l.effectKind === null ? true : (ok !== undefined && ok.includes(l.effectKind));
}, { message: 'relationに許されないeffect_kind' });

export const RuleFlag = z.object({
  id: z.string(),
  type: z.enum(['new_argument','extra_issue','over_time','over_word_limit',
                'over_speech_rate','speaker_role_mismatch','evidence_incomplete',
                'own_calculation','premature_rebuttal',
                // v07で追加
                'audibility_gap','stage_coverage_gap','stage_duration_anomaly',
                'segment_duration_anomaly','communication_in_content']),
  targetRef: z.string(),
  rationale: z.string(),
  status: z.enum(['candidate','confirmed','rejected']),
});

export const ComparisonAxis = z.object({
  axis: z.enum(['magnitude','probability','timeframe','value']),
  rationale: z.string().min(1),          // 点数ではなく理由の記述
  segmentIds: z.array(z.string()),       // source='debater' なら1件以上
});

export const SummaryLink = z.object({
  id: z.string(),
  linkId: z.string(),                    // COMPARES の flow_link
  ownIssueId: z.string(),
  opponentIssueId: z.string(),
  source: z.enum(['debater','judge']),
  axes: z.array(ComparisonAxis).min(1),
  reviewStatus: ReviewStatus,
}).refine(
  s => s.source === 'judge' || s.axes.every(a => a.segmentIds.length > 0),
  { message: 'debater由来の比較軸には根拠segmentが要る' }
);
```

### 13.3 judge

```ts
export const IssueAssessment = z.object({
  issueId: z.string(),
  probability: z.enum(['Hi','Lo']),
  value: z.enum(['Large','Small']),
  strength: z.enum(['Strong','Weak','None']),
  residualNote: z.string().nullable(),      // v07: Strength='None' のとき必須
  segmentIds: z.array(z.string()),
}).refine(
  a => a.strength !== 'None' || (a.residualNote !== null && a.residualNote.trim().length > 0),
  { message: 'Strength=None には残存リスクの記述が要る' }
);

export const ReasonParagraph = z.object({        // v07
  text: z.string().min(1),
  ground: z.enum(['content','comparison','procedure','delivery','advice']),
  segmentIds: z.array(z.string()).min(1),        // §11.3 根拠の必須化
});

export const JudgeRun = z.object({
  id: z.string(),
  matchId: z.string(),
  flowRunId: z.string(),
  rulesetVersion: z.string(),
  model: z.string(),
  assessments: z.array(IssueAssessment).max(4),
  votingIssueDraft: z.enum(['AD1','AD2','DA1','DA2']).nullable(),
  winnerDraft: z.enum(['AFF','NEG']).nullable(),
  newArgumentFlags: z.array(z.string()),
});

export const JudgeDecision = z.object({          // ジャッジ1人ぶんのバロット。AI案を上書きしない
  id: z.string(),
  matchId: z.string(),
  winner: z.enum(['AFF','NEG']),                // 引き分けは存在しない
  votingIssue: z.enum(['AD1','AD2','DA1','DA2']),
  assessments: z.array(IssueAssessment).max(4), // v07: 人が確定したDecision Chart
  commPoints: z.object({
    aff: z.number().int().min(1).max(5),
    neg: z.number().int().min(1).max(5),
  }),
  bestDebater: z.string().nullable(),
  reason: z.string().min(1),
  reasonGrounds: z.array(ReasonParagraph).min(1),  // v07: 段落ごとの根拠種別
  compareNote: z.string().min(1),                  // v07: 残ったもの／削られたもの
  isChief: z.boolean(),                            // v07: 審査委員長のバロットか
  decidedBy: z.string(),
  lockedAt: z.string().datetime().nullable(),
});

export const PanelResult = z.object({            // v07: ビューからの導出。保存しない
  matchId: z.string(),
  panelSize: z.number().int().positive(),        // 奇数
  ballotsCast: z.number().int().min(0),
  affVotes: z.number().int().min(0),
  negVotes: z.number().int().min(0),
  winner: z.enum(['AFF','NEG']).nullable(),      // ballotsCast < panelSize のとき null
  dissenting: z.array(z.string()),               // 多数と異なるバロットのid。消さない
});
```

> **スキーマ上で保証すること** 引き分けを表現できないこと（human winnerはAFFかNEGの二択）、Communicationが1〜5整数、AD/DA各側2件まで、ArgumentNodeが根拠segmentを持つこと、B_LINKだけがlinkOrderを持つこと、ディベーター由来比較軸に根拠segmentがあること、relationごとeffect_kind値域が閉じていること、Strength=NoneにresidualNoteがあること、判定理由段落がgroundとsegmentを持つこと、panel_sizeが奇数であること。v08ではさらにRule State、ScoringConfig、DecisionSupportを別スキーマにし、AI reference layerがhuman ballotの型を生成・更新できない構成を保証する。

### 13.4 scoring / decision-support（v08で追加）

```ts
export const NodeLevel = z.number().int().min(0).max(4);
export const ImpactDirection = z.union([z.literal(1), z.literal(-1)]);

export const RuleState = z.enum([
  'ADMISSIBLE',
  'ADMISSIBLE_REEMPHASIS',
  'ADMISSIBLE_COMPARISON_MICRO',
  'ADMISSIBLE_COMPARISON_MACRO',
  'ADMISSIBLE_NEW_EVIDENCE_FOR_COMPARISON',
  'NEEDS_CITATION',
  'INADMISSIBLE_NEW_ADVANTAGE',
  'INADMISSIBLE_NEW_DA',
  'INADMISSIBLE_NEW_PLAN',
  'INADMISSIBLE_NEW_ATTACK',
  'INADMISSIBLE_PREMATURE_REBUTTAL',
  'INADMISSIBLE_EXTRA_ISSUE',
  'INADMISSIBLE_OVERTIME',
  'INADMISSIBLE_LATE_REPAIR',
  'DROPPED',
  'UNVERIFIABLE',
]);

export const ClaimedEffectCat = z.enum(['none','minor','moderate','major','decisive']);
export const SupportCat = z.enum(['unsupported','weak','adequate','strong']);
export const RecoveryCat = z.enum(['none','minor','partial','substantial','full']);

export const ScoringConfig = z.object({
  version: z.string(),
  nodeMap: z.record(z.string(), z.number()),
  claimedEffectMap: z.record(ClaimedEffectCat, z.number()),
  supportMap: z.record(SupportCat, z.number()),
  recoveryMap: z.record(RecoveryCat, z.number()),
  probabilityHiThreshold: z.number().min(0).max(1),
  valueLargeThreshold: z.number().min(0).max(1),
  strengthStrongThreshold: z.number().min(0).max(1),
  strengthNoneThreshold: z.number().min(0).max(1),
  chainRule: z.enum(['weakest_link','product']),
  qaEffectMode: z.enum(['cited_only','always']),
  valueTurnMode: z.enum(['review_gate','signed_net']),
  summaryEvidenceMode: z.literal('comparison_only'),
});

export const VotingIssueCandidates = z.object({
  survivalCandidate: z.string().nullable(),
  clashCandidate: z.string().nullable(),
  clashLeverage: z.record(z.string(), z.number()),
  winnerFlipIssues: z.array(z.string()),
  selected: z.string().nullable(),
  confidence: z.enum(['high','medium','low']),
});

export const DecisionSupport = z.object({
  matchId: z.string().uuid(),
  scoringConfigVersion: z.string(),
  issues: z.array(z.object({
    label: z.enum(['AD1','AD2','DA1','DA2']),
    p: z.number().min(0).max(1),
    pCat: z.enum(['Hi','Lo']),
    v: z.number().min(0).max(1),
    vCat: z.enum(['Large','Small']),
    strength: z.number().min(0).max(1),
    strengthCat: z.enum(['Strong','Weak','None']),
    decisiveEventIds: z.array(z.string().uuid()),
  })),
  affSum: z.number(),
  negSum: z.number(),
  margin: z.number(),
  winnerSuggestion: z.enum(['AFF','NEG','REVIEW_REQUIRED']),
  votingIssueCandidates: VotingIssueCandidates,
  flags: z.array(z.string()),
});
```

この型はAI reference layer専用であり、人間BallotのZodとは別ファイルに置く。依存方向は `flow -> scoring -> decision-support` とし、`human-ballot`から`decision-support`への参照はUI表示用のread onlyに限定する。

### 13.5 バージョニング

- ruleset.version は大会ルールの改定日（例：2025-11-28）を使う。
- スキーマの破壊的変更は一括で行う。散発的にフィールドを足さない（whosaid-editorの教訓）。
- 生成物 docs/schemas/*.json はCIで再生成し、差分があれば失敗させる。

## 14. API契約（v04で追加）

v03はZodスキーマ・DB・画面・PR分割まで細かく決めていたが、HTTP APIが定義されていなかった。本アプリは「confirmed / excluded / locked を書けるのはサーバのAPIだけ」と宣言している。つまりAPIがセキュリティ境界そのものであり、そこが未定義のままでは実装を始められない。

完全な契約は docs/API_SPEC.md に置く。本章はその要点である。

### 14.1 共通仕様

| 項目 | 規約 |
|---|---|
| ベースパス | /api/v1 |
| 成功応答 | { "data": ... } |
| 失敗応答 | { "error": { "code", "message", "details" } } |
| 認証 | Authorization: Bearer（Supabase Auth JWT）。サーバで検証しactor_idを得る |
| 認可 | actor_idが対象matchのメンバーであること。トランザクション内でSET LOCAL app.actor_idを発行し、RLSにも同じ値を渡す |
| 内部API | /api/v1/internal/* は X-Job-Secret のみ。JWTを受け付けない |
| 楽観ロック | lock_versionを持つのは matches / issues / argument_nodes / flow_links / summary_links / judge_decisions / transcription_jobs / stage_segments の8表（stage_segments はv07で追加。coverage_status を人が直すため）。これらの更新でexpectedVersionを必須にする。省略は400、不一致は409 |
| 冪等性 | 副作用のあるPOSTはIdempotency-Keyヘッダを必須にする。再送は既存結果を返す |

### 14.2 主なエラーコード

| code | HTTP | 意味 |
|---|---|---|
| VALIDATION_FAILED | 400 | Zod検証失敗 |
| FORBIDDEN | 403 | matchのメンバーでない |
| VERSION_CONFLICT | 409 | expectedVersion不一致。currentVersionを返す |
| CONSENT_REQUIRED | 409 | 許諾未記録のまま解析しようとした |
| DECISION_LOCKED | 409 | ロック済みの判定を変更しようとした |
| AUDIBILITY_UNRESOLVED | 409 | 根拠segmentにaudibility = unknownが残っている |
| UNHEARD_CITED | 409 | 根拠segmentにaudibility = unheardが含まれている |
| GAPPED_STAGE_CITED | 409 | 根拠segmentが coverage_status ≠ complete のステージに属している（v07） |
| BALLOT_DUPLICATE | 409 | 同一ジャッジが同一matchに2票目を入れようとした（v07） |
| NON_STAGE_SEGMENT_CITED | 422 | 自己紹介・アナウンス等、stage_no を持たない区間を判定根拠に引こうとした（v07） |
| STAGES_NOT_CONFIRMED | 409 | ステージ未確定でPass Bを起動しようとした |
| NODE_WITHOUT_SEGMENT | 422 | segmentIdsが空 |
| INVALID_LINK_DIRECTION | 422 | relationの方向違反 |
| ISSUE_LIMIT_EXCEEDED | 422 | 片側3件目のIssue |
| RETENTION_PURGED | 410 | 保持期限切れで削除済みの層を要求した |

### 14.3 エンドポイントの骨格

| 領域 | 主なエンドポイント | 備考 |
|---|---|---|
| Match | POST/GET/PATCH /matches、POST /matches/{id}/consent、PUT /members | 許諾未記録では解析を開始できない |
| Media | POST /media/upload-intent、POST /media、GET /media/{id}/playback-url | ファイル本体はAPIを通らない |
| Job | POST/GET /jobs、POST /jobs/{id}/retry、POST /internal/jobs/run | Idempotency-Key必須 |
| Stage | GET/PUT /matches/{id}/stages | confirmを書ける唯一の経路。seatはサーバが導出 |
| Transcript | GET /segments、PATCH /segments/{id}、POST /segments/{id}/audibility | audibilityは人だけが書ける。unknownへ戻すAPIはない |
| Flow | POST /flow/runs、POST /issues /nodes /links、POST /{entity}/{id}/review | reviewStatusを書ける唯一の経路が/review |
| Judge | POST /judge/runs、PUT /judge/ballots/{id}、POST /judge/ballots/{id}/lock、GET /matches/{id}/panel | ballotはジャッジ1人1件。lockで不変条件を検査する。panelはビューからの読み取り専用（v07） |
| Export | POST /exports、GET /exports/{id} | locked済みの判定からのみ |
| Retention | PUT /retention、POST /purge | 第16章 |

### 14.4 サーバが決めること（リクエストで受け取らない）

- id（UUID）とIssueのlabel（AD1 / AD2 / DA1 / DA2）。
- reviewStatusの初期値。AI由来のものは常にsuggestedで入る。
- ステージ確定後のseat（担当者表から導出する）。
- AD合計とDA合計の比較結果。
> **実装上の要点** LLMの応答スキーマに id / label / reviewStatus を含めない。含めると、いつか誰かがそのまま保存する。返させるのはtitleと根拠だけにする。

### 14.5 defineHandler

全エンドポイントを同じ形で書く。例外を作らない。素のRoute Handlerを直接書くと、次のどれかが必ず抜ける。

> **defineHandlerが担保する七つ**
> 1. JWT検証 → actor
> 2. トランザクション開始 → SET LOCAL app.actor_id（RLSがこの値を見る）
> 3. Zod検証（params / body）
> 4. expectedVersionの照合
> 5. Idempotency-Keyの記録と再送判定
> 6. 例外からエラーコードへの変換
> 7. edit_logsへの追記（before / after / actor）

### 14.6 v08 Decision Support API

| Method | Path | 役割 |
|---|---|---|
| POST | `/api/matches/:id/scoring/run` | confirmed FlowからL2カテゴリ候補・clash eventsを生成 |
| POST | `/api/matches/:id/decision-support/recalculate` | scoring_config固定でP/V/Strength、Net sum、counterfactualを決定的に再計算 |
| GET | `/api/matches/:id/decision-support` | 最新AI参考判定とReview Gateを取得 |
| POST | `/api/clash-events/:id/review` | event種別・Rule State候補を人がconfirm/reject |
| POST | `/api/matches/:id/rule-state/rebuild` | confirmed eventからRule Stateをサーバ再判定 |
| GET | `/api/matches/:id/hp-ledger` | L3 HPタイムライン取得 |

`winner_suggestion=REVIEW_REQUIRED`はHTTPエラーではない。正常なDecision Support状態として200で返し、`review_reasons[]`に理由コードと対象segment/eventを含める。

AI workerが`/judge-decisions/*/lock`を呼ぶ権限は持たない。Human Ballotの確定APIとDecision Support APIを認証スコープでも分離する。

## 15. 画面設計

### 15.0 v08で追加する評価ビュー

1. **Decision Support View（L1）**：Judge Sheet形式でP/V/Strengthカテゴリ、内部値、Net sum、Voting Issue二候補、Review Gateを表示。常に「AI参考判定」。
2. **Clash Ledger View（L2）**：論点→ノード→Attack→Defense→Rule State→残存値を時系列・逆引きで表示。
3. **Counterfactual View（L2）**：各Issueをconstructive_endへ戻した場合のmargin変化とwinner_flipを表示。ジャッジ研修・開発用で、通常の生徒画面では詳細を隠せる。
4. **HP / Learning View（L3）**：HP、デリバリー、初心者向け説明。公式判定と視覚的に区別する。
5. **Human Ballot View**：従来のJudge Sheet。AI候補は右側に参考表示できるが、各欄を人が確定する。

Review Gateがある場合、画面上部に赤または警告アイコンだけでなく、**なぜ止まったか・どの発言を確認するか**を具体的に表示する。


| 画面 | 主要UI | 目的 | 音の確認が必要か |
|---|---|---|---|
| A. 試合登録 | Motion / Round / 両チーム / 出場者（A1〜N4）/ ruleset選択 | 入力 | 不要 |
| B. メディア取り込み | ファイル選択、抽出（必要時）、アップロード進捗、指紋表示、whosaid JSON取り込み | 取り込み | 不要 |
| C. ステージ確認 | 波形＋定型句ヒット位置＋12ステージ境界のドラッグ調整＋自己紹介ラウンドの範囲指定＋ステージ長の妥当性警告＋欠損の記録 | 区間確定 | 必要 |
| C2. 座席の結び付け | 自己紹介の名乗り区間と A1〜N4 の対応、担当宣言との突き合わせ、名簿との照合 | 座席確定 | 必要 |
| D. Transcript Review | 左：区間一覧／中央：本文／右：再生・audibility・時刻確認 | 文字起こし確認 | 必要 |
| E. Flow Editor | 公式Flow Sheet型ボード、Argumentカード、矢印、RuleFlag | 議論追跡 | 一部必要 |
| F. Judge Assistant | Decision Chart、New Argument、Voting Issue、Communication、Strength=Noneの残存リスク記述、Compare欄 | 判定支援 | 一部必要 |
| F2. パネル | バロット一覧、多数と少数、Voting Issueの分布、判定理由の並置 | ジャッジ間比較 | 不要 |
| G. Explanation | 判定理由、タイムコード、勝敗を分けた場面、指導コメント | レポート確認 | 不要 |
| H. Export | Word（公式版・拡張版）、JSON、確定版ロック | 成果物出力 | 不要 |
| I. 履歴 | Run一覧、差分、再解析、監査ログ | 再現性 | 不要 |

最終列は第18章の受け入れ基準に直結する。「音の確認が必要」と書かれた画面は、CIが通っても人が確認するまで完了としない。

### 15.1 Flow Editorの操作方針

- セル内のカードを選ぶと、右ペインに原文・時刻・音声再生・AI根拠・確認状態を表示する。
- 矢印はカードのドラッグで引く。relationは引いた後に選ぶ。
- AI提案の矢印は点線。人が確認すると実線になる。
- 肯定側と否定側は色で分ける。紙のフローシートの慣習（肯定＝赤系、否定＝青系）に合わせる。
- キーボードだけで一周できること。Transcript Reviewと同じキー割り当てを使う。

## 16. セキュリティ・個人情報・権利

### 16.1 扱うデータの性質

本アプリは、未成年である高校生の音声と氏名を扱う。これは個人情報であり、扱いを誤ると事業そのものが止まる。クラウド完結にしたことで、データが外部サービスを経由する経路も増えている。

### 16.2 規約（確定）

| 規約 | 内容 | 強制方法 |
|---|---|---|
| 実データをGitに入れない | 実試合の音声・映像・氏名・transcriptをリポジトリに置かない | .gitignore＋CIで音声/映像拡張子と大容量ファイルを検出して失敗させる |
| fixtureは合成データのみ | CIで使う正解データは架空の試合から作る（付録G） | レビュー規約。fixture配下に実データ由来のファイルを置かない |
| 外部送信先の明示 | どのAPIへ音声とテキストを送るかを画面に表示し、同意を得てから実行する | 取り込み画面での明示的な同意チェック |
| 未成年の同意 | 録音・利用の許諾（本人・保護者・学校）を試合単位で記録する | matches に consent_scope / consent_recorded_at / consent_recorded_by / retention_level の4列を持ち、consent_scope が未記録のmatchではジョブを作成できない（409 CONSENT_REQUIRED）。consent_scope の値域は practice / training_material / research / expert_reference で、expert_reference はPhase C専用（§17.7） |
| 段階的な保持 | 音声・transcript・氏名・フロー判定を別レベルとして扱い、試合単位で期限を設定できる | 保持レベルA〜E（§16.3）。削除順序をDBトリガで強制する |
| 非公開ストレージ | バケットは非公開。署名URLは短命 | バケット設定＋サーバでのURL発行 |
| APIキーの秘匿 | クライアントにキーを出さない | 外部API呼び出しはサーバ経由のみ |

> **クラウド完結にしたことの代償** ローカル完結なら「録音を外に出さない」が成立する。クラウドにした以上、それは成立しない。だからこそ、送信先の明示と許諾の記録を任意ではなく必須の工程にする。録音を外部に出せない案件には、whosaid-editorでのローカル前処理と作業JSON取り込みという経路を用意する（§6.7）。

### 16.3 保持レベルと段階的削除（v04で追加）

v03は「音声を消してもフローと判定は残せる」とだけ書いていた。しかし個人情報になり得るのは音声だけではない。transcriptの本文、選手の氏名、判定理由に含まれる引用、監査ログの差分も同じである。したがって保持を5層に分け、試合単位で「何を、いつ消すか」を指定できるようにする。

| レベル | 内容 | 消したら失われるもの | 残るもの |
|---|---|---|---|
| A 音声・動画 | Storage上のメディア本体 | 原音での再確認、audibilityの再判定 | 時刻・本文・フロー・判定 |
| B transcript本文 | text_ai / text_human、align_words | 発言内容の閲覧、逐語記録としての価値 | ノードの要約・フロー構造・判定 |
| C 氏名・識別情報 | display_name、best_debater、本文中の人名 | 誰の試合かの特定 | 座席ラベル（A1〜N4）・構造・判定 |
| D フロー・判定 | issues / nodes / links / judge / 解説 | 議論構造と判定記録 | 匿名化された集計値 |
| E 匿名化統計 | 試合数、ステージ長、フラグ件数、一致率 | — | （最後まで残す層） |

- 削除は A → B → C → D の順にしか進めない。Dだけ消してBを残す、のような穴あきは許さない（Bが残っていれば実質的に復元できてしまうため）。
研修教材・研究（training_material / research）の試合は、「氏名だけを即匿名化する」という運用にしない。v05はそう書いていたが、それは音声(A)とtranscript(B)を残したままC層を消す操作であり、上の順序規則に正面から反する。しかも順序規則の根拠がそのまま当てはまる。スピーチには必ず名乗りが入るため、Aが残っていれば氏名は復元できてしまう。

代わりに「即時匿名化プロファイル」を用意する。これらの試合は、解析が完了しG0相当の確認が済んだ時点で A → B → C を1トランザクションで実行する。中間状態を作らないので順序規則を破らず、氏名も音声も残らない。残るのはフロー構造と判定（D層）以降である。このプロファイルを選んだ試合は、取り込み時点でその旨を画面に表示し、後から音声を再確認できないことを明示する。

- 既定の保持期限は許諾の範囲から導く。校内練習（practice）なら音声90日・transcript1年。許諾に期限があればそちらが優先される。
- 削除はトランザクション内で完結させる。半分だけ消えた状態を作らない。
- UIは削除済みの層を「削除済み」と明示する。空欄にして「データがない」ように見せない。
> **見落としやすい二点**
> 1. edit_logs を忘れない。追記専用にしてあるため、本文や氏名がここに残り続けると、消したつもりで残る。追記の原則は保ちつつ、削除に伴う差分の伏せ字化だけを専用関数に許可し、その操作自体も記録する。
> 2. 本文中の人名を自動置換しない。スピーチには選手の名乗りが必ず入り、証拠資料の引用には専門家の氏名が入る。前者は消すべきで後者は消してはいけないが、機械的な人名検出では区別できない。名乗り区間を人が印付けし、その区間だけを伏せる。v07でその印を列として持たせた。transcript_segments.is_self_naming が true の区間と、match_members.intro_segment_id が指す区間が伏せ字の対象である。実試合では名乗りが二か所（開会の自己紹介と各スピーチ冒頭）にあったため、両方を対象にする。
> 3. 保持レベルCで消えるのは氏名であって、座席と担当ではない。実試合の書き起こしから氏名を落としても、A1が立論しA3がディフェンスを担当したという競技上の記録は完全に残る。§9.9の役割優先UIは、この状態でも画面が虫食いにならないことを保証するためのものである。

詳細は docs/PRIVACY_RETENTION.md を正本とする。

### 16.4 権利

- 大会の映像・音声には、大会主催者・学校・出場者の権利が関わる。教材化・公開の前に権利者の確認を取る。
- 公開動画の無断ダウンロード機能は実装しない。
- 証拠資料そのもの（新聞記事等）を本アプリに保存・再配布しない。保存するのは引用の出典情報と、試合中に読み上げられた範囲のtranscriptである。

## 17. 開発ロードマップとPR分割

### 17.1 進め方の原則

- 1 PR = 1縦切り。受け入れ基準を満たしたことを確認するまで、次のPRへ進まない。
- 指示書を書くセッションと、実装するセッションを分ける。指示書は、書いた本人が口頭で補わなくても成立する程度に自足させる。
- 仕様変更は本書の改訂として行う。コードだけを先に変えない。
- ブランチは feature/xxx → PR → main。コミット履歴を残す。

### 17.2 縦切りを先に1本通す（v04で再構成）
v08では「最終製品の全工程を細く1本通す」という原則を維持するが、評価エンジンを検証するため**4つのIssueすべて**を最初の実試合縦切りで扱う。AD1/DA1だけではNet sum、Voting Issue二候補、counterfactual、Value turn Review Gateを検証できないためである。

> **Phase A（評価エンジン縦切り）の範囲**
> 許諾済み実試合1本 → Stage/Transcript確認 → AD1/AD2/DA1/DA2のA/B/C → Support Quality → clash_events → Rule State → constructive_end snapshot → AI P/V/Strength → Net sum → Voting Issue survival/clash候補 → Review Gate → Human Ballot比較 → Decision Support Word出力。
>
> 観戦演出・大量バッチ・熟練ジャッジDBは後回しにする。一方、スキーマ上は`scoring_config / argument_node_scores / clash_events / rule_state_table / issue_snapshots / official_decision_support`をPhase A開始時に作る。後から足すとDB・API・UI・promptすべてが破壊的変更になるためである。

**Phase Aでの原則**

- AIはカテゴリ候補を出すが、数値写像はサーバが行う。
- Human BallotはAIから独立して人が確定する。
- Review Gateが発火するケースを少なくとも1件fixtureへ含める。
- `weakest_link`と`product`は両方計算可能にするが、初期表示はweakest_link。
- 1試合縦切りが完了するまでHPの見た目調整へ時間を使わない。
### 17.2.1 v08 評価エンジンの縦切り

最初に第13回決勝1試合だけで次を端から端まで通す。

1. AD1/AD2/DA1/DA2のA/B/Cを人手で正解付与。
2. Node Level + Support QualityをAI候補化。
3. ⑤/⑦Attackと⑨/⑩Defenseをclash_eventsへ登録。
4. Rule Stateをサーバ決定。
5. constructive_end snapshotを保存。
6. P/V/Strengthを再計算。
7. survival/clash Voting Issue候補を出す。
8. Value turn / UNVERIFIABLE Review Gateを確認。
9. Human Ballot 4-1と比較する。
10. AI Decision SupportとHuman Ballotが混在していないことをDB権限・画面で確認する。

この1本が通る前に、観戦演出や大量バッチ処理へ進まない。

### 17.3 PR一覧

| PR | 内容 | 主な受け入れ基準 | 検証 |
|---|---|---|---|
| P-1 | Gold Dataset v01（先行作業・実装ではない） | 正解Flow・正解Judge Sheet・正解判定理由まで揃う | 人 |
| P0 | 雛形、CI、DB接続（Supavisor / prepare: false）、マイグレーション | CIが緑。デプロイされたURLが開く。prepare: false の静的検査と、Supavisor 6543 へのスモークテストの両方がある（§17.6） | CI |
| P1 | rulesetとZodスキーマ、JSON Schema生成 | 壊したrulesetで必ず失敗する。再生成で差分ゼロ | CI |
| P2 | API基盤（defineHandler）と試合登録 | expectedVersion省略が400、不一致が409。他人のmatchがRLSで見えない | CI |
| P3 | メディア取り込み（TUS・指紋・署名URL） | ファイル本体がAPIを通過しない。sha256が一致する | CI＋人（G1） |
| P4 | ジョブ基盤（stub provider） | 冪等キーで二重実行が防げる。失敗ジョブだけ再実行できる | CI |
| P5 | Pass A（実provider接続） | 42分から単語時刻が取れる。契約テストが緑 | CI＋人 |
| P6 | Pass S（ステージ推定） | 境界誤差2秒以内、誤分類ゼロ。質疑の文言重複を判別できる | CI |
| P7 | ステージ確認UI | seatがサーバで導出される。人が確認するまでhuman_confirmedにならない | 人（G3） |
| P8 | Pass B（ステージ単位逐語） | 1ステージだけ再実行できる。未確定なら409。provider が capabilities.contextCache=true を宣言している場合はキャッシュ利用を確認できる | CI＋人（G4） |
| P9 | Pass C（アンカー照合・TS移植） | 音声なしのfixtureで完結。被覆率0.6未満なら書き換えない | CI（G2） |
| P10 | Transcript Review UI | audibilityを人だけが書ける。unknownへ戻すAPIがない。再解析でhuman_*が減らない | 人 |
| P11 | Flow基盤（AD1 / AD2 / DA1 / DA2） | 4つの主要Issueを保持でき、segmentIds 0件のノードを作れない。reviewStatusは/reviewだけが書ける | CI＋人 |
| P12 | Judge最小と判定ロック | unknownが残ると409。AFF/NEG反転で判定が対称に反転する | CI＋経験者（G6） |
| P13 | 判定理由メモのWord出力 | 根拠なし段落ゼロ。2回生成して差分ゼロ | CI＋人 |
| ★G0 | 縦切り貫通ゲート | 合成試合1本が取り込みからWord出力まで通る | 人 |
| P14 | 全relation・境界ケース | 片側3件目が422。DROPSが導出されsuggestedで出る。4 Issueの全relationをfixtureで再現する | CI（G5） |
| P15 | Rule State Engine＋RuleFlag互換 | Rule State主要分岐と既存RuleFlagをfixtureで再現。INADMISSIBLE系がAI集計に入らず、未解決candidateが残るとロックできない | CI |
| P16 | Communicationと語数・速度 | 勝敗の計算に一切入らない | CI |
| P17 | 7成果物すべて | AI参考判定とHuman Ballotが明示分離。すべてで根拠なし段落ゼロ | CI＋人 |
| P17.5 | HP View（学習/観戦用） | 常に「AI推定」と表示。判定コードがHPをimportしていない | CI |
| P18 | whosaid-editorインポート | ✓と△の意味論が保存される。schema 5以外を422で拒否 | CI |
| P19 | 保持レベルと削除 | A→B→C→Dの順序を強制。edit_logsから本文と氏名が消える | CI＋人 |
| P20 | 履歴・再現・監査 | 同じ確定版から差分ゼロで再生成できる | CI（G7） |
| P21 | 熟練ジャッジ参照DB（Phase C） | expert_reference以外の試合を取り込めない。熟練者コメントが判定を上書きしない | CI＋人 |

v07で追加したPR（継承）

| PR | 内容 | 主な受け入れ基準 | 検証 | 入る場所 |
|---|---|---|---|---|
| P7.5 | 自己紹介ラウンドと座席結び付け（画面C2） | stage_no が NULL の区間は event_id を持つ。判定根拠に引くと422。名乗り区間が特定されないと human_confirmed にならない | CI＋人 | Phase A（P7の直後） |
| P7.6 | ステージ長の妥当性検査と欠損の記録 | 規定時間の2倍を超えるステージで stage_duration_anomaly が立つ。coverage_status を人だけが missing にできる | CI＋人 | Phase A（P7の直後） |
| P12.5 | 欠損ステージの引用禁止 | coverage_status ≠ complete の区間を根拠に引くと 409 GAPPED_STAGE_CITED。該当 stage_no と segment id が返る | CI | Phase A（P12の直後） |
| P13.5 | Strength=Noneの残存リスクと判定理由の根拠種別 | residualNote 無しの None が422。根拠segmentを持たない段落が生成されない | CI＋経験者 | Phase A（P13の直後） |
| P22 | パネルとバロット（§10.7） | 同一ジャッジの2票目が409。panel_size が偶数だと422。少数意見が集計後も残る | CI | Phase B |
| P23 | 伝達評価の混入検出（§10.6） | ground='delivery' の段落がVoting Issueの理由に使われると communication_in_content が candidate で立つ。自動除外しない | CI | Phase B |
| P24 | ジャッジ間比較レポート（成果物07） | 一致・不一致とその理由が並ぶ。少数意見の判定理由が省略されない | CI＋人 | Phase C |


v08で追加するPR

| PR | 内容 | 主な受け入れ基準 | 検証 | 入る場所 |
|---|---|---|---|---|
| P1.5 | scoring schema / config | Strength=P×V、RuleState全値、config版がZod/DBで一致 | CI | Phase A |
| P11.5 | A/B/C + Support Quality score | node level 0〜4、unverifiable分離、constructive snapshot保存 | CI＋経験者 | Phase A |
| P11.6 | clash_events / Rule State | parent event、Attack/Defense離散尺度、LATE_REPAIRを再現 | CI＋経験者 | Phase A |
| P12.1 | AI Decision Support | P/V/Strength・Net sumを決定的再計算。同入力同configで差分ゼロ | CI | Phase A |
| P12.2 | Voting Issue counterfactual | survival/clash候補、clash_leverage、winner_flipをfixtureで再現 | CI＋経験者 | Phase A |
| P12.3 | Value turn Review Gate | turn有無でwinner反転時にREVIEW_REQUIRED。human ballotは変更されない | CI | Phase A |
| P12.4 | Decision Support / Ballot権限分離 | AI roleからhuman ballot表へのwriteがDBで拒否 | CI | Phase A |
| P17.6 | HP ledger / Learning View | HP=10×AI Strength、scoring_config版記録、human winnerから逆算しない | CI＋人 | Phase B |
| P24.5 | Calibration harness | pilot/calibration/hold-outのdataset split固定、hold-outでconfig変更不可 | CI＋経験者 | Phase C前 |

> **P7.5とP7.6をPhase Aに入れる理由** どちらも「後から足すと破壊的変更になる」側である。transcript_segments.stage_no を NULL 可にする変更と、stage_segments への coverage_status 追加は、データが入った後では移行が要る。§17.2が「A/B/C・Support Quality・scoring_config等をPhase A開始時に固定する」と決めたのと同じ理由で、列そのものは先に入れ、UIと検査をP7.5・P7.6で足す。
> P12.5とP13.5も同様に、ロックの不変条件と判定理由の形に関わるため、★G0を通る前に入れる。パネル（P22）だけはPhase Bへ送ってよい。1人運用が既定であり、縦切りの貫通には要らないためである。

### 17.4 最初にGold Dataset v01を作る

v02の「次の一手」は、実試合1本について人間が作った正解Flow・Judge Sheet・判定理由をGold Datasetにする、というものだった。方向は正しいが、クラウド完結では成立しない。実試合の音声と氏名はGitに置けず、CIから参照できないためである。

> **Gold Dataset v01（合成試合）**
> 架空の論題で12スピーチの英語原稿を書く。AD2つ、DA2つ、Attack、Defense、Summaryを含め、意図的にNew Argument・語数超過・担当者違反・証拠要素の欠落を1〜2箇所ずつ仕込む。
> 原稿をTTSで音声化し、チェアパーソンのアナウンスと準備時間も挟んで1ファイルに組み立てる。計時対象は42分だが、アナウンスを含めた実ファイルは45〜50分になる（§3.1）。これもクラウドで完結する。
> 原稿は正解transcriptそのものになる。正解Flow、正解RuleFlag、正解Judge Sheet、正解判定理由を人が作る。
> この一式をリポジトリに置く。公開できる合成データなので、権利と個人情報の問題がない。

実試合での検証は別に行う。ただしそれはCIの外側であり、人が実施して結果だけを記録する。

### 17.5 着手順

P0を先に置く。理由は三つある。第一に、実データ混入を検出するCIが先に入っていないと、Gold Datasetを置いたときに検査の仕組みがない状態になる。第二に、P0は軽く、開発環境が実際に回るか（Docker上のSupabase起動、マイグレーション、Playwrightでの再生位置アサート、CIからSupavisorへのスモークテスト）を最初に確かめられる。第三に、P-1は原稿執筆と正解データ作成が主で、リポジトリの足場を必要としないため並行できる。

P1の受け入れテストには手書きの小さなfixtureを使う。Gold Datasetが必要になるのはP6（ステージ推定）からなので、そこまでにP-1が終わっていればよい。着手順はP0 → P1 → P2 …であり、v05末尾にあった「P0は完了済み」という記述は誤りだったため削除した。

### 17.6 実行環境の使い分け

v05までは「開発をWeb版Claude Codeで完結させる」を方針にしていた。v06でこれを改める。本アプリが中心に持つのは、42分の音声ファイル、Docker上で動かすSupabase、実プロバイダのキーという、どれもクラウドセッションでは扱いにくいものである。主戦場をローカルの開発機に移し、同じマシンでターミナルのCLIとデスクトップアプリのCodeタブを併用する。Web版は補助に回す。

本書で「開発機」と呼ぶのは、本案件の実データを置く1台を指す。現時点では1号機。常時稼働させているため、時間のかかる処理とRemote Controlの接続に向く。ただし別案件と同居するので、Supabaseのポート・.env・Nodeのバージョン・.claude/settings.json をすべてプロジェクト内に閉じる。機材を入れ替えるときはこの一文だけを直せば済むように、以降は号機番号ではなく「開発機」と書く。

別案件と同じマシンを使うことから来る注意が一つある。supabase start の既定ポート54321〜54324は案件間でぶつかるため、本案件は supabase/config.toml でずらす。環境変数をシェルにexportせず、direnvと .nvmrc でプロジェクト直下に閉じる。取り違えを防ぐ実効的な手段は、マシンを分けることではなく、作業ディレクトリの外に設定を置かないことである。

同居はサーフェスの選択にも効く。デスクトップアプリは単一ウィンドウ・単一インスタンスで、セッションは一つのサイドバーに並ぶ。同じマシンで2案件を動かすと、両方のセッションが同じ一覧に混ざる。CLIはセッションが起動したディレクトリに紐づくため、この混同が起きない。同居する環境では、下表のとおりCLIを主に置く理由がもう一つ増える。

| サーフェス | 主に担当する作業 | 選ぶ理由 |
|---|---|---|
| CLI（ターミナル） | 実装全般。Docker・Supabase CLI・dev server・テスト・マイグレーションに触る作業 | 同じシェルで動くため .env / nvm / Dockerコンテキストが実行時と一致する。セッションが起動ディレクトリに紐づくので別案件と混ざらない。権限モードをセッション単位で決められる。claude -p でスクリプト化できる |
| デスクトップアプリ（Codeタブ） | 指示書の作成、差分レビュー、長い自律実行の見守り、複数タスクの管理 | 進行と差分を目で追える。サイドバーで並列セッションを扱える |
| Web版 | 音声・実キー・Dockerを必要としない回（スキーマ、型、純粋計算、テスト） | どの端末からでも入れる。本アプリでは補助の位置づけ |

併用で守る一つ目の約束 セッションはサーフェス間で共有されない。各クライアントは自分が作ったセッションしか一覧に出さないため、CLIで始めた会話をデスクトップ側で再開することはできない。したがって「途中で乗り換える」ことを前提にしない。セッションを跨ぐ受け渡しは、必ずリポジトリ内のファイル（指示書、CLAUDE.md、PR説明）で行う。これは§17.1の「指示書を書くセッションと、実装するセッションを分ける」とそのまま噛み合う。指示書がファイルとして残るので、受け渡しの問題がそもそも起きない。

併用で守る二つ目の約束 同じ作業ツリーで2つ同時に走らせない。ファイルの取り合いになる。並列にするなら git worktree でブランチごとにディレクトリを分ける。§17.1の「1 PR = 1縦切り」が、そのまま worktree の単位になる。

```bash
# 並列に進めるときは worktree を切る
git worktree add ../ada-p1 feature/p1-schema
git worktree add ../ada-p2 feature/p2-api

# 片方をCLI、もう片方をデスクトップアプリで開く
cd ../ada-p1 && claude
```

> **Web版を補助に使う場合の環境**
> Ubuntu 24.04（x86_64）、約4 vCPU / 16 GB RAM / 30 GB ディスク。
> Node.js 20 / 21 / 22、Docker、chromedriver、そして PostgreSQL 16 と Redis 7 がプリインストールされている。
> PostgreSQL 16が入っているため、スキーマ・型・純粋計算のPRであれば、実Supabaseに触れずにWeb版だけで完結できる。ローカルで同じことをする場合は Supabase CLI（Docker）を使う。

ローカルでは Supabase CLI で Postgres を Docker に立て、マイグレーション・RLSポリシー・トリガー・CHECK制約をそこで検証する。開発中のどのサーフェスからも、本番の認証情報で実Supabaseプロジェクトへ接続しない。エージェントが本番データベースを直接触れる状態を作らないためである。本番へのマイグレーション適用はGitHub Actionsから行う。

ローカルPostgresでは検証できないもの（v06で明記） prepared statementが使えないのはSupavisorのtransaction mode固有の挙動であり、素のPostgres 16は普通に受け付ける。Supabase CLIが立てるのも素のPostgresなので、「prepare: false を検証するテスト」をローカルで書いても、設定値をアサートするだけで、§4.2が警告した「指定を忘れると本番でだけ落ちる」はそのまま起きる。P0の受け入れ基準は二段構えにする。第一に、postgres.jsの初期化オプションが prepare: false であることをコードの静的検査で確かめる。第二に、GitHub ActionsからSupavisorのtransaction mode（6543）へ実際に接続し、prepared statementを使う経路が失敗することをスモークテストで確かめる。後者はCIの秘密情報を使うため、ローカルからもクラウドセッションからも実行しない。

ローカルの .env に置くのは検証用のキーだけとする。本番の認証情報はGitHub Actions Secretsにだけ置く。Web版を補助に使う場合、クラウド環境には専用のシークレットストアがなく環境変数はその環境を使う人全員から読めるため、シークレットを一つも置かない。その結果、Web版のネットワークアクセスは既定のTrustedのままでよい。

実データを持つ端末を1台に決める 実試合の音声と .env を持つのは開発機だけとする。他の端末には音声もキーも置かない。§16.2の許諾は試合単位で記録するため、その音声がどの端末にあるかが分からない状態は、許諾の管理そのものが成り立たなくなることを意味する。保持レベルAの削除（§16.3）も、対象が1箇所にあって初めて確実に実行できる。

| PR | 実行場所 | 理由 |
|---|---|---|
| P-1 Gold Dataset | 執筆はどこでも／音声化は開発機 | 42分の音声を組み立てて聴く |
| P0・P3・P4・P5・P8 | 開発機のCLI | Docker上のSupabase、実プロバイダのキー、TUSアップロードの実挙動が要る |
| P1・P2・P6・P9・P11・P12・P13 | CLIが主。Web版でも可 | 純粋計算とスキーマで完結し、音声も外部APIも要らない |
| P7・P10 | CLIで実装 → ブラウザで人が確認 | 再生位置・ステージ境界・audibilityは人の耳 |
| ★G0 縦切り貫通 | 開発機 | 全工程を人が通す |
| P14〜P21 | 原則CLI（P17・P19に人の確認あり） | 印刷確認と削除後の見え方 |

> **見落とすと検証が空回りする点** テーブルの所有者はRLSを素通りする。app_migratorがテーブルを所有し、app_serverにはGRANTだけを与える構成にすること。所有者と接続ロールを同じにすると、RLSのテストが通ったように見えて何も検証していない状態になる。念のためFORCE ROW LEVEL SECURITYも併用する。

ローカルを主戦場にすること自体は、第1章の三条件に反しない。破ってはいけないのは、CIが唯一の判定者であること、絶対パスや手元にしかないファイルをリポジトリの前提にしないこと、本番の認証情報をGitHub Actions Secretsにだけ置くこと、の三つである。whosaid-editorがC:\dev\01配下と導入済みffmpegを前提にしてしまった、あの状態を再発させないための線である。ローカルで開発する以上この危険は現実にあるので、P0のCIに「リポジトリ内の絶対パスとOS固有パスの検出」を入れ、混入したら失敗させる。

### 17.7 Phase C（熟練ジャッジ参照DB・v05で新設）

実試合の映像に、経験豊富なジャッジが「どこで差がついたか」「どの議論が残ったか」を解説している素材がある場合、それは学習・評価資料として価値が高い。3〜4試合から始める。

> **着手前に満たすべき前提（実装より先）**
> 1. 大会映像・音声の権利者の確認（主催者・学校・出場者）。
> 2. 解説している熟練ジャッジ本人の許諾。コメントは個人情報であり著作物でもある。
> 3. 参照データとして使うことへの明示的な同意。通常の録画許諾に「AIの参照データにする」は含まれない。consent_scopeにexpert_referenceを新設し、これを選んだ試合だけを対象にする。
> 4. 保持レベルA〜Cがフルに関わるため、削除期限を先に決めておく。

保存するのは、Turning Point、Issue Evaluation、Attack / Defenseの評価、最終比較の軸と理由、New Argumentの判断、そしてAdviceである。Adviceは判定理由とは別枠に入れる。

> **正解にしない** 熟練者のコメントは唯一の正解として固定しない。熟練ジャッジの判断例・参照データとして扱う。複数ジャッジで見解が分かれる試合は、その差も保存する。教育価値はむしろそちらにある。正解らしきものが手に入るとWinner一致率を上げたくなるが、§18.3.1の「Winner一致率を上げるためにプロンプトを調整しない」は、Phase Cでこそ効く規則である。

## 18. 受け入れ基準と品質ゲート

### 18.1 機械が検証すること

| 対象 | 指標 | 合格条件 |
|---|---|---|
| ruleset整合 | 12ステージ・担当者表・時間の一貫性 | 壊したfixtureで必ず失敗する |
| スキーマ | Zod検証、JSON Schema生成の一致 | 差分ゼロ |
| ジョブ | 状態遷移、冪等性、部分再実行 | 二重実行で結果が変わらない |
| アンカー照合 | 合成fixtureでの時刻誤差 | 中央値0.5秒以内、被覆率閾値未満は書き換えなし |
| ステージ推定 | 合成試合での境界誤差とステージ誤分類 | 誤差2秒以内、誤分類ゼロ |
| ルール検査 | New Argument等のPrecision / Recall | Recall 0.9以上、Precisionは記録して人が判断 |
| Issue抽出 | AD/DAラベル一致、present / effect / importance / evidence の抽出と、otherの比率 | Gold Dataset v01で初回計測した一致率を基準値として記録する。CIのゲートにはしない（下回ったら人がレビューする） |
| Flowリンク | Attack→対象Claim、Defense→Attackの一致率 | Gold Dataset v01で初回計測した一致率を基準値として記録する。CIのゲートにはしない（下回ったら人がレビューする） |
| 出力 | 7成果物の生成、AI参考判定/Human Ballotの分離、根拠なし段落の不在 | 根拠なし段落ゼロ |
| 人手の保存 | 再解析前後でhuman_*件数が減らない | 減っていたら失敗 |
| データ保護 | 音声・映像拡張子と大容量ファイルの混入 | 検出したら失敗 |
| 許諾 | 許諾未記録のmatchでのジョブ作成 | 409 CONSENT_REQUIRED で拒否される |
| ロック不変条件 | 根拠segmentにunknownが残る状態でのロック | 409 AUDIBILITY_UNRESOLVED。該当segment idが返る |
| audibilityの書き手 | ジョブ・解析経路からaudibilityを書こうとする | DBのCHECKで失敗する |
| DB接続方式 | postgres.jsのprepare設定、supabase-jsのDB利用 | コードの静的検査で prepare: false であること。DBアクセスにsupabase-jsを使っていないこと。加えてCIからSupavisor 6543 へ接続するスモークテストが通ること |
| RLS | 他人のmatchへのアクセス | アプリの分岐を外してもRLSで見えないこと |
| 楽観ロック | expectedVersionの省略・不一致 | 省略は400、不一致は409 |
| ノードの根拠 | segmentIds 0件でのノード作成 | 422とDB遅延制約の両方で失敗する |
| 保持と削除 | A→B→C→Dの順序、edit_logsの伏せ字化 | 順序違反が拒否される。B削除後にedit_logsにも本文が残らない |
| effectivenessの分離 | 判定の集計コードが judge_flow_links 以外から effectiveness / comparison を読んでいない | flow_links / summary_links への直接参照とSELECT *を静的検査。参照があったら失敗（§12.4） |
| effectivenessの書き手 | ジョブ・解析経路からeffectiveness_humanを書こうとする | DBのCHECKで失敗する |
| 役割優先UI | 解析・観戦画面からdisplay_nameへの参照 | 参照があったら失敗（登録画面と公式出力を除く） |
| HPの隔離 | 判定の集計コードがHPモジュールをimportしている | importがあったら失敗。逆方向も検査。判定側は judge_flow_links しか読めない |
| 比較の根拠 | source=debaterのComparisonAxisにsegmentIdsが空 | Zod検証で失敗 |
| unheardの引用 | 根拠segmentにaudibility = unheardが残る状態でのロック | 409 UNHEARD_CITED。該当segment idが返る |
| effect_kindの方向 | DEFENDSに no_link、COMPARESに effect_kind を付ける | CHECK制約と422で拒否される |
| Pass Aの時刻精度 | 合成fixtureに対する単語境界誤差 | 中央値0.3秒以内、95パーセンタイル1.0秒以内 |
| 環境依存の混入 | リポジトリ内の絶対パスとOS固有パス | 検出したら失敗（ローカル開発の再発防止） |
| 12ステージ外の区間 | stage_no と event_id の両方がNULL、または両方が非NULL | DBのCHECKで失敗する（v07） |
| 12ステージ外の引用 | stage_no を持たない区間を判定根拠に引く | 422 NON_STAGE_SEGMENT_CITED（v07） |
| 欠損ステージの引用 | coverage_status ≠ complete の区間を根拠に引いた状態でのロック | 409 GAPPED_STAGE_CITED。該当 stage_no と segment id が返る（v07） |
| 欠損ステージのDROPS | coverage_status ≠ complete のステージを to とするDROPS | 導出されない。stage_coverage_gap が立つ（v07） |
| ステージ長の検査 | 規定時間の2倍を超えるステージ、規定時間を超える単一segment | stage_duration_anomaly / segment_duration_anomaly が立つ（v07） |
| 話者ラベルの混入 | providerが返した話者ラベルの保存、align_words の speaker 列 | 列が存在しない。取り込みコードに参照があったら失敗（v07） |
| 座席結び付け | 名乗り区間が未特定のまま seat_binding_status を human_confirmed にする | 422（v07） |
| Strength=None の根拠 | residualNote が空の None | Zod検証で失敗（v07） |
| 判定理由の根拠 | 根拠segmentを持たない段落、ground が未設定の段落 | 生成されない。生成されたらCIで失敗（v07） |
| バロットの一意性 | 同一ジャッジの2票目 | 409 BALLOT_DUPLICATE（v07） |
| パネル人数 | panel_size が偶数 | 422（v07） |
| 少数意見の保存 | パネル結果の導出後に、多数と異なるバロットが消えていないか | 件数と判定理由が保存されている（v07） |
| 伝達評価の混入 | ground='delivery' の段落をVoting Issueの理由に使う | communication_in_content が candidate で立つ。自動除外はしない（v07） |
| ロック検査の分離 | 判定の集計コードが judge_lock_guard をimportしている | importがあったら失敗（v07・§12.4） |

> **negative testを必ず書く** ruleset整合・ロック不変条件・audibilityの書き手・RLS・ノードの根拠は、いずれも「拒否されること」を確かめるテストである。正しいデータで通るだけのテストは、ルールを守れているかを検証していない。

### 18.1.1 評価エンジンの校正・品質ゲート（v08）

**Phase 1：Pilot 10試合**
- 目的：ルーブリック、event種別、Rule State、データ構造の欠陥修正。
- この段階の勝敗一致率を製品性能として公表しない。

**Phase 2：Calibration 30〜50試合**
- 変更可能：scoring_configのみ（カテゴリ写像、閾値、chain_rule等）。
- ルーブリックやDB構造を変更した場合はPhase 1へ戻る。

**Phase 3：Hold-out 20〜30試合**
- パラメータ固定。報告のみ。

| 指標 | Phase 3目標 |
|---|---:|
| AI参考勝敗 vs 多数票 | 80%以上 |
| P/V/Strengthセル一致 | 各75%以上 |
| Human Voting IssueがAI上位2候補に含まれる | 70%以上 |
| Communication提案が人間点±1 | 80%以上 |
| Attack target/type/Rule Stateのκ | 0.6以上 |
| Delivery平文化再採点によるStrength変動 | 10%以内、Voting Issue不変 |
| Review Gate | Value turn・重大欠損等の見逃し率を別途報告 |

`human_disagreement = 少数票 / 総票数`とAI marginは別変数として保存し、4-1を機械的に「僅差」と扱わない。

### 18.2 人が検証すること

| 対象 | 確認方法 | 誰が |
|---|---|---|
| 区間再生の位置 | 無作為に10区間を再生し、意図した発言が鳴るか | 開発者または利用者 |
| ステージ境界 | 12境界すべてを実音で確認 | 利用者 |
| audibility | 聞き取れない箇所の判断 | ジャッジ |
| 逐語の忠実さ | フィラー・言い直し・沈黙が残っているか | 利用者 |
| 判定支援の妥当性 | Decision Chart候補とVoting Issue候補が納得できるか | HEnDA経験者 |
| 解説の妥当性 | 教材として使えるか、判定理由とアドバイスが分離されているか | HEnDA経験者・指導者 |
| 公式版の印刷 | 用紙・余白・表幅が崩れないか | 利用者 |
| 削除後の見え方 | 削除済みの層が「削除済み」と明示されているか | 利用者 |
| 欠損と不明瞭の区別 | 「記録が無い」「聞き取れなかった」「応答しなかった」が画面上で別物として見えるか | ジャッジ |
| 座席の結び付け | 自己紹介の名乗りと担当宣言から、8名の座席が矛盾なく決まるか | 利用者 |
| 少数意見の読み取り | パネル画面で、多数と異なる判定理由が同じ重みで読めるか | HEnDA経験者 |

### 18.3 品質ゲート

| ゲート | 内容 | 通過条件 |
|---|---|---|
| G1 取り込み | 音声が入り、再生できる | 実音声1本で、人が10区間の再生位置を確認 |
| G2 時刻 | アンカー照合が機能する | 合成fixtureで誤差中央値0.5秒以内 |
| G3 ステージ | 12ステージを安定して切れる | 合成試合で誤分類ゼロ、実試合1本で人が全境界を承認 |
| G4 逐語 | 判定材料を落としていない | 実試合1本で、重要論点の聞き落としがないことを人が確認 |
| G5 フロー | 議論の矢印が追える | 合成試合でリンク一致率を記録し、人が実試合1本で承認 |
| G6 判定 | Judge Sheetが埋まり、理由が説明できる | HEnDA経験者2名が、判定理由の説明可能性を承認 |
| G7 再現 | 同じ確定版から同じ資料が出る | 2回生成して差分ゼロ。保持レベルB以降を削除した試合は対象外（410 RETENTION_PURGED） |
| ★G0 縦切り貫通 | 合成試合1本が最後まで通る | 取り込み→ステージ確定→座席結び付け→レビュー→AD1/DA1のFlow→判定ロック→Word出力→再生成で差分ゼロ |
| G8 実試合突き合わせ | 許諾済みの実試合1本で、設計が現実に耐える | 座席が担当者表から矛盾なく決まる。欠損・不明瞭・未応答が別物として記録される。HEnDA経験者が判定理由を承認する（v07・付録H） |
| G9 評価エンジン分離 | AI参考判定とHuman Ballotが構造的に混ざらない | AI roleのhuman ballot write拒否、Strength=P×V、L3→Human集計のimportなし |
| G10 Review Gate | 不確かな勝敗をAIが断定しない | Value turn反転・重大UNVERIFIABLE・Voting候補競合fixtureでREVIEW_REQUIRED |

> **★G0 が最も重要なゲートである**
> Phase Aの終わりに置く。ここを通るまでPhase Bへ進まない。
> 工程のつなぎ目でこそ設計の齟齬が出る。全機能の20%を作ってからつなぐより、細くても最初から最後まで通っている状態を早く作る方が、齟齬を早く見つけられる。
> 通ったら、実試合1本で同じ流れを人が試す。合成データでは検証できないもの（audibility、実際の英語の聞き取りやすさ）はここで初めて分かる。

> **KPIの置き方** Winner一致率だけを最重要KPIにしない。人間ジャッジ同士でも判断は割れる。重視するのは、どのFlowを見て、どのIssueをVoting Issueとしたかを説明できることである。

## 19. コスト

### 19.1 呼び出し回数とトークン量を確定する

単価は変動する。設計書に単価を書き込むと、書いた瞬間から古くなる。v03は「何回・どれだけ呼ぶか」だけを確定し、単価は設定ファイルに置く。

| 項目 | 1試合（実ファイル約50分）あたりの量 | 備考 |
|---|---|---|
| Pass B 音声入力トークン | 50分 × 60秒 × 32トークン ＝ 約96,000トークン／1回 | Geminiは音声1秒を32トークンとして扱う |
| Pass B 呼び出し回数 | 12回（ステージ単位） | file URIを再利用。範囲をMM:SSで指定 |
| Pass B 入力トークン合計 | 約1,152,000トークン（96,000 × 12回） | 12回分の合計であって1回あたりの上限ではない。キャッシュが効かない最悪ケース |
| Pass B 出力トークン | 英語約6,000語＋タイムスタンプ ≒ 12,000トークン前後 | 逐語モードのため整文分の削減はない |
| Pass A | 音声約50分 × provider単価 | 分課金のproviderを想定 |
| 解析・判定支援LLM | 確定transcript（約6,000語）＋プロンプト、3〜6回 | 論点抽出、リンク付け、ルール検査、判定候補、解説 |
| ストレージ | 音声 約20〜30 MB／試合 | 動画を保管する場合は別枠 |

- 単価は config/pricing.json に外出しし、scripts/estimate-cost.ts が1試合あたりの見積りを出す。
- 実行時には実際のトークン量と所要時間をjobに記録し、見積りと実績を比較できるようにする。
- コンテキストキャッシュの有無で入力量が一桁変わる。ただしキャッシュはprovider固有の機能なので、P8の受け入れ基準に含めるのは capabilities.contextCache=true を宣言したproviderに限る（§6.6）。
見積りを50分で行う理由（v06） 公式フォーマットの42分は計時対象（スピーチ34分＋準備時間8分）の合計であって、録音の長さではない。チェアパーソンのアナウンスと入退場を含めた実ファイルは45〜50分になる。トークン量は実ファイル長で決まるため、見積りは50分を基準にする（§3.1）。

### 19.2 インフラの下限

| 用途 | 最小構成 | 上げる条件 |
|---|---|---|
| Supabase | Free（音声のみ・50MB以下・総容量1GB以内。目安30〜50試合） | 動画を保管する、総容量1GBに近づく、DB容量500MBに近づく、または一時停止（無活動1週間）を避けたい場合にPro |
| Vercel | Hobby（Fluid computeの300秒で足りる粒度に割ってある。Hobbyは300秒が上限で引き上げ不可） | 実行時間300秒で足りないジョブが出たらPro（最大800秒。1800秒はベータ） |
| 外部API | 従量課金 | — |

Vercel Hobbyは個人利用の範囲であり、Git organization所有のリポジトリを接続できない。学校や大会での運用に入る段階でPro以上へ移行する。Supabase Freeの総容量1GBは1試合20〜30MBで30〜50試合ぶんなので、保持レベルAの削除運用を最初から回すか、早めにProへ移る（§5.2・§16.3）。

## 20. リスクと設計上の防波堤

- **擬似精度**：LLMに0.673等を直接出させる。→ AIはカテゴリ、数値はscoring_configで決定。
- **Evidence二重評価**：Probability内の証拠評価にさらにS係数を掛ける。→ Support Qualityへ統合しStrength=P×Vに固定。
- **Voting Issue単純化**：max Strengthだけで決める。→ survival + clash counterfactualの二候補。
- **Value turn誤判定**：符号反転を通常のImpact低下として処理。→ review_gate。勝者が変わる場合はREVIEW_REQUIRED。
- **Summary後付け修復**：新Evidenceで欠けたLinkを完成させる。→ INADMISSIBLE_LATE_REPAIR。
- **AI参考判定の公式化**：内部数値が人間Ballotへ自動コピーされる。→ 別テーブル・別権限・別API。

| リスク | 問題 | 対策 |
|---|---|---|
| エージェントが音を確認できない | テストが通っただけで「動いた」と報告される | 受け入れ基準を二分し、音に関わるPRは人間検証を必須にする（第17章） |
| AI要約が議論を単純化 | 重要なQualifier・Evidence・例外条件が消える | ArgumentNodeにsegmentIdを必須化。要約だけで判定しない |
| ASR誤認識 | 聞き取れる英語を機械だけが落とす | audibilityを独立させ、原音レビューを通す |
| 聞き取れない発言の補完 | AI推測で「言ったこと」にしてしまう | Judge Viewでは補完禁止。unheardを明示 |
| New Argument誤判定 | 正当な比較を除外してしまう | AIは候補のみ。人のconfirmが必要 |
| 独自数値採点への逸脱 | HEnDA公式判定と別物になる | 公式Judge Sheetのカテゴリを正本とする |
| ステージが1つずれる | 質疑の文言が重複しており、取り違えるとフロー全体が壊れる | 直前ステージと経過時間の両方で判別。境界は人が確定（§8.2） |
| 長時間ジョブのタイムアウト | 42分を1回で処理して落ちる | 1ジョブ＝2〜4分。冪等な部分再実行 |
| 無料枠の50MB上限 | 動画やビットレートの高い音声が入らない | 入力規約（mono 64〜96 kbps）。動画はPro以上 |
| 実データがGitに入る | 個人情報の流出 | .gitignore＋CI検査＋fixture合成規約 |
| providerの仕様変更 | 転写が止まる | adapterに隔離し、契約テストで検出する |
| whosaid-editorとのスキーマ乖離 | インポートが壊れる | 対応スキーマをschema 5に固定。変換層をひとつに集約 |
| Data APIとservice roleの取り違え | supabase-jsでDBへ入る実装が混入し、Data API無効の前提が崩れる | DBアクセスをSupavisor経由に一本化。CIでsupabase-jsのDB利用を検出する（§4.2） |
| unknownのまま判定を確定 | AIの文字起こしを人が聞いたものとして判定に使ってしまう | ロック不変条件。根拠segmentにunknownが残る間はロックできない（§10.3） |
| APIを通さない書き込み経路 | confirmedやlockedを迂回して書ける穴ができる | 全エンドポイントをdefineHandlerで書く。素のRoute Handlerを禁止する（第14章） |
| 消したつもりで残る | transcriptや氏名がedit_logsや生成物に残る | 保持レベルA〜Eと、edit_logsの伏せ字化（§16.3） |
| 過程の記録が判定に逆流 | effectivenessやHPが実質的な採点になり、公式判定と別物になる | 判定の集計コードから参照させない。CIで静的に検査する（§0） |
| 効果評価の二重入力 | ログとDecision Chartが食い違い、どちらが正か決められなくなる | 人の入力は任意。判定の権威はIssue単位に置いたまま（§9.6） |
| 熟練者コメントを正解にする | Winner一致率の最適化に走り、当たるが説明できない方向へ進む | 参照例として扱う。見解の相違も保存する（§17.6） |
| 選手名前提のUI | 後から匿名化すると表示が虫食いになる | 役割優先UI。解析画面からdisplay_nameを参照しない（§9.9） |
| MVPが太る | 全工程が通らないまま機能だけ増える | Phase Aは縦切りだが、評価エンジン検証のためAD1/AD2/DA1/DA2の4 Issueを通す。★G0を通るまでPhase Bへ進まない（§17.2） |
| 既存2アプリの肥大化 | 責務が混ざり保守困難 | 新規リポジトリとして独立。共有はcore / schema単位 |
| 聞き取れなかったことをDROPSにする | 「応答しなかった」と「聞き取れなかった」が混ざり、ルールの趣旨に反した判定材料になる | unheardのある区間からDROPSを導出しない。audibility_gapとして人へ回す（§9.3） |
| unheardを根拠に引いた判定 | 聞き取れなかった発言を判定根拠にしたままロックできる | ロック不変条件に追加。409 UNHEARD_CITED（§10.3） |
| SELECT *で隔離をすり抜ける | 判定側とHP側が同じflow_linksを読むため、静的検査を回避できる | 判定側はビュー judge_flow_links しか読まない（§12.4） |
| 無料枠の総容量 | 1試合20〜30MBで、Supabase Freeの1GBは30〜50試合で埋まる | 保持レベルAの削除運用を最初から回す。早期にPro（§19.2） |
| ローカル前提が混入する | 手元にしかないファイルや絶対パスがリポジトリの前提になり、CIで再現できなくなる | CIを唯一の判定者にする。絶対パス検査をP0のCIに入れる（§17.6・§18.1） |
| 実データの所在が散る | 複数端末に音声や.envが散らばり、許諾管理と保持レベルAの削除が成立しなくなる | 実音声と.envを持つ端末を開発機だけに限る（§17.6） |
| 合成データにしかない世界を設計する | 欠損も分割判定も講評も起きない前提で作り込み、実運用で初めて破綻する | 実試合1本の突き合わせを設計入力として常設する。G8を品質ゲートに置く（付録H） |
| ステージ丸ごとの欠損 | 10分ぶんの本文が失われても、機械も人も気づかないまま判定できる | ステージ長の妥当性検査（§8.5）、coverage_status、409 GAPPED_STAGE_CITED（§10.3） |
| 欠損を「応答しなかった」と記録する | 実際には話しているのにDROPSが立ち、ルールの趣旨に反した判定材料になる | 欠損ステージからDROPSを導出しない。stage_coverage_gap（§9.3） |
| 単独ジャッジ前提 | 4対1の少数意見が消え、研修と研究で最も価値のあるデータが残らない | 判定をバロット単位にし、パネル結果はビューで導出する（§10.7） |
| 話者ラベルを信じる | 自動分離の誤ったラベルが起点になり、担当者表より弱い根拠で座席が決まる | providerの話者ラベルを取り込まない。align_wordsにspeaker列を作らない（§6.4） |
| 座席と氏名の対応源を失う | 自己紹介ラウンドを保持しないと、誰がA1かを後から決められない | match_events に self_introduction を持ち、名乗り区間を列で特定する（§3.5・§8.6） |
| 伝達評価が内容判定へ混ざる | 表現力への共感が、そのまま論点の強さの理由として記録される | 判定理由の段落に根拠種別を持たせ、candidate フラグで人へ返す（§10.6・§11.2） |
| リスクをゼロと書く | 「無視できる」で議論が止まり、後から理由をたどれなくなる | Strength=None に残存リスクの記述を必須にする（§10.1） |

## 21. 将来：観戦型ゲームへの接続

観戦型ゲームはv03の目的ではないが、構造化Flowが完成すれば自然に接続できる。ゲーム側は勝敗を演出の都合で作るのではなく、確定Flowイベントを読むだけにする。

| 解析イベント | 将来の演出 |
|---|---|
| confirmed ATTACKS ＋ effect_kind | どの構成要素を何で攻撃したかを実況表示 |
| confirmed DEFENDS | 再構築・盾の表示 |
| DROPS | 警告と解説 |
| EvidenceRef | 証拠カードの表示 |
| Summary COMPARES | 最終比較ボード |
| debate_evolution | HPバーの増減アニメーション（AI推定であることを明示） |
| JudgeDecision | Probability / Value / Strengthの視覚化 |
| Communication | 内容とは別メーターで伝達性を表示 |

## 22. v08の基礎資料と優先順位

1. 第20回全国高校生英語ディベート大会ルール / HEnDA Judge Sheet / Flow Sheet（競技上の正本）
2. 英語ディベート AIジャッジ クライテリア・定量評価設計 v04（評価エンジンの設計入力）
3. v07基本設計書と付録Hの実試合検証（音声・欠損・複数Ballotの設計入力）
4. 2023年度審査員研修会・埼玉ジャッジ基準（New Argument・比較・Probability/Value解釈の補助）

競技ルールと評価設計メモが衝突する場合は競技ルールを優先し、評価設計メモを改訂する。

## 付録A. HEnDA Flow Sheetの画面マッピング

紙のFlow Sheetに近い横のつながりを保つ。細いQ&A列も、Attackの対象を特定する重要情報として省略しない。

| 肯定側の行 | 内容 |
|---|---|
| ① AFF Constructive | AD1 / AD2（present / effect / importance） |
| ② NEG Q&A | 否定側質疑（細い列） |
| ⑤ NEG Attack | → AD への攻撃 |
| ⑥ AFF Q&A | 肯定側質疑（細い列） |
| ⑨ AFF Defense | AD再構築 |
| ⑪ AFF Summary | 比較と要約 |

| 否定側の行 | 内容 |
|---|---|
| ③ NEG Constructive | DA1 / DA2（present / effect / importance） |
| ④ AFF Q&A | 肯定側質疑（細い列） |
| ⑦ AFF Attack | → DA への攻撃 |
| ⑧ NEG Q&A | 否定側質疑（細い列） |
| ⑩ NEG Defense | DA再構築 |
| ⑫ NEG Summary | 比較と要約 |

各セル内に Claim / Evidence / Attack / Defense のカードを縦に並べ、対象関係を矢印で表示する。カードを選ぶと右ペインに原文・時刻・音声再生・AI根拠・確認状態が出る。

## 付録B. Judge Sheet入力マッピング

| Issue | Probability | Value | Strength | 根拠（アプリ拡張） |
|---|---|---|---|---|
| AD1 | Hi / Lo | Large / Small | Strong / Weak / None | EvidenceRef＋timecode |
| AD2 | Hi / Lo | Large / Small | Strong / Weak / None | EvidenceRef＋timecode |
| DA1 | Hi / Lo | Large / Small | Strong / Weak / None | EvidenceRef＋timecode |
| DA2 | Hi / Lo | Large / Small | Strong / Weak / None | EvidenceRef＋timecode |

公式シートには根拠時刻の欄はないが、アプリ上では必須とする。出力時は（A）公式レイアウトに近いシートと、（B）時刻・根拠を含む拡張版の2種類を生成する。公式版は印刷しても崩れないよう、用紙と余白と表幅を固定する。

## 付録C. 参照資料と優先順位

ルール解釈が競合した場合は、古い解説記事よりも第20回大会ルールと現行HEnDA様式を優先する。

| 優先 | 資料 | 本書で使う内容 |
|---|---|---|
| 最優先 | 第20回 全国高校生英語ディベート大会 大会ルール | スピーチ順、AD/DA、Attack / Defense / Summary、担当者表、語数と速度、10秒ルール、証拠の要件、判定、新規議論、Communication |
| 最優先 | HEnDA Judge Sheet | Decision Making Chart、Voting Issue、Winner、Communication Points、Best Debater |
| 最優先 | HEnDA Flow Sheet | 画面配置とステージ対応 |
| 補助 | D1 チェアパーソンスクリプト | 定型句辞書、進行、名乗りと計測開始、10秒の運用 |
| 補助 | ジャッジ基準（埼玉いなほカップ掲載） | fairness / objectivity / accountability、判定理由とアドバイスの分離、5ステップの判定手順 |
| 補助 | フローシートを上手に書くコツ | Claimと根拠の分離、矢印、色分け、記号化などUXの参考 |
| 検証用 | 実試合1本の書き起こし・フローシート・判定理由・審査委員長講評（v07で追加） | 設計の穴を見つけるための入力。ルール解釈の根拠にはしない。リポジトリへは置かず、docs/FIELD_VALIDATION.md に所見だけを残す（付録H） |

> **検証用資料をルールの根拠にしない** 実試合で観測されたことは事実であって、規範ではない。審査委員長が表現力を勝因として語ったことは、表現力を勝因にしてよいという根拠にならない。大会ルールとJudge Sheetの優先順位は動かさず、実試合は「設計が現実に耐えるか」を見るためだけに使う。

## 付録D. 参照リポジトリ

### whosaid-editor

https://github.com/sukeko1113/whosaid-editor（公開・MIT License）

日本語会議音声の逐語反訳＋話者割当エディタ。Python 3.12＋Tkinter、Windowsデスクトップ。転写はGemini API。製品価値は転写速度ではなく「誰が言ったかの検証済み記録」。

| 継承するもの | 本書での位置づけ |
|---|---|
| ✓と△の意味論（人が聴いて確定／一括適用で埋めただけ） | 第7章のレビュー状態モデルの土台。軸を4本に拡張して継承 |
| 提案と本体データの分離（自動点検パイプライン） | AI提案はsuggested層に入り、自動適用しない（§10.2） |
| anchor.py の区間ごと時間窓による文字アンカー照合 | TypeScriptへ移植。純粋関数のためCIで完全検証できる（§6.5） |
| 本文と時刻の役割分離（Gemini＋faster-whisper） | Pass A（時刻）とPass B（本文）の役割分離として継承（§6.2） |
| 作業JSON schema 5 | インポート経路として正式サポート（§6.7） |
| 短い相づちを自動削除しない方針 | ディベートでは沈黙と未応答が判定材料になるため、さらに厳格に適用 |
| スキーマ変更は一括で行う | 第13.4節の規約として継承 |

- 継承しないもの：Tkinter GUI、PyInstaller / Inno Setupのビルド系、ffmpeg / ffplayへの依存、BLAKE2b音声指紋、ローカルASR（sherpa-onnx等）の導入計画。
- 移植時はMIT Licenseの表記を残す。なお現行のLICENSEファイルは著作権者名が仮置き（[Your Name]）のままである。移植の前に実名へ更新しておくのが望ましい。

### ai-english-debate

https://github.com/sukeko1113/ai-english-debate（非公開）

継承するのは、Next.js / TypeScript / PostgreSQL構成、サーバ権威の原則、答案と採点Runの分離、evidence付き採点、再採点と上書き履歴の分離、DBアクセスの分離である。

### ai-debate-match

HEnDA 12セクションの状態機械を実装したPhase 1の資産。ステージ順序・時間・役割の扱いに共通点があるため、ruleset定義の書き方とテストの当て方を参考にする。ただしコードは共有せず、本アプリは独立したリポジトリとする。

## 付録E. HEnDA名称・ルール利用に関する確認事項

本アプリは大会ルールと公式様式を正本として動作する。名称と様式の扱いについては、実装が一定程度進んだ段階でHEnDAへ確認する。確認が取れるまでは、次の方針で進める。

| 項目 | 確認前の方針（Plan B） | 確認後にできること |
|---|---|---|
| リポジトリ・製品名 | ai-debate-analyzer。名称にHEnDAを使わない | 正式名称・ロゴの利用可否を確認のうえ変更 |
| ruleset id | henda-20（内部識別子として使用） | 版の更新方法と告知経路を確認 |
| Judge Sheet / Flow Sheetの様式 | レイアウトを踏襲した独自版を生成する。公式様式の画像・PDFを同梱しない | 公式様式の再現・配布の可否を確認 |
| 大会での利用 | 個人・校内での練習と研修に限定 | 大会運営での利用、ジャッジ研修での利用を相談 |
| ルール本文 | 本文をアプリに埋め込まず、条項番号と要約で参照する | 引用範囲を確認 |

## 付録F. Claude Codeへ渡す文書構成

実装セッションが本書を読まずに進むことがないよう、リポジトリ内の文書構成を固定する。

```
ai-debate-analyzer/
├─ CLAUDE.md                  # 絶対に守る設計原則。短く、破ってはいけないことだけ
├─ docs/
│  ├─ BASIC_DESIGN_v06.md     # 本書
│  ├─ HENDA_RULESET.md        # 条項番号と機械可読化の対応
│  ├─ DATA_MODEL.md           # テーブルと制約
│  ├─ TRANSCRIPTION.md        # 4パス構成（A / S / B / C）とprovider契約
│  ├─ API_SPEC.md             # HTTP API契約。セキュリティ境界そのもの
│  ├─ PRIVACY_RETENTION.md    # 保持レベルA〜Eと段階的削除
│  ├─ DEV_ENVIRONMENTS.md     # CLI／デスクトップアプリ／Web版の使い分け
│  ├─ ARGUMENT_MODEL.md       # A/B/C・Support Quality・clash event・比較軸・HP・役割優先UI
│  ├─ CONSENT_MODEL.md        # consent_scopeと保持レベルの対応
│  ├─ REVIEW_SEMANTICS.md     # 4軸の状態と、壊してはならない規則
│  ├─ JUDGE_LOGIC.md          # Decision Chartとサーバ権威
│  ├─ ACCEPTANCE.md           # 機械検証／人間検証の二分と品質ゲート
│  └─ TASKS.md                # Phase A（P0〜P13）／B（P14〜P20）／C（P21）
├─ .claude/settings.json      # SessionStartフック（リポジトリに置く。~/.claude は届かない）
├─ .env.example               # 環境変数の一覧と置き場所
├─ packages/core/             # ruleset / schema / anchor / rules / db（UIに依存しない）
├─ app/                       # Next.js App Router
├─ schemas/                   # 生成物。手書きしない
├─ fixtures/gold-01/          # 合成試合。音声・原稿・正解一式
├─ drizzle/                   # マイグレーションSQL（生成物だがコミットする）
└─ scripts/                   # setup-cloud-env / install_pkgs / generate-schemas
                              # estimate-cost / check-no-real-data
```

### CLAUDE.mdに書く絶対原則（案）

- 自動処理が human_verified / human_confirmed / human_edited を立てることは決してない。
- AIの出力は必ず suggested に入る。confirmed / excluded を書けるのはサーバのAPIだけ。
- 短い相づち・フィラー・沈黙を自動削除しない。
- ArgumentNodeはsegmentIdを1つ以上持たなければならない。根拠に戻れない議論は保存しない。
- 再解析は *_ai 列だけを更新する。*_human 列に触らない。
- audibility = unknown を含む判定はロックできない。unknownは「まだ人が聞いていない」の意味である。unheardと確定したsegmentは判定根拠にできない。
- audibilityを書けるのは人だけ。ASRのconfidenceを代用にしない。
- DBアクセスはSupavisor経由のPostgres接続だけ。supabase-jsをDBに使わない。service role keyはStorageとAuth専用。
- 素のRoute Handlerを直接書かない。defineHandlerを通す。
- 開発中のどのサーフェスからも、本番の認証情報で実Supabaseへ接続しない。DBの検証はローカルのSupabase CLI（Docker）で行う。ただしprepare: false の実挙動はSupavisor固有なので、CIのスモークテストで別に確かめる。
- セッションはサーフェス間で共有されない。受け渡しは必ずリポジトリ内のファイルで行い、「途中で乗り換える」ことを前提にしない。
・同じ作業ツリーで2つのセッションを同時に走らせない。並列にするなら git worktree を切る。

・絶対パスやOS固有パスをリポジトリに書かない。手元でしか動かないものを前提にしない。

・実試合の音声と .env を開発機（1号機）の外へ出さない。

- flow_links.effectiveness・比較軸・HPバー・熟練者コメントは**Human Ballotの自動計算には入らない**。AI Decision Supportの内部計算はclash_events・argument_node_scores・scoring_configだけを読み、Human Ballot集計はjudge_decisionsだけを読む。
- 解析・観戦画面からdisplay_nameを参照しない。役割と座席ラベルを主表示にする。
- 実音声・実名・実試合データをリポジトリに置かない。
- スキーマの破壊的変更は一括で行う。散発的に足さない。
- 受け入れ基準を満たしたことを確認するまで次のPRへ進まない。
- 設計書と食い違う実装をしたくなったら、勝手に変えず相談する。
- 「記録が無い」「聞き取れなかった」「応答しなかった」を混ぜない。coverage_status、audibility、DROPS はそれぞれ別の事象である。判定材料になるのはDROPSだけ。
- 欠損ステージ（coverage_status ≠ complete）の区間と、stage_no を持たない区間（自己紹介・アナウンス）は、判定根拠に引けない。
- providerが返した話者ラベルを保存しない。座席は担当者表と自己紹介の名乗りから決める。
- 判定は1ジャッジ1票。パネル結果はビューで導出し、行として保存しない。少数意見を消さない。
- Strength=None には残存リスクの記述を必ず書かせる。「無視できる」で終わらせない。
- 判定理由の段落は根拠種別（content / comparison / procedure / delivery / advice）を持つ。delivery を内容判定の理由にしたらフラグが立つ。自動で消さない。

## 付録G. Gold Dataset v01の作り方

CIで回帰を取るには、公開できる正解データが要る。実試合は権利と個人情報の理由でリポジトリに置けないため、架空の試合を作る。

| 手順 | 内容 | 成果物 |
|---|---|---|
| 1. 論題を作る | 実在の政策論題を避け、架空だが構造が明確な論題を1つ作る | motion.md |
| 2. 原稿を書く | 12スピーチ分の英語原稿。AD2つ、DA2つ、Attack、Defense、Summary。立論は600語未満に収める | speeches/01〜12.md |
| 3. 違反を仕込む | New Argument 1件、語数超過 1件、担当者違反 1件、証拠要素の欠落 2件を意図的に含める | violations.json |
| 4. 音声化 | TTSで各スピーチを読み上げ、チェアパーソンのアナウンスと準備時間を挟んで1本に組み立てる（計時42分／実ファイル45〜50分） | gold-01.mp3（mono 64 kbps） |
| 5. 正解を作る | 正解transcript（原稿そのもの）、正解ステージ境界、正解Flow、正解RuleFlag、正解Judge Sheet、正解判定理由 | gold/*.json |
| 6. 固定する | 音声のsha256を記録し、CIで同一性を確認する | gold-01.sha256 |

> **合成データの限界を承知しておく**
> TTS音声は明瞭すぎるため、audibilityの検証には使えない。実際の高校生の英語・訛り・声量・雑音は再現できない。
> したがってGold Datasetで検証できるのは、ステージ区分、時刻照合、論点構造、ルール検査、集計、出力までである。
> 聞き取りやすさに関わる機能（audibility、Communication、実運用でのASR精度）は、許諾を得た実試合で人が確認する。その結果はリポジトリではなく、別管理の検証記録に残す。

### 付録G-2. Gold Dataset v02で足すもの（v07で追加）

v01は「正しく作られた試合」を検証するデータだった。実試合が示したのは、正しく作られていない入力のほうが多いということである。v02では、v01の6手順に加えて次を仕込む。手順そのものは変えない。仕込む内容だけを足す。

| 追加する要素 | 仕込み方 | 検証する対象 |
|---|---|---|
| 開会・自己紹介ラウンド | 8名が順に名乗り、担当を宣言する2〜5分の区間を先頭に置く | stage_no が NULL の区間の保持、座席結び付け（§8.6）、判定根拠にできないこと |
| ステージ丸ごとの欠損 | ⑩と⑪に相当する範囲を無音または雑音に差し替える。正解データには missing と記録する | coverage_status、stage_duration_anomaly、DROPS抑止、409 GAPPED_STAGE_CITED |
| 境界の脱落 | ⑨〜⑪のチェアパーソンのアナウンスを1箇所削り、Pass Sが境界を落とす状況を作る | ステージ長の妥当性検査（§8.5）、人が引き直せること |
| 代替手段による攻撃 | 「既存の制度で足りる」型の攻撃と、それへの「適用範囲が狭い」という再反論を1組入れる | effect_kind の alternative_solves / alt_limited |
| 対象へ届かない攻撃 | 「対象者の大半が要件を満たさない」型の攻撃を1件入れる | effect_kind の not_solvent |
| 質疑での譲歩 | 質疑で相手が前提を認める応答を1件、答えをずらす応答を1件入れる | ANSWERS の admits / declines_to_answer |
| 3人のパネル | 同じ試合に対する3件のバロットを正解として作る。うち1件は結論が異なり、Voting Issue も違う | パネル結果の導出、少数意見の保存、BALLOT_DUPLICATE |
| 伝達評価の混入 | 「声が通っていて説得力があったのでAD2は強く残った」という段落を判定理由の正解に1件入れる | communication_in_content が candidate で立ち、自動除外されないこと |
| Strength=None | DA2を None とし、残存リスクの記述を正解に含める | residualNote 必須の検証 |

> **v01を捨てない** v02はv01の置き換えではなく追加である。v01は「きれいな試合が正しく処理されること」を検証し続ける。欠損入りのデータだけになると、正常系の回帰が薄くなる。CIは両方を回す。

## 付録H. 実試合検証記録（v07で新設）

合成データで検証できないことは、実試合で確かめる。その結果はリポジトリではなく別管理の検証記録に残す、というのがv06までの方針だった（付録G）。v07ではその記録の形を決め、最初の1件を本書に載せる。実試合の突き合わせは、G0の後の確認作業ではなく、設計を書くための入力だからである。

### H.1 記録の形

| 項目 | 内容 |
|---|---|
| 対象 | 大会名・ラウンド・論題・年度。氏名と音声はリポジトリへ入れない |
| 突き合わせた資料 | 書き起こし、フローシート、判定理由、講評など。どれを見たか |
| 設計どおりだったもの | 変更しない。実証されたこととして記録する |
| 設計に場所が無かったもの | 版番号を上げて取り込む。取り込まない判断をした場合はその理由 |
| 合成データで再現できないもの | 再現できないという事実そのものを記録する |

### H.2 第1件：HEnDA決勝（安楽死の合法化）

対象は、第13回全国高校生英語ディベート大会 決勝である。肯定側 竹園高校、否定側 藤島高校、論題は「日本は積極的安楽死を合法化すべきである」。突き合わせた資料は、話者特定済みの書き起こし、論点フローシートと対立構造図、判定理由、審査委員長講評の四つである。

**設計どおりだったもの**

- 担当者表（§8.3）から、8名の座席が①〜⑫のすべてで矛盾なく決まった。①の立論者が②で応答し、④の質問者が⑪で総括し、⑥の質問者が⑨のディフェンスを担当する、という対応がすべて一致した。
- 話者分離が不要という判断（§6.4）は正しかった。実際には「不要」より強く、「使うと有害」だった。
- v07時点の4構成要素は実試合を十分に分解できた。v08では同じ内容をA=Observation、B=Link、C=Impactへ再配置し、evidenceはSupport QualityとしてA/B/Cの立証理由へ結び付ける。情報は失わず、Judge SheetのProbabilityとの二重評価だけを解消する。
- Impact比較の4軸（§9.8）は、判定理由の比較秤量に対応した。probability（審査を経た誤死の発生確率）と magnitude（救済される患者の規模）が実際に使われている。
- 「判定に入らない情報を分ける」という一線（§0）は、講評と客観的判定理由の食い違いを説明するのに役立った。両者は結論では一致し、根拠の種類で分かれていた。

**設計に場所が無かったもの**

§0.0の表のとおりである。開会・自己紹介ラウンド、ステージ2つ分の欠損、5人審判の4対1、伝達評価の混入、Strength=None の切り捨て、そして effect_kind に無かった攻撃の型。いずれもv07で取り込んだ。

**合成データで再現できないもの**

- 実際の高校生の英語の聞き取りやすさ。訛り、速度、緊張による声量の変化。audibility の検証はここでしか行えない。
- 感情的な訴求が判定へ与える影響。審査委員長が「泣きそうになった」と述べた自己紹介と、AD2の描写である。これは原稿を書いて音声化しても発生しない。
- 5人のジャッジが同じ試合を見て割れること。合成データでは「割れた」という結果を書けるだけで、割れる過程は作れない。

> **この記録から出た一般則** 実試合1本で見つかった設計の穴は九つあり、そのうち五つは「記録できない」ではなく「間違って記録してしまう」種類だった。欠損をDROPSにする、伝達評価を内容判定にする、少数意見を消す、といった穴である。空白は目立つので気づかれるが、誤って埋まった欄は気づかれない。次の実試合検証も、まず「埋まっている欄が正しいか」から見る。

> **次の一手**
> 1. 本書の内容で合意する。v06で第12章・第13章に入った列と型（roleのevidence、flow_linksの4列、summary_links、ComparisonAxis、許諾4列、lock_version）に加え、v07で足した列（panel_size、intro_segment_id、coverage_status、event_id、reason_grounds、residual_note）も、すべてP1のスキーマに含める。後から足すと破壊的変更になる。
>    v08ではさらに、argument_node_scores / clash_events / rule_state_table / issue_snapshots / scoring_config / official_decision_support / hp_ledger / delivery_scores、およびimpact_direction・INADMISSIBLE_LATE_REPAIR・Voting Issue counterfactualをP1/P2のスキーマへ先に固定する。
> 2. 本書をBASIC_DESIGN_v08.mdとしてリポジトリに置き、docs/ARGUMENT_MODEL.md / docs/SCORING_MODEL.md / docs/CONSENT_MODEL.md / docs/FIELD_VALIDATION.md を正本として分離する。
> 3. Gold Dataset v01（付録G）を作り、続けてv02の追加要素（付録G-2）を仕込む。これがP1以降すべての受け入れテストの土台になる。
> 4. P0（雛形・CI・DB接続・マイグレーション）から着手し、P1（rulesetとZodスキーマ）へ進む。★G0（縦切り貫通）を最初の目標にし、その後にG8（実試合突き合わせ）を置く。
