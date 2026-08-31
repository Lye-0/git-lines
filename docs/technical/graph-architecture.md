# Git Lines グラフアーキテクチャ

## 目的と境界

Git Linesは、VS Code Extension HostでGit CLIを読み取り、Gitの事実モデルと表示用のレイアウトモデルを分離してWebviewへ渡す。初回版はDesktop / Remote Workspace向けの読み取り専用拡張であり、Gitの状態を変更するコマンドは実行しない。

## 現在の構成

- `src/git/` — 引数配列でGit CLIを実行し、log・refs・status・reflog・worktree・pseudo refsを機械可読形式からパースする。
- `src/repository/` — repository root / git dir / common git dirを検出し、Git metadataをbest-effortで監視する。
- `src/model/` — `GraphFactModel`を構成する。ここではcommitのparent、ref、reflog、operationなどGitの事実を保持し、laneやpixel座標を事実として扱わない。commit DAGと、Working Tree / operation / Ref Eventの補助ノードを型とedge種別で分離する。
- `src/layout/` — row、lane、edge routingを決定する。決定論的topological date-order、primary branchのlane 0、append時の既存座標維持を担当する。
- `src/webview/` — CSP nonce付きHTML、message protocol、VS Code panelのライフサイクルを担当する。
- `webview/src/` — React UI。SVGをedge/node layer、HTMLをsubject/badge/detail layerとして使い、dark/high-contrast tokenとkeyboard focusを維持する。

## データと状態モデル

`GitCommit`の`oid`と`parentOids`が唯一のcommit identityである。複数refが同じoidを指す場合もcommit nodeは1つにまとめ、ref badgeを複数付ける。annotated tagはref取得時にpeeled commitへ解決し、lightweight tagと同じcommitへbadgeを付ける。tagとsymbolic remote HEADはlaneを作らない。

`GraphNode`の種類は次のとおり。commit nodeには表示用に正規化したref badgeと、local/remoteからの到達性に基づく`syncState`（`shared` / `local-only` / `remote-only`）を持たせるが、full refは事実モデルに保持する。symbolic ref、`ORIG_HEAD`などのpseudo refは通常のbranch badgeやlaneに含めない。

- `commit` — current refsから読み込んだ実在commit
- `reflog-commit` — 現在のuser-facing refから到達できず、reflogから確認でき、objectが残っているcommit。Reset/Amendの旧経路だけ`previousRoute`を持ち、行表示では`PREVIOUS`になる
- `working-tree` / `operation` — commit objectではない現在状態
- `fast-forward-event` / `history-event` — reflogから確認できるref移動の時系列行。commitとは別モデルだが、`anchorCommitId`でdestinationを参照する
- `history-boundary` — paginationまたはshallow cloneで未読parentを示すstub

`GraphTrack`はbranch family内のRouteごとの色・ref一覧に加え、表示中のY区間ごとの`segments`（`startRow`、`endRow`、`lane`）を持つ。RouteはDAG上の連続経路、laneはその経路の一時的なX座標であり、`lane`は互換性のための代表値である。refの追加や移動だけではlaneを増やさず、同じfamilyでもtipが実際に分岐したRouteだけを別laneへ置く。familyはlocal refとremote-tracking refのcanonicalなbranch名から解決し、同じfamilyの別Routeは同じbase hueの明度・彩度差で表示する。Reset / Amendで作られるHistorical Routeは、`previousRoute`と明示されたreflog-only commitだけをfirst-parent pathとして所有し、最初の到達可能なlive commitの手前で停止する。これによりliveの共有ancestorや共有edgeをHistorical Routeが灰色化しない。

実在のparent関係は`GraphEdge.type = "parent"`で表し、`GitCommit.parentOids`の各要素から1本ずつ生成する。laneや表示都合でparent edgeを削除・統合しない。Working Tree、未完了operation、ref移動はそれぞれ`working-tree`、`operation`、`history-event`で分離する。Ref Eventのedgeには`annotation: "ref-event"`を付け、destination commitからイベントglyphへ向かう単一の補助接続として扱う。patchが似ているだけのsquash/cherry-pick/rebase前後をparent edgeへ変換しない。

## Rowとlaneの不変条件

