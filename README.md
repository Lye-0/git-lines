# Git Lines

VS Code向けの読み取り専用Gitグラフです。ブランチの流れが追いやすいレーンで現在のDAGを示し、Git標準情報から確実に復元できる操作だけを Operation Overlay として重ねます。

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

## Visual Overview

### 現在のDAG

現在の refs から到達できる履歴を、安定したレーンで表示します。

<p align="center">
  <img src="docs/images/readme/main/original.png" alt="通常のブランチDAGとWorking Tree行" width="720">
</p>

### Group rewrite

完了した linear Rebase など、old range 全体と new range 全体の関係が証明できるときは group overlay になります。個別 commit の A→A′ 対応ではありません。

<p align="center">
  <img src="docs/images/readme/main/group.png" alt="RebaseのOLD GROUPからNEW GROUPへのOperation Overlay" width="720">
</p>

### Ref movement

Reset / Branch move は commit の書き換えではなく、ref の位置が動いたことを表します。

<p align="center">
  <img src="docs/images/readme/details/reset.png" alt="Resetによるref移動のOperation Overlay" width="720">
</p>

### N → 1 rewrite

連続した Interactive Squash / Fixup だけ、old range が1 commit へ collapse した overlay を出します。

<p align="center">
  <img src="docs/images/readme/main/n-to-1-rewrite.png" alt="連続SquashまたはFixupのOLD GROUPから1つのNEW commitへのoverlay" width="720">
</p>

## Supported Operations

現在、実装と確認が済んでいるものだけです。

| Operation / State | Support | Visualization |
| --- | --- | --- |
| Amend | ✅ | Commit rewrite |
| Cherry-pick | ✅ | Exact relation / 連続時は visual group |
| Revert | ✅ | Cancellation relation |
| Reset | ✅ | Ref movement |
| Branch move | ✅ | Ref movement |
| Branch rename | ✅ | Rename event（位置は動かない） |
| Rebase | ✅ | Single / group rewrite |
| Interactive Squash / Fixup | ✅ | 安全な連続 N → 1 のみ |
| Detached HEAD | ✅ | 専用の HEAD 状態 |
| Multiple worktrees | ✅ | Commit 上の worktree 注釈 |
| In-progress operations | ✅ | Working Tree 行へ統合 |
| Branch delete / reflog-only | ✅ | Historical / UNREFERENCED |
| ORIG_HEAD | ✅ | 通常の commit / special ref |
| Reflog OFF | ✅ | Current DAG へ縮退 |
| Squash Merge | — | 意図的に推測しない |

## Examples

<details>
<summary><strong>Commit history operations</strong></summary>

Cherry-pick は、commit 本文の `-x` など確実な source があるときだけ relation を描きます。source が連続している複数件は、視認性のための visual group にまとめることがあります。

<p align="center">
  <img src="docs/images/readme/details/cherry-pick.png" alt="Exact Cherry-pickのSOURCEからTARGETへのrelation" width="640">
</p>

Rebase は、完了 session と linear range が復元できるとき single または group rewrite になります。

<p align="center">
  <img src="docs/images/readme/details/rebase.png" alt="完了RebaseのOLDとNEWのgroup overlay" width="640">
</p>

Interactive Squash / Fixup は、同一 rebase session で連続 range が 1 commit へ collapse したことと、`rebase (squash)` / `rebase (fixup)` が証明できる場合だけです。

<p align="center">
  <img src="docs/images/readme/main/n-to-1-rewrite.png" alt="連続SquashのNから1へのrewrite overlay" width="640">
</p>

<p align="center">
  <img src="docs/images/readme/details/fixup.png" alt="連続FixupのOLD GROUPから1つのNEW commit" width="640">
</p>

</details>

<details>
<summary><strong>Ref operations</strong></summary>

Reset と Branch move は commit rewrite ではなく ref の移動です。現在の ref と、必要なら historical な ghost ref を使います。

<p align="center">
  <img src="docs/images/readme/details/reset.png" alt="Resetのref移動overlay" width="640">
</p>

<p align="center">
  <img src="docs/images/readme/details/branch-move-reset.png" alt="Branch moveとResetのref操作" width="640">
</p>

Branch rename は tip の移動ではなく、同じ位置での名前変更です。

<p align="center">
  <img src="docs/images/readme/details/branch-rename.png" alt="Branch renameイベント" width="640">
