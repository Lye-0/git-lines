# Git Lines の公開手順

## 0.1.0 の準備状況

2026-09-12時点で、ローカルのリリース候補VSIXを作成・検証済み。Marketplaceへのアップロード、公開、Git push、タグ作成、GitHub Release作成は行っていない。

**公開前にPublisher IDを確定すること。** 現在の`package.json`とVSIXは`publisher: "git-lines"`を使用しているが、このIDを本人が所有していることは未確認。別のIDを使う場合はmanifestを変更してVSIXを作り直す。Marketplace上の表示名とIDの使用可否は、本人のPublisher管理画面で最終確認する。

| 項目 | 検証結果 |
| --- | --- |
| `pnpm check` | 型検査、367テスト／33ファイル、両bundleのビルドが成功 |
| `pnpm package` | `vscode:prepublish`を含め成功。39ファイル、6,592,934 bytes |
| VSIXの整合性 | ZIPのCRC、実行用JS/CSS・アイコンとビルド元ファイルの一致を確認 |
| 同梱ファイル | runtime、README画像、README、CHANGELOG、LICENSE、第三者ライセンス通知のみ |
| README | ローカル参照29件、accordion 16組、変換後の画像URL27件のHTTP 200とPNG形式を確認。追加したGitHubバッジもHTTP 200・SVG形式とVSIX内のリンクを確認 |
| アイコン | 1254×1254 PNG。四隅のアルファ0をVSIX内でも確認 |
| インストール | 専用のuser-data-dir／extensions-dirで通常インストール成功 |
| GUI | Windows x64・VS Code 1.137.0で確認。開発モードを使用していない |

GUIには112と119のfixtureの一時コピーを使用した。ステータスバーの文字表示と起動先選択、複数repository選択、editor表示、bottom panel表示、112の4-parent merge・PREVIOUS・Amend、Reflog OFF、commit Detail、119のRebase DetailのOld/New orderまでのスクロール、別パネルから戻った際の状態保持を確認した。通常ユーザー所有のコピーへ切り替えた後のGit Linesログに読取エラーはない。

最低対応版のVS Code 1.90、macOS、Linux、Remote Workspaceの実機GUI確認は今回未実施。manifestの最低対応版は既存の`^1.90.0`を維持している。

候補ファイルはrepository rootの`git-lines-0.1.0.vsix`。SHA-256:

```text
b37388e86f2532285ff28e0cbea8057d8a44514f54b1e2fde3714cce99b91ed5
```

再生成するとZIPの日時などによりハッシュが変わるため、アップロード対象のファイルを再確認する。

上記の候補はREADMEのGitHubバッジ・スター用リンク追加後に再生成したもの。再ビルドとZIP整合性・リンクを確認済み。実行用bundleはGUI検証時と同一であり、GUIの再検証は行っていない。

## 本人が公開するとき

1. [MarketplaceのPublisher管理画面](https://marketplace.visualstudio.com/manage)で、使用するPublisher IDを確認する。未作成ならPublisherを作成する。
2. `package.json`の`publisher`を実際のIDに一致させる。初回版の`version`は`0.1.0`。変更した場合は以下の検証・生成をやり直す。
3. リリース対象の変更を確認し、GitHubの`main`へpushする。README画像は公開済みの`main`を参照するため、画像更新時はアップロードより先にpushしてURLを確認する。
4. ローカルで検証してVSIXを生成する。

```powershell
pnpm install --frozen-lockfile
pnpm check
git diff --check
pnpm exec vsce ls --no-dependencies
pnpm package
Get-FileHash -Algorithm SHA256 .\git-lines-0.1.0.vsix
```

5. 生成したVSIXをVS Codeの`Extensions: Install from VSIX...`でインストールし、ステータスバーからeditor／panelを開く。既存の通常環境を保ちたい場合は、専用ディレクトリを指定する。

```powershell
code --user-data-dir "$env:TEMP\git-lines-release-profile" --extensions-dir "$env:TEMP\git-lines-release-extensions" --install-extension .\git-lines-0.1.0.vsix
code --user-data-dir "$env:TEMP\git-lines-release-profile" --extensions-dir "$env:TEMP\git-lines-release-extensions" "<検証用Git repositoryの絶対パス>"
```

6. Publisher管理画面で初回のVS Code拡張作成を選び、確認したVSIXをアップロードして公開する。この操作が公開の最終段階になる。
7. Marketplaceの検証完了後、説明文・画像・アイコンを確認し、Marketplaceからのインストールでも起動を確かめる。必要に応じて同じソースに`v0.1.0`タグとGitHub Releaseを作成する。

手動のVSIXアップロードでは、ローカルにPATを設定する必要はない。CLI公開を選ぶ場合の認証手順は[VS Code公式の公開ドキュメント](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)を確認する。

## 配布設定の保守

- `pnpm package`は公開せずVSIXを生成する。`vscode:prepublish`はビルド用フックであり、これ自体で公開されることはない。
- `--no-dependencies`を使うのは、Extension HostとReact Webviewを事前にbundleするため。新しいruntime依存を追加した場合はbundle・同梱ライセンスを再確認する。
- `.vscodeignore`は許可リスト。新しい画像・CSS・JSなどのruntime assetを追加したら同梱対象も確認する。ソースマップ、テスト、設計原稿、開発資料は同梱しない。
- README内の相対リンクは`repository`と`--githubBranch main`からHTTPS URLに変換する。GitHub repositoryは公開状態を保つ。
- メタデータの意味と対応値は[Extension Manifestの公式資料](https://code.visualstudio.com/api/references/extension-manifest)を参照する。