1. rowは全可視nodeで一意である。
2. parent nodeはchildより下に置く。timestamp逆転があってもDAG制約を優先する。
3. ready queueのcommitter date、kind、stable idを用いて同じ入力から同じ順序を得る。
4. primary branchのfirst-parent chainはlane 0に固定する。mergeの2番目以降のparentは、現在refが残っていなくてもGitのparent関係からmerged side routeとして復元し、feature-only ancestryを別laneへ置く。現在のrefはbranch identityとbadgeの根拠であり、main laneの連続性や削除済みbranchの履歴を決める唯一の根拠にはしない。削除済みside routeはref名を推測せず、root OIDを内部family identityにしたlive palette色を使う。
5. 非primary laneはbranch identityごとに永久予約せず、parent / Working Tree / operation / Ref Eventの表示線を含む連続したY区間をbranch segmentとして割り当てる。古いmerge side pathから先にtrackを確定し、後続mergeのside pathが同じ履歴へ戻る場合はそのtrackへ遷移させる。segmentのY範囲が重ならない場合は同じlaneを再利用し、merge nodeだけで境界が接するsegmentも同じlaneを共有できる。重なる場合はlane 1から左側の空きlaneを選び、同一segment内のnodeは同じlaneを維持する。
6. local/remoteの同一branch familyは同系色とし、同一oidまたはtip同士がDAG上で祖先/子孫関係にある場合はref badgeだけを複数持つ一つのRoute/trackへ統合する。tip同士が比較可能でないdivergedな場合だけ別Route/trackとし、laneを再利用してもfamilyのbase hueとRoute variationを維持する。live Routeのfamily色はgrayを含まない固定palette（cyan / green / purple / yellow / orange / blue / pink / lime）から選び、main/masterとfeatureは従来の意味を保つ候補を優先する。それ以外はfamily名のstable hashを初期候補にし、現在表示中のRouteのY区間が重なるfamilyだけを競合として別palette色へ解決する。Y区間が重ならないfamilyは同じpalette色を再利用でき、全色が競合する場合だけ安全な明度・彩度variationへfallbackする。live variationは最低彩度・最低明度を下回らない範囲に固定し、gray / near-grayは`HISTORICAL_ROUTE_COLOR`のhistorical / PREVIOUS Routeだけに予約する。commitのlocal/remote到達性が片側だけの場合は`syncState`で未同期とし、node内部の固定斜めgradientだけを変える。gradientの軸は左上→右下、境界は左下→右上に固定する。
7. Working Treeはstatusが返す実際のchecked-out HEAD OIDをcommit nodeへ接続し、lane描画とは独立にcheckout中branchのlocal refをanchorの識別根拠として優先する。remote-tracking refが先行していてもremote tipへ接続しない。同じoidを指す新規branch作成直後でも、commit nodeは増やさずWorking Treeだけをbranch専用segmentへ置き、最初のcommitが作られたら同じsegment laneを引き継ぐ。
8. paginationでは最初から取得した先行commitのrow / laneを可能な限り維持し、追加parentを下へappendする。既存nodeのlaneを優先しつつ、新しく現れたsegmentには空いている左端laneを割り当てる。current Git stateの更新時だけ再レイアウトを許可する。

lane claimはvisual trackの補助情報であり、「commitがbranchに所属する」というGitの事実を表さない。Reset/AmendでfromOid側に残ったreflog commitはcurrent Routeとは別のhistorical Routeとしてgrayのside laneへ置き、通常行では`PREVIOUS` badgeをmessageの横に表示する。merge済みで現在もDAGから到達可能なside routeはhistoricalではなくlive routeとして扱い、grayを使わない。branch作成地点やdeleted branch名はreflogに明示的な証拠がない限り表示しない。

## Reflogとoperation

拡張は独自履歴DBを持たない。`ReflogEntry.previousOid`は同一refのselector indexが連続している場合だけ導出する。`Fast-forward`は明示的なmerge/pullまたはoperation-less `Fast-forward` subject、既存ancestor関係、移動先commitがsingle-parentであることのすべてが成立した場合だけ`fast-forward`に分類し、通常commit・checkout・fetch更新・multi-parent mergeなどはイベント化しない。意味のあるイベントも種別とfrom/to OIDが一致するHEAD/local/remote更新を1つの論理イベントへまとめ、refごとの時刻差には依存しない。FF eventには`git rev-list old..new`相当の`commitCount`を保持し、明示的に判別できた`pull`/`merge`だけを`operation`へ保存する。元のreflog subjectは`rawReflogMessage`としてtooltipへ残し、object graphが不完全な場合は件数を推測しない。

