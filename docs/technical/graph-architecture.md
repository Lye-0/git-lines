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

`GitCommit`の`oid`と`parentOids`が唯一のcommit identityである。複数refが同じoidを指す場合もcommit nodeは1つにまとめ、ref badgeを複数付ける。tagとsymbolic remote HEADはlaneを作らない。

`GraphNode`の種類は次のとおり。commit nodeには表示用に正規化したref badgeを持たせるが、full refは事実モデルに保持する。symbolic ref、`ORIG_HEAD`などのpseudo refは通常のbranch badgeやlaneに含めない。

- `commit` — current refsから読み込んだ実在commit
- `reflog-commit` — 現在のuser-facing refから到達できず、reflogから確認でき、objectが残っているcommit
- `working-tree` / `operation` — commit objectではない現在状態
- `fast-forward-event` / `history-event` — reflogから確認できるref移動の時系列行。commitとは別モデルだが、`anchorCommitId`でdestinationを参照する
- `history-boundary` — paginationまたはshallow cloneで未読parentを示すstub

実在のparent関係は`GraphEdge.type = "parent"`で表し、`GitCommit.parentOids`の各要素から1本ずつ生成する。laneや表示都合でparent edgeを削除・統合しない。Working Tree、未完了operation、ref移動はそれぞれ`working-tree`、`operation`、`history-event`で分離する。Ref Eventのedgeには`annotation: "ref-event"`を付け、destination commitからイベントglyphへ向かう単一の補助接続として扱う。patchが似ているだけのsquash/cherry-pick/rebase前後をparent edgeへ変換しない。

## Rowとlaneの不変条件

1. rowは全可視nodeで一意である。
2. parent nodeはchildより下に置く。timestamp逆転があってもDAG制約を優先する。
3. ready queueのcommitter date、kind、stable idを用いて同じ入力から同じ順序を得る。
4. primary branchはlane 0を基本とし、feature-only ancestryは別laneへ置く。各ref tipからの最短parent距離を比較し、merge後もfeature tipに近いcommitをfeature laneへ残す。
5. local/remoteの同一familyは同系色、同一oidなら同一track、divergedなら隣接する別trackとする。
6. Working Treeはcheckout中branchのtrackを優先する。同じoidを指す新規branch作成直後でも、commit nodeは増やさずWorking Treeだけをbranch専用laneへ置く。
7. paginationでは最初から取得した先行commitを使い、追加parentを下へappendする。current Git stateの更新時だけ再レイアウトを許可する。

lane claimはvisual trackの補助情報であり、「commitがbranchに所属する」というGitの事実を表さない。branch作成地点やdeleted branch名はreflogに明示的な証拠がない限り表示しない。

## Reflogとoperation

拡張は独自履歴DBを持たない。`ReflogEntry.previousOid`は同一refのselector indexが連続している場合だけ導出する。`Fast-forward`は明示的なmerge/pullまたはoperation-less `Fast-forward` subject、既存ancestor関係、移動先commitがsingle-parentであることのすべてが成立した場合だけ`fast-forward`に分類し、通常commit・checkout・fetch更新・multi-parent mergeなどはイベント化しない。意味のあるイベントも種別とfrom/to OIDが一致するHEAD/local/remote更新を1つの論理イベントへまとめ、refごとの時刻差には依存しない。FF eventには`git rev-list old..new`相当の`commitCount`を保持し、明示的に判別できた`pull`/`merge`だけを`operation`へ保存する。元のreflog subjectは`rawReflogMessage`としてtooltipへ残し、object graphが不完全な場合は件数を推測しない。

`MERGE_HEAD`、`REBASE_HEAD`、`CHERRY_PICK_HEAD`、`REVERT_HEAD`などが現在存在する場合のみoperation nodeを生成する。operation edgeは点線で、commit parent edgeとは混同しない。objectがGC済みのreflog OIDは表示しない。

## Runtime flow

1. `Branch Graph: Open`で最初のworkspace folderをrepository候補にする。
2. `GitClient.readSnapshot`がroot、refs、最新30 commit、各worktree status、operation、reflog、shallow boundaryを読み込む。
3. `buildGraphFacts`がcommit dedup、ref association、working/operation/event nodeを作る。
4. `createGraphLayout`がrow→laneの順に計算し、WebviewへpostMessageする。
5. Webviewはcommit選択時だけdetail/files/statsをon-demand取得し、グラフ専用のスクロール領域を持つ。下端手前で次ページを自動取得し、手動refresh・focus・Git metadata watchでも再読込する。

グラフのSVGレイヤーにはレーン用の左余白を確保し、HTMLのcommit行は最大幅を持つまとまりとしてその右側から開始する。Ref Eventは`anchorCommitId`でdestination commitを参照し、構造DAGのtopological計算からは除外したまま、destinationの直上へ独立したtimeline rowを割り当てる。同じイベントの`targetRef`を`targetLaneId`へ解決して対象branch/refと同じX座標に置き、イベントのためのGraphTrackや横方向の分岐は作らない。annotation edgeは同一lane内の縦コネクタとして描画し、イベントの`from`側をcommit DAGの線として描画しない。同一destinationに複数イベントがある場合は必要な数だけ独立rowを連続して割り当てる。Working Tree / operationは細い点線、commit parentとRef Event annotationは実線で表示する。commit rowのref badgeはcheckout中local branch、その他local、対応remote、その他remote、tag/specialの順にcommit本文の近くへ配置し、tagは形状を変えてbranch laneを作らない。Ref Eventのrowには`REF EVENT`種別ラベルや同一refの重複badgeを表示せず、diamond glyphだけをSVGのbranch lane上へ描画し、`FF · +N commits · operation`形式のイベント文字列は通常commitと同じHTML content columnから開始する。raw reflog、OID、影響ref、日時などの詳細はSVG glyphと行文字列のtooltipへ分離する。edge layerを先に、node layerを後に描画し、nodeの背景マスクで線が記号を横切らないようにする。commitとWorking Treeの`●`/`○`は20pxで揃え、graph areaの幅はbranch lane数だけで決まり、長いevent textでは広がらない。凡例はtoolbarのpopoverから参照できる。

## Security / Accessibility

Gitは`spawn`へ引数配列を渡し、shell文字列連結を行わない。Webviewはnonce付きstrict CSP、限定された`localResourceRoots`、外部scriptなしで生成する。色だけで状態を伝えず、記号・ラベル・線種・ARIA label・keyboard focusを併用する。

## 検証アンカー

- `tests/unit/parsers.test.ts` — NUL形式log/ref/reflog、porcelain status、worktree parser
- `tests/unit/layout.test.ts` — row一意性、timestamp inversion、primary lane、distance-based feature lane、同一laneの独立Ref Event row、縦annotation
- `tests/unit/history-events.test.ts` — FF/reset/amend/rebaseの保守的分類、`old..new`件数、操作名
- `tests/unit/event-presentation.test.ts` — FFラベルの単数/複数、幅別compact表示、content column配置、tooltip情報
- `tests/unit/graph-builder.test.ts` — ref dedup、tag、常時Working Tree、2/3-parent edge、destination/targetRef付きRef Event
- `tests/integration/git-client.test.ts` — 実Git repository fixtureからのbranch/ref/status読み取り、long feature merge、未commitbranch、first commit
