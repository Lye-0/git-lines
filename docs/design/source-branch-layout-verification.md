# 分岐元を維持する配置方針の検証

検証日: 2026-09-15。現行基準: `22ccb2ff8b7885f262427c8924b7f1e35cdd9fe5`。
これは未採用の試作の検証記録。製品の`src/`、通常ビルド、既存の`test`リポジトリの履歴は変更していない。

## 判断

証拠から分岐元を識別できる範囲では、要求された左右関係と既存のブランチ独立性を共存させられる見込みを、実Gitの履歴と試作コードで確認した。ただし、任意のGit履歴から分岐元名を常に復元できるという結論ではない。

148は正当なモード差の例ではなかった。現行版ではローカルmainの欠如によりfeatureが基準となり、D0もfeatureへ割り当てられる。試作ではremote defaultを基準候補に含め、両モードともD0/D1/D2をmain、F1/F2をfeatureの独立列に保持する。

Standardの原則は「未マージ、または元←新なら元が左、新が右」。元→新は元の左側維持を必須としない。今回の試作は元→新のときに必ず反転させるものではなく、取り込み先で作成したmerge commitの所属と、FFで移動したrefを区別する。

## 試作の構成

- `research/lineage/prototype.mjs`: remote defaultの基準選択、証拠に基づく親子関係、所属補正、segmentの左右制約。テスト時だけsource transformで適用。
- 作成元のbranch reflogに`Created from <branch>`がある場合はそれを利用。`HEAD`の場合は同一OID・時刻のcheckoutと組み合わせ、候補が複数なら関係を確定しない。
- 循環する名前関係や、同じ子の複数の親候補は採用しない。
- 通常のmerge作成記録をFFによるref移動と分けて扱う。親子関係が確認できる範囲で、共有された根元と各branch自身のcommitを識別する。
- segmentの親を先に配置する。ただし既にlane 0が確定する基準trackを待つためだけに、他のsegmentの順序を変えない。
- 既存の途中refによる第1親追跡停止条件は撤廃していない。

試作は製品へそのまま取り込むための型付き実装ではない。正式実装ではmetadataの型・責務、branch再作成やrenameの扱い、保守性を整理する必要がある。

## 検証結果

| 検証 | 結果 |
|---|---|
| 既存テストに試作を適用 | 437/437成功。期待値の書換えなし |
| 実Gitによる重点履歴 | 14種類×Reflog ON/OFF×3表示寸法×2モード = 168ケース成功 |
| 既存snapshot比較 | 92履歴×同12条件 = 1,104ケース |
| 親子edge、操作relation、注釈行、node行順 | 差異0 |
| 新たな親子線と非端点node/選択ringの接触 | 検出0（変化したlayoutのみ、curve segmentを120分割して比較） |
| 段階読込 | test本体、入れ子、148の3履歴×2モード×2/4/8/16/50件 = 30段階。既表示commitの行・lane・track移動0 |
| 証拠消失・曖昧さ・循環など | 18チェック成功 |

重点履歴は、コミット前のcheckout、未マージ、FF、FF後の参照削除、main再開、default以外の親からの分岐、入れ子でのコミット前、親の開発再開、子→親のmerge、main→featureのmerge、その後mainがFFするケース、main/masterのないroot、スラッシュを含むbranch名、実際の148。

重点履歴は今回作成した一時repoと現在の148を使用。広域比較は2026-09-14に取得済みの92snapshotを現在の現行版・試作版の両方へ渡したもの。全92repoを今回再取得した結果とは区別する。

## 変化する既存表示

| 履歴 | 変化 |
|---|---|
| 14-nested-branches | 親feature-aが左、子feature-bが右へ。commitのtrack識別は維持 |
| 28-multiple-merges | 親feature-bと子feature-cの左右を補正。track識別は維持 |
| 113-criss-cross-merge | 1 nodeのlane/trackに差異。複雑な相互mergeは採用時の目視比較対象 |
| 21-fast-forward-merge / 23-fast-forward-multiple | nodeのlane/track、描画pathは同一。内部track区間情報のみ差異 |

初回試作では134 Reword / 135 Editの現行featureと過去経路の左右も入れ替わった。これは要求に不要な変化だったため、基準trackの配置待ちで順序が変わる問題を調整した。最終試作では134/135は現行版と一致する。

したがって最終試作は、92履歴中3履歴で実際のnode/pathに変化、2履歴で内部metadataのみ変化。残り87履歴はlayout出力が一致した。「全ての見た目が完全に同じ」という主張はしない。

## Gitの証拠だけでは区別できない実例

同じcommitを指すmainとsiblingがあり、全操作が同一秒内に行われた場合:

1. main上で `git branch child HEAD` を実行してからsiblingへcheckoutし、その後childへcheckoutする。
2. siblingへcheckoutしてから `git branch child HEAD` を実行し、その後childへcheckoutする。

この2つの一時repoで、ref一覧と解析済み全reflogが完全一致することを確認した。実行時に意図した分岐元はそれぞれmain/siblingだが、branch作成はHEAD reflogに独立した順序付き操作として残らない。このため同時刻・同OIDの相関だけで親名を確定してはいけない。試作はこの場合の親子制約を追加しない。

なお `git branch child` のようにstart-pointを省略した場合は、今回のGitでは`Created from main`など具体名が記録された。上の曖昧性の実例は、start-pointを`HEAD`と明示したケースである。

## 処理時間と未検証範囲

保存済みの同一入力でStandard layoutを40回実行し、最初の10回を除いた30回の中央値（ms）:

| 入力 | commit数 | 現行 | 試作 |
|---|---:|---:|---:|
| test本体 | 43 | 1.35 | 1.37 |
| kitchen-sink | 10 | 0.23 | 0.27 |
| nested | 6 | 0.07 | 0.10 |

これは小規模なメモリ内配置処理の測定。Git読込、巨大reflog、巨大repo、通信、Webview描画時間を含まず、初回起動性能の保証ではない。

ネイティブVS Codeでの試作GUI、操作ラベル同士の重なり、全てのrename/recreate/worktreeの組合せ、任意の循環するbranch史の意味付けは網羅していない。curve samplingも数学的全点保証ではない。正式採用前には3件の表示変化と148を実機で比較する必要がある。

## 再実行

Git Linesのルートから:

```powershell
pnpm exec vitest run --config research/lineage/vitest.config.mjs
node research/lineage/verify.mjs "<92 snapshotを保存したディレクトリ>"
```

snapshot引数を省略すると、前回調査のTEMP内pointer fileを使用する。重点履歴は毎回TEMP内へ新規生成する。詳細結果は`research/lineage/results.json`（Git管理対象外）。検証時点の集計は`research/lineage/summary.json`。既存test repoは読取専用。
