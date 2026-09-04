# Git Lines グラフアーキテクチャ

## 目的と境界

Git Linesは、VS Code Extension HostでGit CLIを読み取り、Gitの事実モデルと表示用のレイアウトモデルを分離してWebviewへ渡す。初回版はDesktop / Remote Workspace向けの読み取り専用拡張であり、Gitの状態を変更するコマンドは実行しない。

## 現在の構成

- `src/git/` — 引数配列でGit CLIを実行し、log・refs・status・reflog・worktree・pseudo refsを機械可読形式からパースする。
- `src/repository/` — repository root / git dir / common git dirを検出し、Git metadataをbest-effortで監視する。
- `src/model/` — `GraphFactModel`を構成する。ここではcommitのparent、ref、reflog、operationなどGitの事実を保持し、laneやpixel座標を事実として扱わない。commit DAGと、Working Tree（必要なら未完了operationを内包）/ Ref Eventの補助ノードを型とedge種別で分離する。
- `src/layout/` — row、lane、edge routingを決定する。決定論的topological date-order、primary branchのlane 0、append時の既存座標維持を担当する。
- `src/webview/` — CSP nonce付きHTML、message protocol、VS Code panelのライフサイクルを担当する。
- `webview/src/` — React UI。SVGをedge/node layer、HTMLをsubject/badge/detail layerとして使い、dark/high-contrast tokenとkeyboard focusを維持する。

## データと状態モデル

`GitCommit`の`oid`と`parentOids`が唯一のcommit identityである。複数refが同じoidを指す場合もcommit nodeは1つにまとめ、ref badgeを複数付ける。annotated tagはref取得時にpeeled commitへ解決し、lightweight tagと同じcommitへbadgeを付ける。tagとsymbolic remote HEADはlaneを作らない。

`GraphNode`の種類は次のとおり。commit nodeには表示用に正規化したref badgeと、local/remoteからの到達性に基づく`syncState`（`shared` / `local-only` / `remote-only`）を持たせるが、full refは事実モデルに保持する。symbolic ref、`ORIG_HEAD`などのpseudo refは通常のbranch badgeやlaneに含めない。

- `commit` — current refs、または現在のdetached HEADから到達できる実在commit。detached HEADがbranch refを持たないcommitを直接指していても、現在状態のlive rootとして扱う
- `reflog-commit` — 現在のuser-facing refと現在のdetached HEADのどちらからも到達できず、reflogから確認でき、objectが残っているcommit。Reset/Amend/完了Rebaseの旧経路だけ`previousRoute`を持ち、行表示では`PREVIOUS`になる。それ以外の同一first-parent経路は`historicalKind`（明示的な削除証拠がある場合は`deleted-branch`、それ以外は`unreferenced`）と`historicalRouteId`でside routeにまとめ、route先頭だけ分類badgeを表示する
- `working-tree` — commit objectではない現在状態。未完了operationがある場合は`GraphNode.operation`として同じノードに付与する
- `operation` — 未完了operationのsource commitへ張る点線edgeの種別。現在のGraphBuilderは独立したoperation nodeを生成しない
- `fast-forward-event` / `history-event` — 完了Cherry-pick / RevertのうちExact Relationにできないもの、およびReset / Branch move / 完了linear Rebase以外の、reflogから確認できるref移動の時系列行。commitとは別モデルで、`anchorCommitId`は移動先、`eventBoundaryCommitId`は操作後の新しい履歴区間の直下、`eventStartCommitId`はその区間の直上にある注釈接続元を参照する。Amend、およびsource/targetがCERTAINなCherry-pick / Revertは`HistoryRelation`としてDAGのrow外へ分離する。ExactなReset / Branch moveは`RefMovementRelation`として、commit rewriteではなくref位置の移動を表す。完了した通常のlinear Rebaseは`RebaseRelation`としてOLD GROUP → NEW GROUPのcommit rewrite overlayへ分離する
- `history-boundary` — paginationまたはshallow cloneで未読parentを示すstub

