# 113の共有先端と経路継続の修正

基準commit: `98cd4e4`。確認日: 2026-09-15。

## 問題と期待

113はcommit-treeでA1→M1→A2を構築してfeature-aを進め、mainも参照だけA2へ移す。作成元が確認できるA1だけをfeature-aへ補正すると、M1/A2がmainに残り経路が分断される。親子edgeが存在するだけでは表示の正しさを検証できなかった。

修正後はA1/M1/A2をfeature-aの表示経路、B1/M2/B2をfeature-bの経路とする。Initial commitはmain、mainのref badgeは実際の参照先A2に保ち、mainのWorking TreeはA2へ接続する。mainの架空のcommitや直結parent edgeは追加しない。M1/A2の作成branchが証明されたと解釈せず、既存経路の継続として扱う。

## 検証

- 全459テストと型検査・ビルドが成功。
- 新規の実Git回帰テストは、通常commitとcommit-tree、2-parentの親順、update-ref、同一tip、main checkoutを113と同様に構成する。
- Standard/Fixed、Reflog ON/OFF、sidebar/compact/comfortableで所属名、同一lane、全8 parent edge、ref badge、Working Tree endpoint、再描画の安定を検証。
- Reflog ON/OFFの両方で2→4→8→16件の読込を行い、先に見えていたcommitのrow/lane/trackが変わらないこと、metadata読込がsnapshotや表示件数を増やさないことを確認。
- 参照更新前OIDの欠落、anchor/親の未読、作成証拠の欠落・競合、他branchでの作成、mainでの通常merge、循環、shared tipでない場合を単体検証。
- Working Tree線が中間の兄弟branch nodeのselection ringに接触しないことを3表示寸法で確認。
- 実113を含む重点180条件、保存済み92履歴の1,104条件を基準版と比較。変更された既存履歴は113のみ。親子edge・操作relation・注釈行・rowに差異なし。親子線の新たなnode/ring接触なし（curve segmentを120分割する比較）。
- test本体、入れ子、148、実113の40段階のpagination比較で新たな既表示commitの位置・所属変更なし。
- 隔離したVS CodeのエディタでStandardとmain明示指定のFixedを切替確認。Fixedの下部パネル・左サイドバーでもA1/M1/A2がfeature-aの同じ経路として描かれることを目視し、各viewのaccessibility上の経路名も照合。M1のsidebar詳細でもBranch / Route = feature-aを確認。

広域比較は保存済みsnapshotを使い、重点履歴は一時repoおよび現行の113/148を読む。既存test repoのGit履歴は編集していない。

## 読込範囲

ページ外のanchorが根拠である場合、表示ページのcommitだけでは所属が追加読込まで確定しない。既存snapshotに加え、最大64個の不足commit objectを1つのlazy batch readerで読み、候補ごとの追跡を256 stepで制限する。直接作成元が分かる先端では追跡しない。得られた情報はrouteEvidenceCommitsだけに渡し、graph nodeを追加しない。上限・欠落・証拠競合により区間を確認できない場合は継続を断定しない。

## 再実行

```powershell
pnpm check
node research/lineage/verify.mjs --production --baseline=98cd4e4
```

広域比較には前回のsnapshotキャッシュが必要。集計は`research/lineage/shared-tip-summary.json`、詳細はGit管理外の`research/lineage/implementation-results.json`。
