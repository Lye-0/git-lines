# mainの第1親追跡を打ち切らない比較版の影響調査

調査日: 2026-09-14。基準commit: `a07aa3c7dd8db2f4382f2bf0d6e98297485cc5ff`。
これは未採用の比較実験であり、現在の製品仕様を変更する文書ではない。

## 対象と結論

`laneLayout.ts`の呼び出しだけを、`firstParentChain(primaryTip, commits, nonPrimaryTipOids)`から`firstParentChain(primaryTip, commits)`へ変更した比較版を検証した。テスト時の変換と一時bundleを使用し、製品ソースや確認対象のGit repositoryは変更していない。

この変更は、mainの第1親上に残った別branchのtipによってmainの経路が途切れる現象を解消する。ただし、当時のbranch名やmerge方向を復元する機能にはならない。また、mainの途中にあるfeature履歴を独立laneに残す既存テストの期待と衝突する。無条件に互換性を維持する変更としては採用できない。

ユーザーの希望は「他branchをmainへ取り込む場合はmainを左端に維持し、mainを他branchへ取り込んだ場合には左端の維持を必須にしない」。現在のmainから全祖先をmain扱いすることでも、過去のbranch名を推測することでもない。比較版が追うのは第1親だけである。

## 検証結果

| 検証 | 結果 |
| --- | --- |
| 比較版で既存全テスト | 413件中412成功、1失敗 |
| 基準版でlayout単体テスト | 39件すべて成功 |
| 実repository 92件（test本体とfixture 91件） | Reflog OFF/ON × 行高28/30/38pxの552 layoutを比較。変更があったのはtest本体のみ |
| test本体 | 16 nodeのlaneまたはtrackが変更、19 edge pathが変更。親子関係、row、operation relations、annotation row、path数は同一 |
| test本体のDAG実曲線 | 各L/C segmentを120分割して、非端点nodeの選択ring半径+1pxへの接触を確認。変更前後とも検出0件（48 parent path × 6設定） |
| test本体のpagination | 10→20→30→40→50件。両版とも既存commitのrow/lane移動なし。各段階でparent edgeデータ同一 |
| mainへのmerge、mainからfeatureへのmerge | 親順を明示したモデルで確認。前者はmainの第1親を左端、後者はfeatureのmerge commitを側laneに保持 |
| mainへmergeした履歴に古いroot参照が残る場合 | 比較版のみmainの第1親rootを左端に維持 |
| mainをfeatureへmerge後、mainをそのtipへfast-forwardしたモデル | 両版とも現在のmainから第1親を優先。第2親側の旧main部分は側laneになる |

実repositoryのsnapshotは最大200 commitで取得した。取得は一度行い、同じsnapshotからReflog ON/OFFの事実モデルを作った。確認対象へのcheckout、commit、ref更新は行っていない。

## 既存テストとの衝突

失敗したのは`tests/unit/layout.test.ts`の`keeps feature history on its own lane while anchoring ref events to the destination`。

このモデルは線形の`a ← b ← c`に対し、mainがc、origin/featureがbを指し、featureのref移動eventを持つ。基準版ではbがlane 1、比較版ではlane 0になる。eventのtrack/lane/targetLaneIdとmainのtipの期待は通り、feature commitをlane 1に置く期待だけが失敗する。

このテストにはmerge commitがない。失敗はparent破壊ではなく、途中の別branch参照を独立表示する既存方針との衝突である。今回の希望から、この既存期待を廃止してよいと自動的には判断しない。

## 条件を強制した追加検証

停止条件に到達しないfixtureだけで安全と判断しないため、mainに読み込み済み第1親がある68 snapshotへ、mainの直前の第1親を指す架空のremote参照をメモリ上だけで追加した。両版へ同じ追加済みsnapshotを渡し、408 layoutを比較した。

- parent edge・operation relation・annotation row・node row・各path数の差は0件。
- DAGの実曲線を同じサンプリング方法で比較し、新たな非端点node/ring接触は検出0件。
- 19 fixtureでOperation系のpathが変化した。例: 112 OctopusのAmend、118/119/133 Rebase、120/126 Cherry-pick、122/123 Squash/Fixup、65 Ref moves、72 Rebase進行中。
- Operationの検出内容は変わらなくても、lane移動に合わせてconnectorやlabel座標は変わる。この検証はOperation label同士の重なりやGUIの使いやすさを保証しない。

## 表示への波及と限界

trackが変わるnodeは色も変わり得る。`routeNameForNode`はtrackから表示名を決めるため、一覧とDetailのBranch / Route表示も変わり得る。sidebarのメッセージ開始位置もlaneと通過edgeから計算される。従って、修正をグラフのX座標だけの変更とは扱えない。

GUI目視、popover・選択・スクロールの実操作、新旧版の性能測定は未実施。曲線のサンプリングは数学的な全点保証ではない。既存のcurve包絡回帰テストは比較版でも成功したが、任意の未検証DAGに対する保証ではない。

採用する場合は、途中の別branch参照をどう表示するかを明確にし、上記の既存期待と整合させたうえで、操作表示の移動を含むGUI確認を行う。単にテストの期待値を変更して安全と判断しない。

## 再検証手順

1. 基準版の`tests/unit/layout.test.ts`を実行する。
2. 一時的なVitest pre-transformまたは隔離コピーで、上記呼び出しの第3引数だけを省略し、全テストを実行する。
3. 同じ`GitClient.readSnapshot`結果に対し、基準版と比較版の`buildGraphFacts`・`createGraphLayout`を実行し、親・relation・row・lane・track・pathを比較する。
4. 古い参照のない入力だけでなく、mainの第1親上に別branch参照を残した入力、merge方向を逆転した入力、paginationも確認する。