`GraphTrack`はbranch family内のRouteごとの色・ref一覧に加え、表示中のY区間ごとの`segments`（`startRow`、`endRow`、`lane`）を持つ。RouteはDAG上の連続経路、laneはその経路の一時的なX座標であり、`lane`は互換性のための代表値である。refの追加や移動だけではlaneを増やさず、同じfamilyでもtipが実際に分岐したRouteだけを別laneへ置く。familyはlocal refとremote-tracking refのcanonicalなbranch名から解決し、同じfamilyの別Routeは同じbase hueの明度・彩度差で表示する。Reset / Amend / 完了Rebaseで作られるHistorical Routeと、reflogからのみ復元した未参照経路は、各commitの`historicalRouteId`に基づくfirst-parent side routeとして所有し、最初の到達可能なlive commitの手前で停止する。これによりliveの共有ancestorや共有edgeをHistorical Routeが灰色化しない。

実在のparent関係は`GraphEdge.type = "parent"`で表し、`GitCommit.parentOids`の各要素から1本ずつ生成する。laneや表示都合でparent edgeを削除・統合しない。Working Treeと未完了operationは同じ`working-tree` nodeにまとめ、HEADへは`working-tree` edge、operationのsource commitへは`operation` edgeをWorking Treeから直接張る。通常のref移動のうちfrom/toが揃わないReset / Branch move、およびforce-update / generic-ref-moveは`history-event`で表し、AmendおよびExactなCherry-pick / Revertはcommit rewriteの`HistoryRelation`、ExactなReset / Branch moveはref位置の`RefMovementRelation`、完了した通常のlinear Rebaseはgroup rewriteの`RebaseRelation`としてDAGのnode / row / lane / edgeとは別に表す。Ref Eventには、移動先を保持する`anchorCommitId`、行配置の意味的な下側境界を保持する`eventBoundaryCommitId`、注釈線の上側接続元を保持する`eventStartCommitId`を使う。annotation edgeには`annotation: "ref-event"`を付け、source/targetがCERTAINでないCherry-pick / Revertは生成commitのparent直上、Resetは移動先commitの直上へevent rowを挿入する（Exact overlayへ移行できない場合のみ）。完了RebaseはExact Group Overlayへ移行できないときだけ、従来どおり再構築区間の最下端（onto commitの直上）へHistory Event rowを置く。Amendはreflogの旧OID→新OID、Cherry-pickはcommit本文のsource OID→新OID、Revertはcommit本文のtarget OID→新OIDを`HistoryRelation`へ保持し、両端が現在表示可能なときだけ短い矢印付きoverlayを描画する。SOURCE / TARGET / OLD commitのPREVIOUS / Historical判定はこのrelationとは独立して行い、Exact Relationのために偽のparent edgeは作らない。確実なbranch rename reflogがある場合は、commit DAGを変更せず同じroute上のWorking TreeとHEAD commitの間にrename event rowを挿入し、元のWorking Tree edgeを同じ曲線上でevent位置の前後へ分割する。事実モデルのWorking Tree edgeとrename annotation edgeは保持するが、描画では前者の2本のdotted pathだけを出してannotationの縦stubを重ねない。patchが似ているだけのsquash/cherry-pick/rebase前後をparent edgeへ変換しない。

完了RebaseのExact overlayはGit DAGを変更しない。parent edge、lane assignment、current routeの直接連結はそのまま残し、OLD GROUP → NEW GROUPを別layerのOperation Overlayとして重ねる。single-commitはAmendと同じcommit rewrite curve（OLD tip → NEW tip）で、大きなgroup outlineは描かない。multi-commitはmember nodeのgraph座標からlane-awareな破線outlineを作り、group境界同士を1本のconnectorで結ぶ。個別commitのA→A' mapping矢印は描かない。`◇ Rebase`はconnector上のmarkerであり、parent edgeの途中へ挿入するDAG nodeではない。overlayを安全に復元できない場合だけ、実DAG factsのparent edgeは変更せず、再構築区間の最下端からonto commitまでのvisual pathをRebase event位置で同じBezier曲線の2区間へ分割する従来のHistory Event表示へ戻す。Reflog OFFではoverlay、Historical route、Annotation Row、分割pathを出さず通常の直接parent pathへ戻す。

## Rowとlaneの不変条件

