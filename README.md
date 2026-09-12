# Git Lines

[![Star on GitHub ⭐](https://img.shields.io/badge/Star_on_GitHub_%E2%AD%90-111820?style=for-the-badge&logo=github&logoColor=2DCDF0)](https://github.com/Lye-0/git-lines)

VS Code向けの読み取り専用Gitグラフです。現在のDAGを安定したレーンで示し、Git標準情報から確実に復元できる操作だけを Operation Overlay として重ねます。

<p align="center">
  <img src="docs/images/readme/main/hero.png" alt="Git Linesのメイングラフ。安定したレーン上のブランチ履歴とWorking Tree" width="860">
</p>

推測で履歴を補完しません。証拠が足りない操作は描かず、現在のDAGだけを残します。

## What is Git Lines?

Git Linesは、commit object の親子関係（DAG）と、いまの Working Tree を同じタイムラインに載せます。レーンは表示用の配置であり、parent edge を付け替えません。

Amend・Cherry-pick・Rebase などの操作は、reflog や commit 本文など **いま残っている Git 標準情報** で証明できるときだけ、DAG とは別層の overlay として表示します。似たメッセージや tree から source を当てません。

## Features

- ブランチの流れが崩れにくい Git graph
- Working Tree と進行中 operation の統合
- 証拠がある操作だけの Operation Overlay
- Reflog 由来の PREVIOUS / 履歴ルート
- Commit / Operation の Detail Panel
- Detached HEAD と複数 worktree の付随表示
- 読み取り専用（checkout / merge / rebase などは実行しない）

### Display options

ステータスバーの **Git Lines** から、メイン画面・下部パネル・左サイドバーを選べます。左サイドバーはレーン間隔を狭め、コミットの点に沿った1行表示にしています。変更量などの詳細はクリックで開く吹き出しに表示し、外側クリックまたはEscで閉じられます。

メイン画面・下部パネルの初期Densityは **Compact** です。履歴の読み込み・追加取得を高速化し、長距離の接続線や列位置も見やすく調整しました。

## Visual Overview

Git Lines全体の見え方です。個別のGit操作の意味は、後ろの各 accordion で説明します。

### Current DAG

現在の refs から到達できるDAGと Working Tree を表示します。

<p align="center">
  <img src="docs/images/readme/main/original.png" alt="現在のrefsから到達できるDAGとWorking Tree" width="720">
</p>

### Historical context

Reflog が有効なら、PREVIOUS、historical route、reflog-only の履歴を補助表示できます。

<p align="center">
  <img src="docs/images/readme/main/previous.png" alt="PREVIOUSとhistorical routeの補助表示" width="720">
</p>

### Grouped visualization

複数の関連 commit が安全に特定できる場合、視認性のために group としてまとめることがあります。個別の semantic は各操作の accordion を見てください。

<p align="center">
  <img src="docs/images/readme/main/group.png" alt="関連commitをまとめたgroup可視化の例" width="720">
</p>

### N → 1 rewrite

複数 commit が 1 commit へ collapse したことが安全に証明できるとき、専用 overlay で示します。Interactive Squash / Fixup が代表例です。

<p align="center">
  <img src="docs/images/readme/main/n-to-1-rewrite.png" alt="複数commitが1commitへcollapseしたrewrite overlay" width="720">
</p>

### In-progress integration

進行中の Git 操作は、独立した偽の commit ではなく Working Tree 行へ統合します。

<p align="center">
  <img src="docs/images/readme/main/in-progress.png" alt="進行中操作をWorking Tree行へ統合した表示" width="720">
</p>

### Reflog OFF

Reflog をオフにすると overlay、PREVIOUS、reflog 依存の分類を外し、Current DAG だけへ戻します。commit message から操作を復元しません。

<p align="center">
  <img src="docs/images/readme/main/reflog-off.png" alt="Reflogオフ時のCurrent DAG表示" width="720">
</p>

Reset / Branch move など ref の移動は、下の各操作 accordion で具体例を見られます。

## Detail Panel

グラフ上の commit と operation は、どちらも Detail で根拠まで確認できます。

<table>
  <tr>
    <td align="center" width="50%">
      <img src="docs/images/readme/main/detail-commit.png" alt="Commit Detail。変更量、ファイル、author、parent" width="400"><br>
      Commit
    </td>
    <td align="center" width="50%">
      <img src="docs/images/readme/main/detail-operation.png" alt="Operation Detail。Evidenceとrewrite情報" width="400"><br>
      Operation
    </td>
  </tr>
</table>

Commit Detail では additions / deletions、changed files、author、parent、branch / route を見られます。

Operation Detail では操作種別と Evidence に加え、Cherry-pick なら Mappings、Rebase なら独立した Old order / New order、Squash / Fixup なら Old commits / New commit / Rewrite など、その relation が実際に持っている情報だけを出します。

## Evidence-first Design

```text
Reliable evidence     → Dedicated Operation Overlay
Partial / ambiguous   → Safe fallback（generic event または Current DAG）
No reliable evidence  → Current DAG only
```

Git Lines は、commit の類似度や「こうなったはず」という推測だけでは歴史操作を描きません。証明できる範囲だけを overlay にし、それ以外はいまの DAG を優先します。

<details>
<summary><strong>Intentionally not inferred</strong></summary>

次のものは、Git 標準情報から Exact に証明できないため **未実装ではなく意図的に推測しません**。

- 完了した Squash Merge の source / range（最終 commit は通常の 1-parent に見える）
- 非連続な Interactive Squash / Fixup の member 集合
- `-x` などの確実な source が無い Cherry-pick

検出条件や研究メモは [グラフアーキテクチャ](docs/technical/graph-architecture.md) を参照してください。

</details>

## Supported Operations

現在、実装と確認が済んでいるものだけです。

✅ は、専用 overlay の有無によらず、Evidence-first 方針に基づく扱いが確定・実装済みであることを示します。

| Operation / State | Support | Visualization |
| --- | --- | --- |
| Amend | ✅ | Commit rewrite |
| Cherry-pick | ✅ | Exact relation / 連続時は visual group |
| Revert | ✅ | Cancellation relation |
| Reset | ✅ | Ref movement |
| Branch move | ✅ | Ref movement |
| Branch rename | ✅ | Rename event（位置は動かない） |
| Rebase | ✅ | Single / group rewrite |
| Reorder | ✅ | Group Rebase として扱う。Reorder 自体は推測しない |
| Drop | ✅ | Generic Rebase fallback |
| Reword | ✅ | Generic Rebase + Exact local Reword |
| Edit | ✅ | Generic Rebase + 実際に観測された operation |
| Interactive Squash / Fixup | ✅ | 安全な連続 N → 1 のみ |
| Detached HEAD | ✅ | 専用の HEAD 状態 |
| Multiple worktrees | ✅ | Commit 上の worktree 注釈 |
| In-progress operations | ✅ | Working Tree 行へ統合 |
| Branch delete / reflog-only | ✅ | Historical / UNREFERENCED |
| ORIG_HEAD | ✅ | 通常の commit / special ref |
| Reflog OFF | ✅ | Current DAG へ縮退 |

## Supported DAG Topologies

Git Lines は Operation Overlay とは別に、Git object の実際の parent 関係をそのまま DAG として描画します。特殊な topology でも、架空の edge や operation は追加しません。

| Topology | Support | Visualization |
| --- | --- | --- |
| Normal branch / merge | ✅ | 通常の DAG |
| Octopus merge | ✅ | 3つ以上の parent edge |
| Criss-cross merge | ✅ | 交差する merge DAG |
| Multiple roots | ✅ | 独立 root を別々に表示 |
| Unrelated histories merge | ✅ | merge commit で初めて履歴を接続 |
| Orphan branch | ✅ | 独立 root を持つ通常 branch として表示 |

これらには専用 Operation Overlay を追加せず、実際の parent relation そのものを描画します。

## Git Operations

<details>
<summary><strong>Cherry-pick</strong></summary>

source を Git 標準情報から確実に追跡できる場合だけ、source → created commit の relation を表示します。連続した Exact relation は、視認性のため visual group にまとめることがあります。

<p align="center">
  <img src="docs/images/readme/details/cherry-pick.png" alt="完了Cherry-pickのSOURCEからTARGETへのrelation" width="640">
</p>

#### In progress

進行中の Cherry-pick は Working Tree 行へ統合します。

<p align="center">
  <img src="docs/images/readme/details/cherry-pick-in-progress.png" alt="進行中Cherry-pickのWorking Tree表示" width="640">
</p>

</details>

<details>
<summary><strong>Rebase</strong></summary>

完了 session と linear な old / new range を安全に復元できる場合、single または group rewrite として表示します。

Reorder は completed evidence だけでは通常 Rebase と区別できないため専用表示せず、Group Rebase として扱います。個別 commit の mapping や順序維持は主張しません。Drop は dropped member を Exact に特定できないため、Generic Rebase へ fallback します。

Reword は完了 session 内で reflog が直接証明する局所 rewrite だけを Reword relation として表示し、Generic Rebase と併記します。Edit 自体には専用 relation を作らず、実際に観測された Amend 等を Generic Rebase と併記します。

#### Completed

<p align="center">
  <img src="docs/images/readme/details/rebase.png" alt="完了RebaseのOLDとNEWのgroup overlay" width="640">
</p>

#### Reword

画像は、rebase session 内の UNREFERENCED な一時 commit T → B reworded（B′）を reflog が直接証明する Exact local Reword relation です。元の pre-rebase commit B との個別 mapping は推測しません。

<p align="center">
  <img src="docs/images/readme/details/reword.png" alt="Rebase内部の一時commitからreword後commitへのExact Reword relation" width="640">
</p>

#### In progress

進行中の Rebase は Working Tree 行へ統合します。

<p align="center">
  <img src="docs/images/readme/details/rebase-in-progress.png" alt="進行中RebaseのWorking Tree表示" width="640">
</p>

</details>

<details>
<summary><strong>Squash / Fixup</strong></summary>

Interactive Rebase で、連続した old range が 1 commit へ collapse したことと、`rebase (squash)` / `rebase (fixup)` を安全に証明できる場合だけ専用表示します。Squash の見た目は上の N → 1 rewrite と同じです。

<p align="center">
  <img src="docs/images/readme/details/fixup.png" alt="連続FixupのOLD GROUPから1つのNEW commit" width="640">
</p>

</details>

<details>
<summary><strong>Reset</strong></summary>

Reset は commit rewrite ではなく、ref の位置が動いたこととして表示します。現在の ref と、必要なら historical な ghost ref を使います。

<p align="center">
  <img src="docs/images/readme/details/reset.png" alt="Resetのref移動overlay" width="640">
</p>

</details>

<details>
<summary><strong>Branch move</strong></summary>

branch ref の tip 移動は、Reset と同じ Ref Movement の見た目を使います。次の画像は Reset と Branch move が連続した例です。

<p align="center">
  <img src="docs/images/readme/details/branch-move-reset.png" alt="ResetとBranch moveが連続したref操作の例" width="640">
</p>

</details>

<details>
<summary><strong>Branch rename</strong></summary>

tip の位置は動かず、ref 名だけが変わった event として表示します。

<p align="center">
  <img src="docs/images/readme/details/branch-rename.png" alt="Branch renameイベント" width="640">
</p>

</details>

<details>
<summary><strong>Revert</strong></summary>

完了した Revert は、target の打ち消し関係として created revert commit を結ぶことがあります。target 側には専用 marker を付けます。完了専用のスクリーンショットは、現時点では README にありません。

#### In progress

進行中の Revert は Working Tree 行へ統合します。

<p align="center">
  <img src="docs/images/readme/details/revert-in-progress.png" alt="進行中RevertのWorking Tree表示" width="640">
</p>

</details>

<details>
<summary><strong>Merge in progress</strong></summary>

完了した通常 Merge、Octopus merge、Unrelated histories merge は、いずれも専用 Operation Overlay を追加せず、Current DAG の実際の parent relation として表示します。進行中の Merge は Working Tree 行へ統合します。

<p align="center">
  <img src="docs/images/readme/details/merge-in-progress.png" alt="進行中MergeのWorking Tree表示" width="640">
</p>

</details>

## Special Git States

<details>
<summary><strong>Detached HEAD</strong></summary>

branch ref がなくても、HEAD がいま指している commit は live な現在状態として扱います。

<p align="center">
  <img src="docs/images/readme/details/detached-head.png" alt="Detached HEADのグラフ表示" width="640">
</p>

</details>

<details>
<summary><strong>Multiple Worktrees</strong></summary>

linked worktree のために新しい graph lane は作りません。対象 commit 上の注釈として表示します。

<p align="center">
  <img src="docs/images/readme/details/multiple-worktree.png" alt="複数worktreeのcommit注釈" width="640">
</p>

</details>

## DAG Topologies

<details>
<summary><strong>Octopus merge</strong></summary>

3つ以上の parent を持つ merge commit でも、全 parent edge を実際の parent relation に従って描画します。

<p align="center">
  <img src="docs/images/readme/details/octopus-merge.png" alt="Octopus mergeで複数のparent edgeが1つのmerge commitへ接続するGit Lines表示" width="640">
</p>

</details>

<details>
<summary><strong>Criss-cross merge</strong></summary>

互いを merge したことで交差する DAG でも、parent relation と branch lane を維持します。

<p align="center">
  <img src="docs/images/readme/details/criss-cross-merge.png" alt="Criss-cross mergeの交差するDAGとbranch lane" width="640">
</p>

</details>

<details>
<summary><strong>Multiple roots</strong></summary>

共通祖先を持たない複数の root を、存在しない edge でつながず独立して表示します。

<p align="center">
  <img src="docs/images/readme/details/multiple-roots.png" alt="共通祖先を持たない複数のrootを独立して表示したDAG" width="640">
</p>

</details>

<details>
<summary><strong>Unrelated histories merge</strong></summary>

独立していた2つの history は、実際の merge commit で初めて接続されます。専用の Unrelated operation overlay は作りません。

<p align="center">
  <img src="docs/images/readme/details/unrelated-histories-merge.png" alt="独立した2つの履歴が実際のmerge commitで接続されたDAG" width="640">
</p>

</details>

<details>
<summary><strong>Orphan branch</strong></summary>

orphan branch は、既存履歴とは独立した root を持つ通常 branch として表示します。

<p align="center">
  <img src="docs/images/readme/details/orphan-branch.png" alt="既存履歴とは独立したrootを持つorphan branchのDAG" width="640">
</p>

</details>

## 使い方

VS Code 1.90以降と、PATHから実行できるGitが必要です。Git repositoryのfolderを開き、Workspace Trustを有効にして利用します。Remote Workspaceでは、その接続先にGitが必要です。仮想workspace（Git CLIで読めるファイルがない環境）は対象外です。

1. ステータスバーの `Git Lines`、または Command Palette の `Git Lines: Open` から、`Open in Editor`（メイン画面）／`Open in Panel`（下部パネル）／`Open in Sidebar`（左サイドバー）を選びます。複数folderを開いている場合は続けてrepositoryを選びます。
2. ヘッダーで Reflog の表示やRefreshを操作します。メイン画面・下部パネルでは `Compact / Comfortable` 密度も選べます。
3. commit または operation を選ぶと詳細が開きます（左サイドバーでは吹き出し表示）。
4. 初期表示は 30 commit です。下へスクロールすると残りが少なくなった時点で追加されます（`Load more` も利用できます）。

VSIXからインストールする場合は、Command Paletteの `Extensions: Install from VSIX...` で `releases/git-lines-1.0.0.vsix` を選びます。

下部パネルでは「ターミナル」「出力」などと並ぶ `Git Lines` タブ、左サイドバーではアクティビティバーの専用アイコンから表示します。どの表示先でも同じグラフ・Reflog・詳細情報を利用できます。Command Paletteの `Git Lines: Open in Editor` / `Git Lines: Open in Panel` / `Git Lines: Open in Sidebar` から表示先を直接指定することもできます。

グラフは読み取り専用です。checkout、branch 作成、merge、rebase、push など Git を変更する操作は提供しません。

## Development

```bash
pnpm install
pnpm lint
pnpm test
pnpm build
```

一括確認は `pnpm check`（lint + test + build）です。Extension Host の bundle は `dist/extension.js`、Webview は `dist/webview` です。watch 用の `pnpm test:watch` と Webview 開発用の `pnpm dev:webview` もあります。

ビルド後、開発用のVS Codeウィンドウを起動できます。

```powershell
code --extensionDevelopmentPath="<path-to-git-lines>" "<path-to-repository>"
```

`pnpm package` はビルドを実行し、`releases/git-lines-<version>.vsix` を生成します。バージョンごとにファイルを残せます（同じバージョンの再生成は上書き）。公開処理は行いません。

## Settings

| Setting | Default | 内容 |
| --- | --- | --- |
| `branchGraph.showReflog` | `true` | PREVIOUS / overlay など reflog 依存の表示 |
| `branchGraph.density` | `compact` | 行密度（`comfortable` / `compact`） |
| `branchGraph.initialCommitCount` | `30` | 最初に読み込む commit 数 |
| `branchGraph.loadMoreCount` | `10` | 追加読み込み件数 |
| `branchGraph.primaryBranch` | `null` | 主レーンにする branch（未指定時は自動） |

## Roadmap

主要な local Git operation と特殊 DAG topology への対応は一旦完了しています。

今後の候補:

- remote / ref の境界ケース
- shallow clone
- reflog の期限切れ / 欠落
- repository / history 境界の追加検証

## Technical Documentation

- [グラフアーキテクチャと不変条件](docs/technical/graph-architecture.md)