`MERGE_HEAD`、`REBASE_HEAD`、`CHERRY_PICK_HEAD`、`REVERT_HEAD`などが現在存在する場合のみoperation nodeを生成する。operation edgeは点線で、commit parent edgeとは混同しない。objectがGC済みのreflog OIDは表示しない。Reset / Amendのhistory eventはreflog subjectだけでは生成せず、from OIDからcurrent refへ到達できない実commitを少なくとも1つ表示できる場合に限って生成する。旧経路が存在しない通常のreflog移動はEventへ昇格しない。生成されたEventを選択すると、operation、branch / ref、old / new hash、timestamp、raw reflog messageをDetailで確認できる。Reset / Amend eventのtrackはref名だけで固定せず、現在の`toOid`が割り当てられたrouteを基準に解決する。後続のref移動でdestinationがPREVIOUSになった場合は同じHistorical Routeへ移し、live destinationの場合だけ現在のref laneへ置く。

## Runtime flow

1. `Git Lines: Open`で最初のworkspace folderをrepository候補にする。
2. `GitClient.readSnapshot`がroot、refs、最新30 commit、各worktree status、operation、reflog、shallow boundaryを読み込む。`git log --numstat`の一括レスポンスから可視commitごとの変更パス数とtracked additions/deletionsを保持し、commit単位の追加Git呼び出しは行わない。statusからWorking Treeの変更パス数を保持し、各worktreeにつき一度の`git diff --numstat HEAD`でtracked additions/deletionsを取得する（unborn HEADではcached diffへfallback）。
3. `buildGraphFacts`がcommit dedup、ref association、working/operation/event nodeを作る。
4. `createGraphLayout`がrow→branch segment lane→edge routingの順に計算し、WebviewへpostMessageする。グラフ幅は実際に表示されるnodeの最大laneだけから決まり、track数やevent文字列長で不要に拡大しない。
5. Webviewはcommit選択時だけdetail/filesをon-demand取得し、グラフ専用のスクロール領域を持つ。通常時はWorking Tree rowと各commit rowへ、同じcontent構造と固定3列のchanges columnを使って一括取得済みのfiles/additions/deletionsを表示する。commit選択時はWorking Treeの変更量を隠してsubject・short hash・同一commitのref badge・変更量・author・parent・Git name-status一覧・追加本文を階層化した約400pxのCommit Detailへ切り替える。Changed Filesはdetail panelの残り高さを使い、行を上詰めにして必要時だけ内部スクロールする。下端手前で次ページを自動取得し、手動refresh・focus・Git metadata watchでも再読込する。