</p>

</details>

<details>
<summary><strong>In-progress operations</strong></summary>

進行中の merge / cherry-pick / rebase / revert は、独立したグラフノードではなく Working Tree 行に統合します。

<table>
  <tr>
    <td align="center" width="50%">
      <img src="docs/images/readme/details/merge-in-progress.png" alt="Merge途中のWorking Tree表示" width="400"><br>
      Merge
    </td>
    <td align="center" width="50%">
      <img src="docs/images/readme/details/cherry-pick-in-progress.png" alt="Cherry-pick途中のWorking Tree表示" width="400"><br>
      Cherry-pick
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="docs/images/readme/details/rebase-in-progress.png" alt="Rebase途中のWorking Tree表示" width="400"><br>
      Rebase
    </td>
    <td align="center" width="50%">
      <img src="docs/images/readme/details/revert-in-progress.png" alt="Revert途中のWorking Tree表示" width="400"><br>
      Revert
    </td>
  </tr>
</table>

</details>

<details>
<summary><strong>History &amp; Reflog</strong></summary>

Reset / Amend / Rebase などで残った旧経路は PREVIOUS や historical route として示します。到達できないが object が残っている経路は UNREFERENCED になることがあります。

<p align="center">
  <img src="docs/images/readme/main/previous.png" alt="PREVIOUSとhistorical routeの表示" width="640">
</p>

Reflog をオフにすると、overlay・PREVIOUS・reflog 依存の分類を外し、現在の DAG だけへ戻します。commit message から操作を復元しません。

<p align="center">
  <img src="docs/images/readme/main/reflog-off.png" alt="Reflogオフ時のCurrent DAG表示" width="640">
</p>

</details>

<details>
<summary><strong>Special states</strong></summary>

Detached HEAD は branch ref がなくても、いま指している commit を live な現在状態として扱います。

<p align="center">
  <img src="docs/images/readme/details/detached-head.png" alt="Detached HEADのグラフ表示" width="640">
</p>

追加の linked worktree はレーンを増やさず、対象 commit の注釈として示します。

<p align="center">
  <img src="docs/images/readme/details/multiple-worktree.png" alt="複数worktreeのcommit注釈" width="640">
</p>

</details>

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

Operation Detail では操作種別と Evidence に加え、Cherry-pick なら Mappings、Rebase なら Commit order、Squash / Fixup なら Old commits / New commit / Rewrite など、その relation が実際に持っている情報だけを出します。

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

## 使い方

1. Command Palette から `Git Lines: Open` を実行します。
2. ヘッダーで Reflog の表示、`Comfortable / Compact` 密度、Refresh を切り替えます。
3. commit または operation を選ぶと Detail Panel が開きます。
4. 初期表示は 30 commit です。下へスクロールすると残りが少なくなった時点で追加されます（`Load more` も利用できます）。

Marketplace 未公開です。手元では Extension Development Host で開けます。

```powershell
code --extensionDevelopmentPath="<path-to-git-lines>"
```

グラフは読み取り専用です。checkout、branch 作成、merge、rebase、push など Git を変更する操作は提供しません。

## Development

```bash
pnpm install
pnpm lint
pnpm test
pnpm build
```

一括確認は `pnpm check`（lint + test + build）です。Extension Host の bundle は `dist/extension.js`、Webview は `dist/webview` です。watch 用の `pnpm test:watch` と Webview 開発用の `pnpm dev:webview` もあります。

## Settings

| Setting | Default | 内容 |
| --- | --- | --- |
| `branchGraph.showReflog` | `true` | PREVIOUS / overlay など reflog 依存の表示 |
| `branchGraph.density` | `comfortable` | 行密度（`comfortable` / `compact`） |
| `branchGraph.initialCommitCount` | `30` | 最初に読み込む commit 数 |
| `branchGraph.loadMoreCount` | `10` | 追加読み込み件数 |
| `branchGraph.primaryBranch` | `null` | 主レーンにする branch（未指定時は自動） |

## Roadmap

今後の候補です。完了したものだけ Supported Operations へ移します。

- Interactive rebase の追加パターン（drop / reorder など）
- より複雑な merge topology
- remote / ref の境界ケース
- shallow や repository 境界

## Technical Documentation

- [グラフアーキテクチャと不変条件](docs/technical/graph-architecture.md)
)