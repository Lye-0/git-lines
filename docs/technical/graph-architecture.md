# Git Lines グラフアーキテクチャ

## 目的と境界

Git Linesは、VS Code Extension HostでGit CLIを読み取り、Gitの事実モデルと表示用のレイアウトモデルを分離してWebviewへ渡す。初回版はDesktop / Remote Workspace向けの読み取り専用拡張であり、Gitの状態を変更するコマンドは実行しない。

## 現在の構成

- `src/git/` — 引数配列でGit CLIを実行し、log・refs・status・reflog・worktree・pseudo refsを機械可読形式からパースする。
- `src/repository/` — repository root / git dir / common git dirを検出し、Git metadataをbest-effortで監視する。
- `src/model/` — `GraphFactModel`を構成する。ここではcommitのparent、ref、reflog、operationなどGitの事実を保持し、laneやpixel座標を事実として扱わない。
- `src/layout/` — row、lane、edge routingを決定する。決定論的topological date-order、primary branchのlane 0、append時の既存座標維持を担当する。
- `src/webview/` — CSP nonce付きHTML、message protocol、VS Code panelのライフサイクルを担当する。
- `webview/src/` — React UI。SVGをedge/node layer、HTMLをsubject/badge/detail layerとして使い、dark/high-contrast tokenとkeyboard focusを維持する。

## データと状態モデル

`GitCommit`の`oid`と`parentOids`が唯一のcommit identityである。複数refが同じoidを指す場合もcommit nodeは1つにまとめ、ref badgeを複数付ける。tagとsymbolic remote HEADはlaneを作らない。

`GraphNode`の種類は次のとおり。

- `commit` — current refsから読み込んだ実在commit
- `reflog-commit` — current refsのvisible set外だが、reflogから確認でき、objectが残っているcommit
- `working-tree` / `operation` — commit objectではない現在状態
- `fast-forward-event` / `history-event` — reflogから確認できるref移動の補助表現
- `history-boundary` — paginationまたはshallow cloneで未読parentを示すstub

実在のparent関係は`GraphEdge.type = "parent"`で表す。Working Tree、未完了operation、ref移動はそれぞれ`working-tree`、`operation`、`history-event`で分離する。patchが似ているだけのsquash/cherry-pick/rebase前後をparent edgeへ変換しない。

## Rowとlaneの不変条件

1. rowは全可視nodeで一意である。
2. parent nodeはchildより下に置く。timestamp逆転があってもDAG制約を優先する。
3. ready queueのcommitter date、kind、stable idを用いて同じ入力から同じ順序を得る。
4. primary branchはlane 0を基本とし、feature-only ancestryは別laneへ置く。
5. local/remoteの同一familyは同系色、同一oidなら同一track、divergedなら隣接する別trackとする。
6. paginationでは最初から取得した先行commitを使い、追加parentを下へappendする。current Git stateの更新時だけ再レイアウトを許可する。

lane claimはvisual trackの補助情報であり、「commitがbranchに所属する」というGitの事実を表さない。branch作成地点やdeleted branch名はreflogに明示的な証拠がない限り表示しない。

## Reflogとoperation

拡張は独自履歴DBを持たない。`ReflogEntry.previousOid`は同一refのselector indexが連続している場合だけ導出する。`Fast-forward`はreflog subjectの明示情報とancestor関係の両方が成立した場合だけ`fast-forward`に分類し、それ以外はgeneric ref moveなど保守的な分類にする。

`MERGE_HEAD`、`REBASE_HEAD`、`CHERRY_PICK_HEAD`、`REVERT_HEAD`などが現在存在する場合のみoperation nodeを生成する。operation edgeは点線で、commit parent edgeとは混同しない。objectがGC済みのreflog OIDは表示しない。

## Runtime flow

1. `Branch Graph: Open`で最初のworkspace folderをrepository候補にする。
2. `GitClient.readSnapshot`がroot、refs、最新30 commit、各worktree status、operation、reflog、shallow boundaryを読み込む。
3. `buildGraphFacts`がcommit dedup、ref association、working/operation/event nodeを作る。
4. `createGraphLayout`がrow→laneの順に計算し、WebviewへpostMessageする。
5. Webviewはcommit選択時だけdetail/files/statsをon-demand取得し、グラフ専用のスクロール領域を持つ。下端手前で次ページを自動取得し、手動refresh・focus・Git metadata watchでも再読込する。

グラフのSVGレイヤーにはレーン用の左余白を確保し、HTMLのcommit行はその右側から開始する。reflogのref移動イベントは接続先commitのレーンに寄せ、通常のparent edgeと重ならない細いオフセット破線として描画する。同一レーン内でparent edgeを重複するイベントの`from`線は省略し、レーンをまたぐ移動だけを残す。

## Security / Accessibility

Gitは`spawn`へ引数配列を渡し、shell文字列連結を行わない。Webviewはnonce付きstrict CSP、限定された`localResourceRoots`、外部scriptなしで生成する。色だけで状態を伝えず、記号・ラベル・線種・ARIA label・keyboard focusを併用する。

## 検証アンカー

- `tests/unit/parsers.test.ts` — NUL形式log/ref/reflog、porcelain status、worktree parser
- `tests/unit/layout.test.ts` — row一意性、timestamp inversion、primary lane、local/remote family
- `tests/unit/history-events.test.ts` — FF/reset/amend/rebaseの保守的分類
- `tests/unit/graph-builder.test.ts` — ref dedup、tag、常時Working Tree
- `tests/integration/git-client.test.ts` — 実Git repository fixtureからのbranch/ref/status読み取り