1. rowは全可視nodeで一意である。
2. parent nodeはchildより下に置く。timestamp逆転があってもDAG制約を優先する。
3. ready queueのcommitter date、kind、stable idを用いて同じ入力から同じ順序を得る。
4. primary branchのfirst-parent chainはlane 0に固定する。mergeの2番目以降のparentは、現在refが残っていなくてもGitのparent関係からmerged side routeとして復元し、feature-only ancestryを別laneへ置く。現在のrefはbranch identityとbadgeの根拠であり、main laneの連続性や削除済みbranchの履歴を決める唯一の根拠にはしない。削除済みside routeはref名を推測せず、明示的な削除reflogがなければ`UNREFERENCED`へフォールバックし、root OIDを内部identityにしたHistorical side laneへ置く。現在のdetached HEADが名前付きrefから分岐している場合は、branch refを新設せず、DAG edgeを自然に接続する内部live routeへ割り当てる。
5. 非primary laneはbranch identityごとに永久予約せず、parent / Working Tree / operation / Ref Eventの表示線を含む連続したY区間をbranch segmentとして割り当てる。古いmerge side pathから先にtrackを確定し、後続mergeのside pathが同じ履歴へ戻る場合はそのtrackへ遷移させる。segmentのY範囲が重ならない場合は同じlaneを再利用し、merge nodeだけで境界が接するsegmentも同じlaneを共有できる。重なる場合はlane 1から左側の空きlaneを選び、同一segment内のnodeは同じlaneを維持する。
6. local/remoteの同一branch familyは同系色とし、同一oidまたはtip同士がDAG上で祖先/子孫関係にある場合はref badgeだけを複数持つ一つのRoute/trackへ統合する。tip同士が比較可能でないdivergedな場合だけ別Route/trackとし、laneを再利用してもfamilyのbase hueとRoute variationを維持する。live Routeのfamily色はgrayを含まない固定palette（cyan / green / purple / yellow / orange / blue / pink / lime）から選び、main/masterとfeatureは従来の意味を保つ候補を優先する。それ以外はfamily名のstable hashを初期候補にし、現在表示中のRouteのY区間が重なるfamilyだけを競合として別palette色へ解決する。Y区間が重ならないfamilyは同じpalette色を再利用でき、全色が競合する場合だけ安全な明度・彩度variationへfallbackする。live variationは最低彩度・最低明度を下回らない範囲に固定し、gray / near-grayは`HISTORICAL_ROUTE_COLOR`のhistorical / PREVIOUS Routeだけに予約する。commitのlocal/remote到達性が片側だけの場合は`syncState`で未同期とし、node内部の固定斜めgradientだけを変える。gradientの軸は左上→右下、境界は左下→右上に固定する。
7. Working Treeはstatusが返す実際のchecked-out HEAD OIDをcommit nodeへ接続し、lane描画とは独立にcheckout中branchのlocal refをanchorの識別根拠として優先する。remote-tracking refが先行していてもremote tipへ接続しない。detached HEADのOIDはbranch refがなくてもlive rootへ加え、そこからのcommitをHistoricalへ落とさない。同じoidを指す新規branch作成直後でも、commit nodeは増やさずWorking Treeだけをbranch専用segmentへ置き、最初のcommitが作られたら同じsegment laneを引き継ぐ。
8. paginationでは最初から取得した先行commitのrow / laneを可能な限り維持し、追加parentを下へappendする。既存nodeのlaneを優先しつつ、新しく現れたsegmentには空いている左端laneを割り当てる。current Git stateの更新時だけ再レイアウトを許可する。

lane claimはvisual trackの補助情報であり、「commitがbranchに所属する」というGitの事実を表さない。Reset/AmendでfromOid側に残ったreflog commitはcurrent Routeとは別のhistorical Routeとしてgrayのside laneへ置き、通常行では`PREVIOUS` badgeをmessageの横に表示する。削除・renameなどの理由が確定できないreflog-only経路は`UNREFERENCED`として同じside-lane機構へ渡し、route先頭だけbadgeを表示する。merge済みで現在もDAGから到達可能なside routeはhistoricalではなくlive routeとして扱い、grayを使わない。branch作成地点やdeleted branch名はreflogに明示的な証拠がない限り表示しない。

## Reflogとoperation

