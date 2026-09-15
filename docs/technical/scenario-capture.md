# シナリオ実画面の自動撮影

`capture-scenarios.mjs` は、隣接する `../test/repos` の既存シナリオをStandard／Default Fixedで表示する開発専用ハーネス。実際の `GraphViewSession` とビルド済みReact Webviewを使用する。通常の拡張ビルドやVSIXには撮影エントリを含めない。

## 準備

```powershell
pnpm build:webview
node scripts/capture-scenarios.mjs prepare artifacts/capture-all --all
```

`--all` は番号で始まるシナリオディレクトリを数値順に列挙する。省略時は01〜03だけ。出力ディレクトリが既にある場合は上書きしない。表示された引数を付けてVS Codeを起動する。

```powershell
code --extensionDevelopmentPath="<run>/extension" --user-data-dir="<run>/profile" --extensions-dir="<run>/extensions" --new-window
```

プロファイルと追加拡張の配置先は実験ディレクトリ内に分離する。対象シナリオのGit履歴は変更しない。VS Codeの初回案内が出た場合は撮影前に閉じる。

条件はCompact、Reflog On、初期件数10000、Dark Modern、ズーム2。固定対象はorigin/HEADがあればそのlocal counterpartまたはremote ref、なければ既存のrefs/heads/mainを指定する。どちらもなければAutoのまま。これは撮影条件であり、本体の自動default検出ルールの変更ではない。対象はcases.jsonと一覧に明記する。setFixedBranchは短名ではなく完全なref名が必要。

## 切り替え・連続撮影

```powershell
node scripts/capture-scenarios.mjs select <run> 0
```

indexはcases.jsonの0始まりの配列位置。同じシナリオのStandard、Default Fixedが順に並ぶ。ファイルのリクエストを介して専用コマンドgitLinesCapture.prepareを呼び、Webviewのrendered通知まで待つ。各ケースでセッションを作り直し、選択やスクロール位置を持ち越さない。

Computer Useのnode_replでskyを初期化し、list_windowsから撮影対象を一意に選択したWindowを用意してから、次を呼ぶ。

```js
const capture = await import('file:///C:/Users/kawau/dev/git-lines/scripts/capture/capture-with-sky.mjs');
await capture.captureCases(sky, returnedWindow, runDirectory, {
  start: 0,
  end: 30,
  resume: true,
});
```

通常のNode CLIで独自の画面取得APIを呼ぶ方式ではない。Computer Useのsky.get_window_stateで取得し、PNG／JPEGの実際のMIMEに合わせて、変換せず保存する。一定件数ごとに呼び出して進捗を確認できる。completeな同一ケースをresumeでスキップする。

撮影用HTMLにのみviewport.jsを追加し、スクロールとサイズ測定を行う。描画コード・CSSは本体と同じ。requestAnimationFrameを2回待ってスクロール完了を通知し、縦横に100 CSS pxの重なりを持たせて全領域を撮影する。追加読み込みが残る場合、描画失敗、ダイアログ、表示対象の不一致、100枚を超える分割では停止する。画像ごとのスクロール位置と画面サイズを保存する。

## 比較一覧

```powershell
node scripts/capture-scenarios.mjs gallery <run>
```

全ケースのメタデータと画像ファイルがそろっていることを確認し、index.htmlとcapture-results.jsonを生成する。左Standard、右Default Fixedで、シナリオ検索・原寸画像リンク・分割位置を表示する。

## 確認結果（2026-09-15）

- 全100シナリオ／200通りを撮影し、208枚を保存。
- 04-many-commitsは縦3枚、92-many-refs-one-commitは横3枚。各モードで分割領域を記録。
- 全ケースで描画完了、追加読み込みなし、表示対象、ダイアログ不在を自動確認。
- 長い履歴の先頭・中間・末尾と横方向の分割、および代表例の実画像を目視確認。
- 撮影結果はグラフの意味的な正しさを保証しない。履歴の解釈や線の正しさは比較一覧で別途レビューする。

初回01〜03の実験は6枚の切り替え・撮影・保存を約5.9秒で実行。初回ハーネスの固定対象が短名mainだった点は全件版で完全名に修正し、01〜03を含めて再撮影した。短名を渡すと本体resolverが固定対象を解決できないため、同じ見た目だけを根拠にFixedが有効だと判断しない。

全件撮影のケース処理時間の合計は約219秒（準備・呼び出し間隔・目視確認を除く）。全208画像の存在・JPEG形式と縦横終端への到達を検査した。CSSズーム下ではscrollWidth-clientWidthと実際の終端に差が出るため、連続撮影処理は大きなスクロール値でブラウザのクランプ位置を実測する。

FF継続修正後の再撮影は、同一のビルドからReflog ON/OFF専用プロファイルを用意し、各100シナリオ×2モード、合計400通り・416画像を保存した。各グラフの描画完了、撮影対象、2194×1186の画像サイズとスクロール終端を確認。比較入口はartifacts/capture-current/index.html。galleryは各プロファイルのshowReflog設定を読み、ON/OFFを正しく表記する。