グラフのSVGレイヤーにはレーン用の左余白を確保し、HTMLのcommit行はその右側から固定changes columnまでの幅を使って開始する。Working Tree summaryと全commitのchanges gridは同じ3列・同じ桁揃えを共有し、本文・badgeの開始位置は維持する。changes columnの開始位置はグラフcontentの利用可能幅に応じて左側へ追従する。Timelineにはgraph lane、最低限のcommit content、changes column、rowのgap/paddingを合算したminimum widthを持たせ、表示領域が狭い場合もchanges・metadataを先に隠さず横スクロールで確認できるようにする。ref badgeが多数ある行は全badgeを`flex-shrink: 0`で保持し、その合計幅をcontent minimumへ反映する。commit contentはmessage/refを1行目、short hash・Branch / Route・relative timeを2行目に置き、一覧からauthor名は除外する。Branch / RouteはGitのbranch含有検索ではなく、layout済みcommit nodeの`trackId`を`GraphTrack`へ解決し、local refを優先したroute名を表示する。長いroute名はmetadataとDetailのtooltipを残したままellipsisする。Commit Detailには同じroute名をAuthorの前に表示し、ref badgeとAuthor / Email / Changed Filesは保持する。messageは最大620px、各badgeは最大240pxを超えた場合だけellipsisする。Ref Eventは`anchorCommitId`でdestination commitを参照し、構造DAGのtopological計算からは除外したまま、destinationの直上へ独立したtimeline rowを割り当てる。同じイベントの`targetRef`を`targetLaneId`へ解決して対象branch/refと同じX座標に置き、イベントのためのGraphTrackや横方向の分岐は作らない。annotation edgeは同一lane内の縦コネクタとして描画し、イベントの`from`側をcommit DAGの線として描画しない。同一destinationに複数イベントがある場合は必要な数だけ独立rowを連続して割り当てる。Working Tree / operationは細い点線、commit parentとRef Event annotationは実線で表示する。commit rowのref badgeはcheckout中local branch、その他local、対応remote、その他remote、tag/specialの順にcommit本文の近くへ配置し、tagは形状を変えてbranch laneを作らない。Ref Eventのrowには`REF EVENT`種別ラベルや同一refの重複badgeを表示せず、diamond glyphだけをSVGのbranch lane上へ描画し、`FF · +N commits · operation`形式のイベント文字列は通常commitと同じHTML content columnから開始する。raw reflog、OID、影響ref、日時などの詳細はSVG glyphと行文字列のtooltipへ分離する。edge layerを先に、node layerを後に描画し、commit / Working Tree / Ref EventのSVG記号は線と同じnode layer上の図形で描画して線の隙間を作らない。commitとWorking Treeの`●`/`○`は同じ基準サイズで揃え、graph areaの幅は実際のnode laneから決まり、長いevent textでは広がらない。凡例はtoolbarのpopoverから参照できる。
実在する`parent` edgeの両端commitでtrack色が異なる場合だけ、SVG `linearGradient`をsource nodeからtarget nodeへ向けて適用する。同一branchのedge、Working Tree / operation、Ref Event annotation、reflog-only補助表現、lane再利用だけでGit edgeがない区間は単色のままにする。gradient定義はedgeごとに一意なIDを持ち、ノード・badge・lane割り当ての色は変更しない。`syncState`が`local-only`または`remote-only`のcommit nodeは、branch色を保ったまま左下から右上を境界とするnode専用gradientで描画する。薄い側のopacityでedgeが透けないよう、edge層とnode層の間にgraph background色の不透明な円形マスクを置く。選択時の外側リングは別レイヤーとして共存させる。Working Tree、Ref Event、reflog-only nodeには適用しない。旧経路commitの行はUI上`PREVIOUS`とし、badgeはmessageのinline、metadataは通常commitと同じcontent startに置く。描画境界の`GraphSvg`は、trackが欠けたlive node / edgeも直接ref、接続するlive Route、live代表色の順で解決し、`graph-muted`へfallbackしない。historical / PREVIOUSだけがhistorical grayを使う。

## Security / Accessibility

Gitは`spawn`へ引数配列を渡し、shell文字列連結を行わない。Webviewはnonce付きstrict CSP、限定された`localResourceRoots`、外部scriptなしで生成する。色だけで状態を伝えず、記号・ラベル・線種・ARIA label・keyboard focusを併用する。

## 検証アンカー

- `tests/unit/parsers.test.ts` — NUL形式log/ref/reflog、annotated tagのpeeled commit、porcelain status、worktree parser
- `tests/unit/layout.test.ts` — row一意性、timestamp inversion、primary lane、merge side pathの歴史復元、octopus / repeated mergeのfirst-parent連続性、Y区間ベースのsegment lane再利用 / 衝突回避 / 左端優先、同一laneの独立Ref Event row、縦annotation
- `tests/unit/history-events.test.ts` — FF/reset/amend/rebaseの保守的分類、`old..new`件数、操作名
- `tests/unit/event-presentation.test.ts` — FFラベルの単数/複数、幅別compact表示、content column配置、tooltip情報
- `tests/unit/graph-builder.test.ts` — ref dedup、tag、常時Working Tree、remote-ahead時の実HEAD接続、2/3-parent edge、destination/targetRef付きRef Event
- `tests/unit/ref-display.test.ts` / `tests/unit/graph-metrics.test.ts` — 多数refのbadge保持とchanges column用横幅確保
- `tests/integration/git-client.test.ts` — 実Git repository fixtureからのbranch/ref/status読み取り、long feature merge、未commitbranch、first commit、後続ResetでHistoricalへ移る旧Reset event