拡張は独自履歴DBを持たない。`ReflogEntry.previousOid`は同一refのselector indexが連続している場合だけ導出する。`Fast-forward`は明示的なmerge/pullまたはoperation-less `Fast-forward` subject、既存ancestor関係、移動先commitがsingle-parentであることのすべてが成立した場合だけ`fast-forward`に分類し、通常commit・checkout・fetch更新・multi-parent mergeなどはイベント化しない。意味のあるイベントも種別とfrom/to OIDが一致するHEAD/local/remote更新を1つの論理イベントへまとめ、refごとの時刻差には依存しない。FF eventには`git rev-list old..new`相当の`commitCount`を保持し、明示的に判別できた`pull`/`merge`だけを`operation`へ保存する。元のreflog subjectは`rawReflogMessage`としてtooltipへ残し、object graphが不完全な場合は件数を推測しない。

`MERGE_HEAD`、`REBASE_HEAD`、`CHERRY_PICK_HEAD`、`REVERT_HEAD`などが現在存在する場合のみoperation stateをWorking Tree nodeへ付与する。operation edgeは点線で、commit parent edgeとは混同しない。objectがGC済みのreflog OIDは表示しない。Reset / Amend / 完了Rebaseの証拠はreflog subjectと実在OIDから保守的に解決し、Resetは旧経路に表示可能な実commitがある場合、Amendはfrom/to両OIDが取得できる場合に`HistoryRelation`を生成する。Amendの旧commitをPREVIOUSへ分類するかどうかはrelationの有無とは独立する。完了RebaseのHistory Eventは対象local branchの`rebase (finish)` reflogに実在するfrom/to OIDがある場合に限って生成する。Exact `RebaseRelation`はそれに加え、同じHEAD sessionの`rebase (start)` / pick / finish、明示的onto、一意なlinear old/new range、equal countが揃ったときだけ作る。完了Cherry-pick / Revertはlocal branch reflogの明示的な操作subjectと実在するfrom/to commitがある場合だけ生成する。Exact Overlayは、Cherry-pickならcommit本文の`(cherry picked from commit <OID>)`、Revertなら`This reverts commit <OID>.`がCERTAINなときだけ`HistoryRelation`へ移行し、そうでない場合は既存のHistory Event rowを残す。Cherry-pickのSOURCEやRevertのTARGETをPREVIOUSへ分類するかどうかはrelationの有無とは独立する。Rebase中のHEAD start/continue/finish(returning) entryは内部移動として除外し、branchのfinish entryへ集約する。進行中rebaseを完了Relationとして扱わない。Merge完了は実際のmulti-parent commit自体が操作を表すためHistory Eventへ昇格しない。`Branch: renamed refs/heads/<old> to refs/heads/<new>`というGitの明示的なrename reflogは、同じOIDを維持するref名操作としてHEAD / 新branch refの重複を1件へまとめ、同じlive routeのWorking Treeと対象commitの間へ配置する。旧経路が存在しない通常のreflog移動はEventへ昇格しない。生成されたEventを選択すると、operation、branch / ref、old / new hash、timestamp、raw reflog messageをDetailで確認できる。Reset / Rebase eventのtrackはref名だけで固定せず、現在の`toOid`が割り当てられたrouteを基準に解決する。後続のref移動でdestinationがPREVIOUSになった場合は同じHistorical Routeへ移し、live destinationの場合だけ現在のref laneへ置く。

Linked worktreeは追加の`working-tree` nodeやtrackを作らない。`GitClient`が現在開いているrepository rootに一致するworktreeへ`currentWorktree`を付け、GraphBuilderはそのworktreeだけを大きなWorking Tree rowとして残す。その他のworktreeはHEAD commitの`linkedWorktrees` annotationへ付与し、commit rowの紫枠と`Linked Worktree`ラベル、tooltip / DetailのBranch・Path・Statusで表す。したがってlinked worktreeの存在はcommit DAGやlaneの構造を変更せず、同じcommitを別ディレクトリでcheckoutしている付随情報として扱う。

### Completed Cherry-pick / Revert evidence

完了したCherry-pick / RevertのHistory Eventは、branch reflogで操作のref移動と実在するfrom/to commitが確認できる場合に作成する。表示用のsource / target OIDは、イベントのto commit本文からGitが明示的に残した標準情報だけを読み取る。Cherry-pickはgit cherry-pick -xの「(cherry picked from commit <OID>)」、Revertは「This reverts commit <OID>.」に限定し、subject、patch、類似検索からは推測しない。source / targetが取得でき、かつ両端commitが現在のgraph pageに載っている場合だけHistory Event rowを`HistoryRelation` + `OperationAnnotationRow`へ移行する。取得できない場合もEventは保持し、主行は安全なフォールバック表示にする。Partial Relation（◇だけを残す一般化）は未実装である。

