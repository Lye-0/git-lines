# FF取り込みにおけるブランチ継続・合流の調査（2026-09-15）

追記：この文書は最初のFF継続表示の検証記録です。Reflog OFFで経路を消す当時の仕様は、[OFFでも継続・合流を維持する検証](reflog-off-branch-flow-verification.md)で変更しました。以下の過去の測定値・画像は当時の記録として保持します。

対象コードの基点はb6341f1。実Git fixtureを再生成せず、refs、parent、HEAD/branch reflog、生成スクリプトと実装を比較した。

| シナリオ | 生成時の実操作 | 現在残る証拠 | 問題・原因 | 判断 | 確認 |
| --- | --- | --- | --- | --- | --- |
| 21 | featureの3commitをmainへmerge --ff-only | main/HEADのmerge feature: Fast-forward、72973c0→4f55fca、featureの作成記録 | FF表示と独立列はあるが継続・合流経路がない | 修正 | 両モードGUI・DAG比較 |
| 22 | 同上、1commit | 96e7fd6→82197e3、同じ種類のreflog | 同上 | 修正 | 両モードGUI・DAG比較 |
| 23 | 同上、4commit | 6bf5be3→5a0cfd1、同じ種類のreflog | 同上 | 修正 | 両モードGUI・DAG比較 |
| 141 | featureの2commitをmainへFF | f69fcc2→cb57805、main/HEAD/feature reflog | 同上 | 修正 | 両モードGUI・DAG比較 |
| 142 | 2commitのFF後、featureを削除 | e521358→3c9ff32、mainのFF記録とHEADのcheckout/commit列。featureの現ref/logはない | 削除前の由来は判定済みだが継続・合流経路がない | 修正 | 現featureラベルなし・両モードGUI |
| 143 | FF・feature削除後にmainで追加commit | 5986735→a4bc4f9のFFと後続6665126、HEADのfeature作成履歴 | 後続mainから旧tipへの線はあるが、取り込み前mainからの継続がない | 修正 | 合流前後の継続を両モードGUIで確認 |
| 113 | commit-treeで交差DAGを作り、update-refでmainをA2へ移動してcheckout main | mainログd50fb6b→3337ae3はsubject空。feature-aもA2。FF/rename記録なし | 実生成は参照の直接移動。productionは無名の移動以上の操作意図を確定できない | 現状維持 | 両モード・ON/OFFの配置不変 |
| 43 | mainのtipにreleaseを作成。releaseは非checkout・commitなし。local/remote/tag共有 | release: branch: Created from main、共有tipの実ref、main上の作成記録 | 現仕様では独自commit/Working Tree/eventがないbranchはバッジのみ | 調査のみ・仕様拡張は保留 | 配置不変 |
| 92 | mainのtipに12branchと12tagを作成。branchは非checkout・commitなし | 各branchのCreated from mainと同一tip参照 | 43と同じ仕様境界。tagやlocal/remoteの別レーン化は不要 | 調査のみ・仕様拡張は保留 | 配置不変 |

## 情報の流れと修正

GitClientはHEADと現local/remote refsのreflogを読み、連続するselectorからpreviousOidを求める。10000件で採取した今回のsnapshotはhasMore=false。reflog show自体に件数上限はなく、20000件等の数値はキャッシュの保持制限。今回の6件のold/newは生の.git/logsの記録とも整合する。142/143では削除されたbranchのログを復活させず、HEADの連続したcheckout/commit記録から既存のbranchCommitOriginsがfeature由来を判定する。

HistoryEventにはfrom/to、取り込み先ref、merge操作、rawReflogMessage、sourceLabel、commitCountが届いていた。従来のfastForwardLayoutは由来のあるcommitを独立列へ残す。edgeRouterはFFマークをcheckoutまたは後続parentの曲線上へ移動する。しかし、取り込み前mainからFF地点へ続く独立した経路モデルはなかった。したがって主因は入力消失ではなく、表示モデル・配線の不足。

追加したBranchIntegrationは、明示的なlocal branchのmerge FF記録、同じtargetのold→newログ、完全にロードされた線形範囲、各commitの一意なsource作成証拠がすべて一致したときだけ生成する。source名はreflogの操作記録から取得し、SCENARIO.mdやcommit subjectを根拠にしない。pull同期、名前のない移動、同一tip/祖先関係だけでは生成しない。

