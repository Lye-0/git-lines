# Git Lines

Git Linesは、Gitが保持しているCommit DAGと現在の作業状態を、ブランチの流れが追いやすい安定したレーンで表示する、読み取り専用のVS Code拡張です。

## 通常のGit Graphとの違い

Commitの親子関係を変更せず、`main`が停止してfeatureだけ進んだ場合もfeatureのコミットを別レーンに保ちます。現在のrefs・commit object・reflog・pseudo refs・worktree metadataに存在する情報だけを表示し、過去のブランチ名やsquash/cherry-pickの対応関係を推測しません。

## 表示記号と線

| 記号 | 意味 |
| --- | --- |
| `●` | 現在のrefsから到達できる通常commit |
| `○` | Working Tree、または進行中のGit operation |
| `◌` | reflogから確認でき、objectも残っているreflog-only commit |
| `◇ FF · +N commits · pull` | 明示的なFast-forward subjectとancestor関係の両方で確認できるref event。`+N`は`old..new`で数え、操作が判別できない場合は省略します |

実在commitのparent edgeは実線、Working Tree/operationは点線、Ref Eventの同一lane接続は実線で区別します。通常commit・fetch更新・checkoutなどのルーチンreflogは表示せず、同一操作のHEAD/local/remote更新は1つのイベントへまとめます。画面上のref名は`main`、`origin/main`のように正規化し、色だけに依存せず記号・ラベル・線種も併用します。Ref Eventへマウスを合わせると、移動元・移動先、件数、操作、影響ref、raw reflog、日時を確認できます。

## 使い方

1. `Git Lines: Open`をCommand Paletteから実行します。
2. Reflog表示、`Comfortable / Compact`密度、Refreshをヘッダーから切り替えます。
3. commitを選択すると、hash、parents、author、日時、message、変更ファイルを詳細パネルで確認できます。
4. 初期表示は30 commitです。グラフを下へスクロールすると、残りが少なくなった時点で10 commitずつ自動追加します（`Load more`ボタンからの追加も可能です）。既存の行・レーンはページ追加だけでは不必要に移動しません。

Graphは読み取り専用です。checkout、branch作成、merge、rebase、push、pull、fetch、stashなどGitを変更する操作は提供しません。

## 開発

```bash
pnpm install
pnpm lint
pnpm test
pnpm build
```

Extension Hostのbundleは`dist/extension.js`、Webviewのbundleは`dist/webview`に生成されます。実際のVS Code Extension Development Host起動確認は、VS Codeが利用可能な開発環境で行ってください。

## 設計資料

- [現在のアーキテクチャと不変条件](docs/technical/graph-architecture.md)