## Runtime flow

1. `Git Lines: Open`で最初のworkspace folderをrepository候補にする。
2. `GitClient.readSnapshot`がroot、refs、`HEAD`を含む最新30 commit、各worktree status、operation、reflog、shallow boundaryを読み込む。`git log --numstat`の一括レスポンスから可視commitごとの変更パス数とtracked additions/deletionsを保持し、通常のcommit単位の追加Git呼び出しは行わない。完了Cherry-pick / Revertのsource / target evidenceに限り、対象to commit本文を一括で追加取得する。statusからWorking Treeの変更パス数を保持し、各worktreeにつき一度の`git diff --numstat HEAD`でtracked additions/deletionsを取得する（unborn HEADではcached diffへfallback）。
3. `buildGraphFacts`がcommit dedup、ref association、Working Tree（必要ならoperation付き）/event nodeと、Amend / Exact Cherry-pick / Exact Revertの`HistoryRelation`、Exact Reset / Branch moveの`RefMovementRelation`、完了linear Rebaseの`RebaseRelation`を作る。
4. `createGraphLayout`がrow→branch segment lane→edge routingの順に計算し、WebviewへpostMessageする。グラフ幅は実際に表示されるnodeの最大laneだけから決まり、track数やevent文字列長で不要に拡大しない。
5. Webviewはcommit選択時だけdetail/filesをon-demand取得し、グラフ専用のスクロール領域を持つ。通常時はWorking Tree rowと各commit rowへ、同じcontent構造と固定3列のchanges columnを使って一括取得済みのfiles/additions/deletionsを表示する。commit選択時はWorking Treeの変更量を隠してsubject・short hash・同一commitのref badge・変更量・author・parent・Git name-status一覧・追加本文を階層化した約400pxのCommit Detailへ切り替える。Changed Filesはdetail panelの残り高さを使い、行を上詰めにして必要時だけ内部スクロールする。下端手前で次ページを自動取得し、手動refresh・focus・Git metadata watchでも再読込する。

