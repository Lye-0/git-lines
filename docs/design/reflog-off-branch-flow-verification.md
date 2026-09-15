# Reflog OFFのブランチ継続・合流（2026-09-15）

基点は7f0a1fb。Reflog表示とFFの証拠解析を分離した。既存の`readBranchProtection`結果をGraphBuilderへ渡し、OFFでは現在の表示対象commitに対して明示的merge-FF候補だけを解析する。既存のold/new一致・完全な線形範囲・一意なsource作成証拠の条件は変更していない。追加のGit読み込みや履歴範囲拡大は行わない。

ONは既存の◇ FF・ラベル・Annotation Row・操作Detailと経路を維持する。OFFは経路だけを維持し、その他のOperation Overlay、過去commit、ghost refは従来どおり非表示とする。現在の実commit・親配列・refs・HEAD・Working Treeを変更しない。

OFFの行配置ではFF nodeを追加せず、行を詰めた最終座標を使う。受け入れ先の列、source tipの半行上に描画専用の接続点を置き、既存の曲線生成で継続・合流・後続main／Working Treeへの経路をつなぐ。接続点はlayout.nodesに含めず、記号・クリック領域・tooltip・Detailを作らない。必要な端点や経路条件が揃わなければ配線しない。StandardとDefault Fixedの配置計算は統合していない。

## 検証結果

- `pnpm check`：54ファイル、472テスト成功。lint・extension/webview build成功。
- 実Gitの独立した一時repoで、cold OFF、ON→OFF一致、OFF→ONの一意な復元、feature削除後の経路とラベル、reflog失効後の経路消失、端点欠落を検証。保存済みfixtureのreflogは変更していない。
- ホストテストでRefreshのキャッシュ破棄・証拠消失、repository切替、非表示イベントを選択できないことを検証。
- 実GraphViewportの描画テストで、OFFの経路が存在し、FF node／ラベル／Annotation Row／経路tooltipがないことを確認。
- 保存入力の400条件を以前の最終layoutと比較。変更は21／22／23／141／142／143のOFF・両モード、12条件のみ。全条件のnodes（commit・OID・parent・ref badgeを含む）、実edges、tracksは一致。
- 113は証拠なしのupdate-refとして不変。20／144／147、145、24、11／12／140、112、114／116、その他OperationのOFFも比較で不変。
- fixtureの既存`verify.ps1`：91/91成功、FAIL 0（再生成なし）。このverifierに含まれない追加defaultシナリオは上記400条件比較とGUIで確認。
- 両repoの`git diff --check`成功。fixtureのrefs／logs／HEAD／index等とtest repoの既存5ファイル、合計1,051ファイルのハッシュ一致。

## GUI

実VS Codeの撮影用Extension Hostで、21／22／23／141／142／143 × Standard／Default Fixed × ON／OFFの24画面を撮影・目視確認した。初回は新規profileのReflog OFFから21 Standardを読み込み、ONキャッシュなしで継続・合流を確認した。

全24画面でmainの継続とfeatureの独立、OFFのマークなし合流、FF行を詰めた余白を確認。142／143は削除済みfeatureの現在ラベルなし。143は合流後のmain commitへ流れが継続する。最終ビルドでは143のFFを選択後、同じパネルをOFFへ切り替え、操作Detailと選択の消失を確認した。遅れて返る別選択のDetail応答も破棄する。

ローカル成果物：`artifacts/reflog-off-flow/gui/index.html`（比較一覧）、同ディレクトリの`images/`（24画面）、`cold-off.jpg`、`toggle-on-selected.jpg`、`toggle-off-cleared.jpg`。元画像を加工していない。

## 文書・既存画像

README.md／README.en.md／README.marketplace.mdのReflog説明・機能表・設定表、package.jsonの既存設定説明、Toolbarのヘルプ、graph-architecture.mdを更新した。以前のFF検証報告には新仕様への参照を追記し、当時の記録を保持。既存のrepository memoryも更新した。

READMEのreflog-off.pngはRebaseの例なので今回のFF仕様との矛盾はない。以前の`artifacts/capture-current-off`／`artifacts/capture-current/index.html`にある対象6ケースのOFF画像は旧仕様であり、現在の説明には新しい比較一覧を使う。古い画像を上書き・加工していない。

変更ファイルはモデル／セッション（graphBuilder、graphViewSession）、レイアウト（branchIntegrationLayout、graphLayout）、描画／選択／ヘルプ（GraphSvg、App、Toolbar）、4テストファイル、README3種、package.json、撮影ツール2ファイル、および上記技術文書・memory。既存変更とfixtureを保持し、開発コミット・push・公開は行っていない。