FFの既存diamondを取り込み先の列に置き、diamond→取り込み前commitの継続経路とdiamond→source tipの合流経路を描く。後続main commitまたはWorking Treeの既存接続は、そのdiamondを通って元のtipへ到達する形に配線する。実edges/parent配列/Detail/refバッジは保持する。新しい線はbranchIntegrationPathsであり、実parent edgeへ追加しない。Working Tree接続の合流部分と重なる箇所は、同じ軌跡のsolid intake線を重ねて一つの合流として表示する。

列を作り直す処理ではない。Standardの取り込み先が最左でないテストでもその列を保つ。Default Fixedは既存resolverと配置を使う。対象6件の固定対象はrefs/heads/main、147はrefs/heads/trunk、148はrefs/remotes/origin/main。現在採取したrefsと撮影用casesの完全名を照合した。

## 境界と現状維持

- Reflog OFFでは表示イベントがなくなり、BranchIntegrationも生成しない。既存のbranch独立性保護とCurrent DAGは維持する。
- 作成証拠の欠落/競合、取り込み前/途中/先端commitが未ロードの場合、新しい合流を推測しない。
- 非線形の取り込み範囲、複数の由来が混在する範囲、取り込み前commitが別の表示経路に属する場合は今回の限定処理の適用外。既存表示を変えず、一般化は別途仕様判断が必要。
- 113ではA1/M1/A2のfeature-a経路を保ち、mainラベルは事実通りA2に残す。単なる参照移動をFFや主体交代と呼ばない。
- 43/92の非checkout branchにはWorking Treeも独自commit/eventもない。11/12/140はcheckout先branchのWorking Treeが存在するため独立列を割り当てる。非checkoutの未使用branchを線で表すには新しい表示対象と適用条件の定義が必要であり、今回変更しない。
- 「何日前」は期限切れの証拠ではない。現parserのtimestampは%ct（commit日時）であり、生reflogの操作日時と一致しない場合もある。今回、日時表示の改修は行わず、実在する記録とOID/selectorを確認した。

## 比較・検証

全100snapshot×両モード×Reflog ON/OFFの400条件を比較。nodes（FF visualXを除く）、tracks、実edgesは全件一致。FF visualX・配線・branch flowの差は対象6件×ON×2モードの12条件だけ。指定された回帰対象20/144/147、145、24、11/12/140、114/116、112と既存Operationは配置不変。43/92、対象外44/118/126も不変。

新規integration testは10件。独立した一時Git repoで1/3commit、削除あり/なし、後続commitあり/なし、両モード、ON/OFF、3種類のgeometry、欠落/競合作成証拠、pull除外、無名ref移動、非default取り込み先を検査。既存FF配置テスト1ファイルは以前の斜め中点指定を、取り込み先列上のjunctionと2経路の検査へ更新した。

pnpm check: 53ファイル、469テスト成功。lint/buildを含む。

修正前後は同じCompact/Reflog On/zoom 2/2194×1186条件で、6件×両モード×前後の24画像を保存。修正後12画像を目視確認し、独立したfeature列、取り込み前mainからFFまでの継続、FFへの合流、後続main/Working Treeとの接続を確認した。142/143で現featureバッジは復活していない。

比較・証拠・実行ログはartifacts/ff-continuity配下。開発コミット、fixtureの再生成・checkout・reset・reflog expireは行っていない。

既存verify.ps1の判定: PASS 91/91、FAIL 0。追加140〜148はこの既存manifestに含まれないため、今回の400条件比較と対象6件の実データ/GUI確認で別に扱った。検証呼び出しの外側で参照したLASTEXITCODEは、verify内部の期待されたGit否定照会の終了値を残すため1だったが、verifyの集計に失敗はない。

両リポジトリのgit diff --checkは成功。fixtureのHEAD/index/config/refs/logsなどとtestリポジトリの既存未追跡5ファイル、計1051ファイルの内容ハッシュはverify前後で一致。開始時git-linesはclean（b6341f1）、testの既存未追跡5ファイルを保持。修正中の開発コミットは作成していない。

変更ファイル: src/model/branchIntegration.ts、graphModel.ts、graphBuilder.ts、src/layout/branchIntegrationLayout.ts、layoutTypes.ts、graphLayout.ts、webview/src/components/GraphSvg.tsx、tests/integration/branch-integration.test.ts、fast-forward-placement.test.ts、docs/technical/graph-architecture.md、本報告、およびagent-knowledgeのFF継続判断メモと生成INDEX。