グラフのSVGレイヤーにはレーン用の左余白を確保し、HTMLのcommit行はその右側から固定changes columnまでの幅を使って開始する。Working Tree summaryと全commitのchanges gridは同じ3列・同じ桁揃えを共有し、本文・badgeの開始位置は維持する。changes columnの開始位置はグラフcontentの利用可能幅に応じて左側へ追従する。Timelineにはgraph lane、最低限のcommit content、changes column、rowのgap/paddingを合算したminimum widthを持たせ、表示領域が狭い場合もchanges・metadataを先に隠さず横スクロールで確認できるようにする。ref badgeが多数ある行は全badgeを`flex-shrink: 0`で保持し、その合計幅をcontent minimumへ反映する。commit contentはmessage/refを1行目、short hash・Branch / Route・relative timeを2行目に置き、一覧からauthor名は除外する。Branch / RouteはGitのbranch含有検索ではなく、layout済みcommit nodeの`trackId`を`GraphTrack`へ解決し、local refを優先したroute名を表示する。長いroute名はmetadataとDetailのtooltipを残したままellipsisする。Commit Detailには同じroute名をAuthorの前に表示し、ref badgeとAuthor / Email / Changed Filesは保持する。messageは最大620px、各badgeは最大240pxを超えた場合だけellipsisする。Ref Eventは`anchorCommitId`で移動先commitを参照し、`eventBoundaryCommitId`を行挿入位置、`eventStartCommitId`をannotationの上側接続元として使う。構造DAGのtopological計算からは除外したまま、Ref Eventだけにsemantic boundaryの直上へ独立したtimeline rowを割り当てる。同じイベントの`targetRef`を`targetLaneId`へ解決して対象branch/refと同じX座標に置き、イベントのためのGraphTrackや横方向の分岐は作らない。Exact Operation Overlayは行を増やさず、現在表示中のsource/target commitを同じSVG座標系の短い点線Bezierと矢印、`◇ Amend` / `◇ Cherry-pick` / `◇ Revert` annotationで結ぶ。source/targetのどちらかが未ロードなら描画しない。annotation edgeは同一lane内の縦コネクタとして描画し、イベントの`from`側をcommit DAGの線として描画しない。同一boundaryに複数イベントがある場合は必要な数だけ独立rowを連続して割り当てる。Working TreeからHEAD/sourceへ伸びる`working-tree` / `operation` edgeは細い点線、commit parentとRef Event annotationは実線で表示する。commit rowのref badgeはcheckout中local branch、その他local、対応remote、その他remote、tag/specialの順にcommit本文の近くへ配置し、tagは形状を変えてbranch laneを作らない。Ref Eventのrowには`REF EVENT`種別ラベルや同一refの重複badgeを表示せず、diamond glyphだけをSVGのbranch lane上へ描画し、`FF · +N commits · operation`形式のイベント文字列は通常commitと同じHTML content columnから開始する。raw reflog、OID、影響ref、日時などの詳細はSVG glyphと行文字列のtooltipへ分離する。edge layerを先に、Operation Overlayをその上、node layerを後に描画し、commit / Working Tree / Ref EventのSVG記号は線と同じnode layer上の図形で描画して線の隙間を作らない。commitとWorking Treeの`●`/`○`は同じ基準サイズで揃え、graph areaの幅は実際のnode laneから決まり、長いevent textでは広がらない。凡例はtoolbarのpopoverから参照できる。
実在する`parent` edgeの両端commitでtrack色が異なる場合だけ、SVG `linearGradient`をsource nodeからtarget nodeへ向けて適用する。同一branchのedge、Working Tree / operation、Ref Event annotation、reflog-only補助表現、lane再利用だけでGit edgeがない区間は単色のままにする。gradient定義はedgeごとに一意なIDを持ち、ノード・badge・lane割り当ての色は変更しない。`syncState`が`local-only`または`remote-only`のcommit nodeは、branch色を保ったまま左下から右上を境界とするnode専用gradientで描画する。薄い側のopacityでedgeが透けないよう、edge層とnode層の間にgraph background色の不透明な円形マスクを置く。選択時の外側リングは別レイヤーとして共存させる。Working Tree、Ref Event、reflog-only nodeには適用しない。旧経路commitの行はUI上`PREVIOUS`とし、badgeはmessageのinline、metadataは通常commitと同じcontent startに置く。描画境界の`GraphSvg`は、trackが欠けたlive node / edgeも直接ref、接続するlive Route、live代表色の順で解決し、`graph-muted`へfallbackしない。historical / PREVIOUSだけがhistorical grayを使う。

### Ref-only ref operation timeline

force update、generic ref move、およびfrom/toの片方が未ロードなReset / Branch moveは、従来どおり`refOnly` eventまたはHistory Event fallbackとして扱う。ExactなReset / Branch moveはevent rowへ置かず`RefMovementRelation`へ移行する。Working TreeとHEADの`working-tree` edgeは分割しない。後方Resetの除外範囲と件数、mode名はGitが明示した場合だけ保持し、index/worktreeからは推測しない。Reflog OFFではRef Movement overlay、ghost badge、fallback event rowを除き、通常のDAGへ戻す。

### Commit Relation and Ref Movement

Commit Operation Overlay（`HistoryRelation`）はcommit objectの変換である。

- Amend: OLD commit → NEW commit
- Cherry-pick Exact: SOURCE commit → NEW commit
- Revert Exact: TARGET commit → NEW commit

Ref Movement Overlay（`RefMovementRelation`）はGit refの位置移動である。

- Reset: `ref@fromOid` → `ref@toOid`
- Branch move: 同じgeometry、operation名だけ異なる

curveのendpointはcommit node中心ではなく、graph area内のref-position anchor（実際のcompactなgraph-side endpoint badgeの左端から幅の25%内側、commit中心とbadge中心を結ぶ線分上）である。Yは相手endpointの方向に応じ、下方向へ出入りする側ではbadge bottom + gap、上方向へ出入りする側ではbadge top - gapに置く。Reset / Branch moveのvisible endpointのref badgeはcommit nodeのすぐ右（graph column）へ置き、同じrefのmessage側badgeは重複表示しない。現在位置は既存のsolid branch-color badge、過去位置は同じ形状のdashed-border ghost（文字はsolid、opacityはわずかに下げる）である。graph-side badgeだけ専用の小型metricを使い、通常のmessage-side badge metricは変えない。ghostは各operationのfrom/to tipだけに付け、途中のfirst-parent commitには付けない。現在そのrefが指しているcommitではcurrent badgeを優先し、同一名のghostは重ねない。他のlive refはmessage側に残す。PREVIOUS / Historical判定はreachabilityから行い、ghost badgeの有無では決めない。liveな別refが残るcommitにもghost mainを付けてよい。`fromOid === toOid`のno-op、および片端がpage外のcurveは出さない。複数movementのdedupeは`kind + refName + fromOid + toOid`であり、逆方向のResetとBranch moveは1本へcollapseしない。Reflog OFFではgraph側endpoint badgeも消え、current refは通常のmessage側badgeへ戻る。

### Group Commit Rewrite (Completed Rebase)

`RebaseRelation`はref移動ではなく、証明済みのlinear commit range rewriteである。

- Commit Relation: Amend / Cherry-pick Exact / Revert Exact（1 commit → 1 commit）
- Ref Movement: Reset / Branch move（`ref@OLD` → `ref@NEW`）
- Ref Event: Branch rename（名前だけ。位置は動かない）
- Group Commit Rewrite: Rebase（OLD GROUP → NEW GROUP）

group membershipは`oldOids[i] ↔ newOids[i]`の個別対応を意味しない。配列順はoldest → newestで一意にし、tipは各groupのnewestである。onto / shared baseはgroupへ含めない。PREVIOUS判定はreachabilityのままであり、old group memberでも別のlive refから到達できればlive色を保つ。同じcommitがAmend endpointとRebase group memberを兼ねてよい。AmendのsourceをRebase old rangeへ吸収しない。

Exact overlayを作る条件はGit標準情報だけである。local branchの`rebase (finish)`、HEADの同じsession（`rebase (start)` から `rebase (finish): returning to` まで連続したrebase subject）、明示的なonto OID、実在するold/new tip、ontoから到達可能なshared baseまでの一意なfirst-parent linear range、old count = new count。message / patch-id / tree / timestamp / topology推測は使わない。in-progress rebase、interactive squash/fixup/drop/reword/edit、merge commitを含むrange、count不一致、session欠落、member未ロードはHistory Event fallbackへ戻す。Reflog OFFではrelation、group outline、connector、`◇ Rebase`、Annotation Row、reflog-only old commitsを出さない。

single（count 1）は大きなoutlineなしのcommit rewrite curve。multipleはgraph areaだけの破線group outline（`--operation-overlay-accent`、薄いfill）と、OLD GROUP境界 → NEW GROUP境界の1本のconnector、その上の`◇ Rebase`、Annotation Row 1つ（`Rebase · feature: N commits · OLD_TIP → NEW_TIP`）である。

### Operation Overlay presentation

Operation Overlayのcurve、diamond、labelは`--operation-overlay-accent`を共有し、通常のbranch DAG色から独立した専用accentで描画する。overlayの色はrelation表示だけに適用し、DAGのnode / edge色や履歴判定は変更しない。操作の区別は色ではなく`◇ Amend` / `◇ Cherry-pick` / `◇ Revert` / `◇ Reset` / `◇ Branch move` / `◇ Rebase`のoperation名で行う。Amend / Cherry-pick / Reset / Branch move / Rebaseは移動先側（RebaseはNEW GROUP側）にtriangle arrowheadを置く。Revertは打ち消し対象を表すためTARGET側に小さな`×`を置き、NEW側のtriangleは描かない。同一laneで親edgeと長距離重なるRevert、および同じ条件のRef Movementは、Bezier制御点を局所offsetする。Ref Movementは最小〜最大bulgeで1本のcubic Bezierを作り、diamondはその曲線上に置く。同じunordered endpoint pairを共有する複数movementは、lane回避offsetと合成した小さなpair separation（8px）だけを加え、逆方向relationも矢印のfrom/toを維持したまま分離する。graph-side operation labelの実幅とdiamond/gapはgraph column幅に含め、message-side annotation boxと重ならないようにする。

Implemented:
- Amend（OLD → NEW。reflogの明示的amend遷移）
- Cherry-pick Exact Relation（SOURCE → NEW。`-x`本文のsource OIDがある場合のみ）
- Revert Exact Relation（TARGET → NEW。標準本文の`This reverts commit <OID>.`がある場合のみ）
- Reset Ref Movement（ghost ref → current/historical ref。from/toがloadedな場合）
- Branch move Ref Movement（Resetと同じgeometry）
- Rebase Overlay（OLD GROUP → NEW GROUP。標準reflog sessionとlinear equal-count rangeが証明できる場合。singleはcommit rewrite curve、multipleはgroup outline）

Not yet:
- Partial Relation（操作は確実だがsource/targetが不明なときの◇のみ）
- Interactive Squash / Fixup / drop / reorder
- Squash Merge
- `--rebase-merges` / mergeを含むrebase
- Branch rename redesign（ref名変更。位置は動かない）

Exact relationが表示対象になる場合は、共有の`OperationAnnotationRow`をlayout上の仮想timeline rowとして1行だけ確保する。このrowはmessage columnに操作詳細を表示し、graph側の`◇ <operation>`は既存overlay geometryのcurve上に置く。rowはcommit node、DAG edge、lane、parent relationには参加せず、選択リングの対象にもしない。Reflog OFFまたはsource/target未ロード時はrelationとともに消える。SOURCE / TARGET / 過去のref位置commitがliveなら通常DAGとして残る。進行中のCherry-pick / Revert / RebaseはWorking Treeのin-progress表示のまま変更しない。

## Security / Accessibility

Gitは`spawn`へ引数配列を渡し、shell文字列連結を行わない。Webviewはnonce付きstrict CSP、限定された`localResourceRoots`、外部scriptなしで生成する。色だけで状態を伝えず、記号・ラベル・線種・ARIA label・keyboard focusを併用する。

## 検証アンカー

- `tests/unit/parsers.test.ts` — NUL形式log/ref/reflog、annotated tagのpeeled commit、porcelain status、worktree parser
- `tests/unit/layout.test.ts` — row一意性、timestamp inversion、primary lane、merge side pathの歴史復元、octopus / repeated mergeのfirst-parent連続性、Y区間ベースのsegment lane再利用 / 衝突回避 / 左端優先、同一laneの独立Ref Event row、縦annotation
- `tests/unit/history-events.test.ts` — FF/reset/amend/rebase/cherry-pick/revert/branch renameの保守的分類、完了Rebaseの内部HEAD entry集約、semantic boundary、`old..new`件数、操作名
- `tests/unit/event-presentation.test.ts` — FF/reset/amend/rebase/cherry-pick/revert/branch renameラベル、幅別compact表示、content column配置、tooltip情報
- `tests/unit/ref-movement.test.ts` — Reset / Branch moveのRef Movement Overlay、ghost badge、no-op、Reflog OFF、Working Tree edge
- `tests/unit/ref-movement-presentation.test.ts` — graph側endpoint badge、message側の非重複、Reflog OFFの通常badge復帰
- `tests/unit/ref-movement-routing.test.ts` — reciprocal pair separation、single cubic marker/tangent、bulge clamp、graph label width、DAG/HistoryRelation回帰
- `tests/unit/rebase-relation.test.ts` — completed linear Rebaseのsession / range復元、equal count、fallback、in-progress除外、Amend共存、pagination、Reflog OFF
- `tests/unit/rebase-overlay-geometry.test.ts` — single/multi render、group bounds、OLD → NEW tangent
- `tests/unit/graph-builder.test.ts` — ref dedup、tag、常時Working Tree、remote-ahead時の実HEAD接続、2/3-parent edge、destination/boundary/targetRef付きRef Event、Amend / Exact Cherry-pick / Exact Revert overlay、Reset / Branch moveのRef Movement、完了Rebase overlayとPREVIOUS
- `tests/integration/git-client.test.ts` — 実Git CLIのin-progress operation、branch rename、完了Cherry-pick/RevertのExact Overlayとsource不明時の既存event、single/multi-commit Rebase overlay、実MergeでHistory Eventを作らないこと、long feature merge、未commitbranch、first commit、Reset / Branch move overlayと後続ResetでHistoricalへ移る旧tip
