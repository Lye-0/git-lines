# 表示設定とdefault列固定モードの実装計画

状態: 実装時の設計計画。現在の実装契約は`../technical/graph-architecture.md`と`../technical/history-performance.md`を参照。以下の検証項目は計画であり、すべての環境での実施済み保証ではない。
基準日: 2026-09-14。
写真の確認対象: `C:\Users\kawau\dev\test`。このrepositoryと配下fixtureは読み取り専用で扱う。

## 1. 最優先の契約

固定モードでも、識別できる他ブランチの履歴とWorking Treeはdefaultの列へ入れない。色や名前を残すだけでなく、物理的な列の独立性を維持する。

特に次の2ケースを必須の受け入れ条件とする。

1. mainからfeatureへ切り替え、まだcommitを作成していない。共有元commitを複製せず、featureのWorking Treeを独立した列へ配置する。
2. mainを進めずfeatureで1件以上commitし、mainへ取り込む。fast-forwardでも、証拠で識別できるfeatureのcommit列を独立して残す。mainのrefがfeatureの先端へ移動したことを、commit列の所属変更として扱わない。

固定対象はdefault自身として確認できる履歴区間と、その表示列である。現在のdefault refが指すnodeを必ずlane 0へ動かす契約ではない。共有tipのnodeがfeatureの履歴ならfeatureの列に保持し、そのnodeを指すmainのrefも正確に表示する。この区別が、default列固定と絶対条件の両立に必要となる。

優先順位は、実Gitの正確性 → branch履歴の列の独立性 → default列の固定 → 既存配置の維持 → 省スペース、とする。

## 2. 表示の具体例

| Git状態 | main/default側 | feature側 |
| --- | --- | --- |
| mainのみ | 確認できるmain履歴を左端 | なし |
| featureへswitch、commitなし | 共有元commitの位置を維持 | Working Treeを側方へ。実HEADへの点線は維持 |
| featureでF1/F2を作成、mainは元のまま | mainの履歴は左端 | F1/F2とfeatureのWorking Treeは独立列 |
| mainへFF取り込み | mainの参照はF2を指す。main上で未作成のcommitを作らない | 証明されたF1/F2を側方に保持 |
| FF後にmainでM1を作成 | M1は左端。実parentであるF2へ接続 | F1/F2は側方に保持 |
| mainへno-ff merge | mainで作成したmerge nodeは左端 | mergeの側親とfeature履歴は独立列 |
| mainをfeatureへmerge | default自身の識別済み履歴を左端 | featureのmerge nodeと履歴はfeature列 |
| featureを削除し必要なreflogが残る | 削除を理由にfeature履歴をmainへ吸収しない | 証明された履歴区間を保持。branch名は証拠がある範囲だけ表示 |

共有commitは1 nodeのまま扱う。固定列に架空のnodeやparent edgeを追加しない。mainのWorking Treeはmain列へ置き、実際のHEADが側方の共有tipならそのnodeへ点線で接続する。

## 3. 写真のtest repositoryで期待すること

ローカルの`origin/HEAD`は`origin/main`を指している。現在のmainからInitial commitまで到達できるが、それだけでは各commitの作成branchは決まらない。

写真の緑・ピンク・オレンジ区間は、保護対象と判定されたら側方に維持する。default自身の履歴と確認できるのに側方配置されている区間だけを固定対象にできる。根拠が不明な区間も、見た目を整えるためにdefaultへ吸収しない。

従って、写真の全区間が必ず左へ移ることや、Initial commitが必ず左端に来ることは完成条件にしない。絶対条件を満たす結果として、写真がほぼ変わらないことも正当な結果とする。

初期調査で、各色区間について「現在のtrack」「現在ref」「残存reflog」「固定可否／保護／未判定」を一覧にする。OIDやscenario名を製品条件へハードコードしない。

## 4. 設定UI

全表示先のToolbarで`?`の左へ設定用の歯車ボタンを配置する。表示中のrepositoryの設定をQuick Pickで直接開く。ステータスバーは表示先選択専用とし、Editor / Panel / Sidebarの直接commandは維持する。設定を開くだけでは新しいgraph viewを生成しない。

| 項目 | 選択肢 | 初期値 |
| --- | --- | --- |
| レーン配置 | 従来の配置 / デフォルト列を左端に固定 | 従来の配置 |
| Reflog | ON / OFF | 既存値。未設定はON |
| Density | Compact / Comfortable | 既存値。未設定はCompact |

固定モードの説明は「他ブランチの履歴を別列に保ち、default自身の列を左端に固定」。内部値は`legacy` / `default-fixed`とする。

各設定に現在値を表示し、選択後に設定一覧へ戻る。Esc/戻るでは未確定値を保存しない。`Git Lines: Settings`で直接開けるようにする。

ToolbarからReflogとDensityを移し、検索・Load more・凡例・Refreshは維持する。左sidebarの28px専用行間隔は維持し、Densityはメインと下部panel向けであることを設定で説明する。

固定対象refと実効状態も設定内に短く表示する。例: `対象: main`、`対象未指定`。グラフ上に常設の説明領域を増やさない。

## 5. 保存・スコープ・更新

既存の`branchGraph.showReflog`、`branchGraph.density`を利用し、`branchGraph.layoutMode`を追加する。VS Codeの設定を正本として、Extension HostのSettingsServiceへ読み取り・保存・検証・変更通知をまとめる。

通常はユーザー設定へ保存する。既存のworkspace/folder上書きがある場合は有効値とスコープを明示し、表示した有効スコープへの変更として処理する。ユーザー設定を変更しても上書きに隠れて反映されない状態を避ける。実testのworkspace設定を保存テストに使わず、隔離profileと一時workspaceで検証する。

各sessionはrepositoryのresource URIに応じた有効設定を読み、設定変更イベントを購読する。再起動、Reload Window、view再生成でも復元する。複数viewが開いていれば対象となるviewを更新する。

保存完了後の値を画面へ反映し、失敗時は成功扱いしない。連続操作、読込中の変更、disposeと競合しても最終設定が反映されるようにする。

Densityはsnapshotからの再描画だけで処理する。固定モードへの初回切り替えは、保護判定に必要な証拠がsnapshotにあれば追加Git取得を行わない。不足している場合は必要な証拠だけ取得し、履歴全件の再取得を行わない。

## 6. defaultの解決

新モード用resolverを、既存primaryBranch選定から分離する。既存primaryBranch設定が履歴の割り当てに作用することと、固定対象の選択を混同しない。

自動判定は`origin/HEAD`を優先し、ない場合は他remote HEADが一意に示すbranchを採用する。複数候補の不一致、情報なし、参照先消失は未判定とする。main/masterという名前だけで確認済みdefaultと断定しない。

同名local branchがあれば表示対象はlocal ref、なければ対応remote refとする。local/remoteが分岐していても一つの履歴へ統合しない。両者が共有するcommitの表示はbranch保護判定に従う。

未判定時はモードの希望を保存しつつ、実効状態を`対象未指定`と表示する。必要時だけ`固定対象を指定`を提供する。表示用の手動指定はrepository単位でExtensionのworkspaceStateへ保存し、Gitのremote HEADやconfigを書き換えない。対象不明のまま固定済みと表示しない。

自動fetchやネットワーク通信は追加しない。ローカルremote HEADが古い場合、remote側の最新設定を保証するものではない。

## 7. branch履歴の保護判定

固定する前に、表示対象に関係する履歴区間を判定する。分類は、保護する他branch区間、default自身と確認できる区間、未判定区間とする。Git objectの親やrefを変更せず、根拠を持つ表示用metadataとして保持する。

使う根拠は以下に限定する。

- 現在のcheckout branchとworktree HEAD。
- 現在のbranch refと、従来表示で保持している独立track。
- branch reflogの連続したcommit作成記録・作成元・ref移動。
- 同一worktreeのHEAD reflogに残るcheckoutと、その後の連続したcommit記録。
- FFの取り込み先ref、旧tip、新tip、明示されたsource情報と、実objectの到達関係。
- merge commitの親順、およびsource側履歴を裏付ける情報。

FFの`old..new`全体を一律に一つのfeatureへ所属させない。取り込み元にさらに他branchのmergeが含まれる場合は、既存の独立区間を保持する。FFした事実だけでは、source branch名と各commitの作成branchを証明したことにならない。

判定では同一refのselector連続性とOID連鎖を確認する。時刻だけで複数worktreeの操作を一列に混ぜない。曖昧なsourceLabel、同じメッセージ、treeの類似性は所属の根拠にしない。rename・reset・rebase・同じbranch名の再作成は区間境界として扱い、別世代の履歴をまとめない。

従来表示で独立している他branch区間は、少なくともそのまま保護する。新モードが追加で確実な証拠を得た場合は保護区間を増やせるが、曖昧だからといってdefault列へ移すことはしない。

既存実装がユーザー指定のFF条件を十分保持しているかは、最初に実Gitテストで確認する。現時点では未検証のケースまで保証しない。既存モードで不一致が見つかったら、新モードの変更と混ぜず、独立した基準不一致として報告する。

## 8. Reflog表示と証拠の関係

ReflogのOFF/ONを切り替えても、固定モードの操作だけで保護したfeature履歴をdefaultへ吸収しない設計にする。

従来モードのReflog OFFは現状どおりの動作とする。新モードでは、Reflog OFF時も現在DAGのbranch保護に必要な証拠を内部利用する方針とし、PREVIOUS、historical node、Operation Overlayを表示するかどうかとは分ける。OFF時に隠した履歴nodeを、保護のために勝手に再表示しない。この内部利用と取得コストは説明・性能検証の対象とする。

対象は表示中のcommitと保護区間の境界に関係する証拠に限定し、既存のreflog/objectキャッシュを活用する。固定表示のために履歴の無制限取得や独自の永久履歴DBを追加しない。

reflogが残っていても、checkoutからcommitまでの必要区間が欠けていれば作成branchを完全には特定できない。必要証拠の読込中・取得上限・欠損・矛盾は明示的な未判定として扱い、その区間のdefaultへの移動を保留する。証拠が確認できた区間だけ配置を確定する。

## 9. 配置の構成

処理を`従来配置`と`保護判定付き固定配置`へ分ける。

1. 共通のGit snapshot/factsから、既存のtrack・色・行・parent edgeを生成する。
2. 従来モードは現行経路でそのまま返す。
3. 固定モードは表示用の保護区間とdefault対象区間を受け取る。
4. default列をlane 0として予約する。default自身の確認済み区間を配置する。
5. 他branchの保護区間はlane 1以降に保持する。default自身のcommitがない期間も、その空きを理由に他branchをlane 0へ詰めない。
6. 未判定区間は従来の識別・配置を優先し、根拠なしにdefaultへ移さない。両立が確認できない場合は固定対象区間を増やさず、実効状態と理由を残す。
7. 他branchは元のlaneと同じbranchの連続性を第一候補とし、衝突する区間だけ安定した規則で調整する。
8. Working Treeとref eventは、そのcheckout/refの所属を維持する。default refが側方nodeを指すことと、default列の予約を別に処理する。
9. 最終node座標に対して既存のAnnotation Rowとrouterを適用する。辺の端点、line色、Overlayの根拠を維持する。

branch単位の列の独立性を拘束条件として扱い、固定対象への変更候補を適用する前後で検査する。違反候補を生成してから色の違いで正当化する方式にはしない。

既存のtrack/色は維持を原則とする。ただし、既存が識別できていなかったfeature区間を新モードで根拠付きに識別する場合は、その区間に限る追加metadataと表示差を記録し、試作でレビューする。既存モードの共通分類を変更して差を隠さない。

## 10. キャッシュ・非同期処理

従来配置stateと固定配置stateを分け、固定後のlaneを従来のownership判定へ戻さない。repository、固定対象、mode、Reflog、証拠のrevisionが違う結果を混ぜない。

固定モードの保護判定が完了する前に、未確認の全commitを一時的にmainへ置いてから戻すちらつきを避ける。前回の有効表示を維持し、結果が揃ってから更新する。

mode往復では同じfactsの従来配置へ戻る。設定変更でも読み込み件数を不用意に初期化せず、選択OIDが存在する場合はDetailの対象を維持する。sidebarのpopoverは配置変更時に既存の閉じる規則を適用し、遅れて届いた応答で再表示しない。

paginationでは保護区間を追加情報で延長する。既存nodeの安定性を優先するが、取得した証拠が配置の誤りを確定した場合は絶対条件を優先し、その修正を検証対象として記録する。

## 11. 最初に作る実Git受け入れテスト

実testを改造せず、一時repositoryで以下を実際のGit操作により作成する。

| ケース | 確認 |
| --- | --- |
| main A→feature作成/switch、0 commit | feature Working Treeが側方、Aは共有1 node |
| 上記で未保存/未追跡/ステージ変更 | Working Tree表示と統計、列を維持 |
| feature F1→F2、mainはA | F1/F2をfeature列へ保持 |
| mainへFF、両refがF2 | F1/F2がmain列へ移らない、両refは実際のF2へ |
| FF後にmainでM1を作成 | M1が左端、parentは側方F2 |
| FF後にfeature削除、必要HEAD reflogが残る | 復元できるfeature区間の列を維持 |
| FF後に両refがさらに進む | 過去の保護区間を維持し、現在tipへ引きずらない |
| no-ff取り込み | main merge nodeとfeature側親を別列に保持 |
| main→feature取り込み、main ref維持 | featureのmerge nodeをmain列へ置かない |
| 入れ子branch、mergeを含むFF範囲 | 取り込み範囲を一branchへまとめない |
| rename、同名branch再作成、reset | 証拠の世代と境界を混ぜない |
| reflog欠損、期限切れ、読込不足 | 不明な区間を確定所属として扱わない |

各ケースで、従来モードと固定モード、Reflog ON/OFF、再起動、mode往復を確認する。固定モードの全ケースで「保護されたfeature node/Working Treeのlaneはdefault列と異なる」を直接検証する。

## 12. 広範囲の回帰検証

- 従来モードの全既存テストを維持する。featureのlane独立性を確認する期待を弱めない。
- 実testと91 fixtureを同一snapshotで比較する。Reflog ON/OFF、Editor/Panel Compact/Comfortable、Sidebarを対象にする。
- parent配列・順序・node数・edge数・Operation relationとmember・Annotation Rowの位置を比較する。
- Current/Historical、Amend、Rebase/Reword/Edit、Squash/Fixup、Cherry-pick、Reset、Branch rename、進行中operationを確認する。
- Octopus、Criss-cross、Multiple roots、Orphan、Detached HEAD、複数worktree、local/remote分岐、同一tip複数refを確認する。
- 最終座標のBezier実曲線を使い、非端点nodeとselection ringへの接触、新たな過大迂回を調べる。Overlay/labelはGUIでも確認する。
- 30→40→50件、mode切替後のLoad more、スクロール・選択・Detail・popover・設定の復元を確認する。
- snapshot取得、証拠取得、lane計算、描画を分けて時間を比較する。Reflog OFFの固定モードで追加取得が必要になる場合も測定して報告する。
- `pnpm check`と`git diff --check`を実行する。

GUIは隔離したExtension Development Host/profileで確認し、実testは読むだけにする。GUI未実施の場合はその制限を報告する。

## 13. 実装順序

### A. 絶対条件の基準化

一時Git repositoryで上記2必須ケースを再現し、現在の挙動と必要な証拠を確認する。通常表示の現状に問題があるかも切り分ける。ここでは既存表示を無断で変更しない。

### B. 保護区間判定と固定配置の小さな試作

新モード専用の証拠adapterと保護判定を作る。default列とfeature列が両立することを最小モデルで確認する。その後、写真のtestでどの区間が実際に変わるかを一覧とGUIで示す。想定した写真の変化を得るために絶対条件を緩めない。

### C. 設定・保存

SettingsService、Quick Pick、設定schema、固定対象resolverを実装する。保存の成否、scope、再起動復元を検証する。

### D. session・Webviewへの接続

全表示先へ反映し、ToolbarのReflog/Densityを移す。snapshot/保護判定/配置stateを整理し、非同期・mode往復・性能を検証する。

### E. 回帰・説明の更新

広範囲テストとGUI確認を完了し、README日本語・英語・Marketplaceと技術文書を更新する。設定の初期値は従来表示のままにする。version変更・VSIX生成・公開は別途指示された時に行う。

A/Bで絶対条件を満たせなければ、固定モードを完成扱いにせず、再現ケースと両立できない条件を報告する。設定画面の完成をもって配置仕様の成功とは扱わない。

## 14. 想定変更箇所

| 領域 | 内容 |
| --- | --- |
| 新規settings service/command、package.json | 保存・enum・Quick Pick・command |
| 新規default resolver | 根拠付きの対象選定・未判定 |
| 新規branch protection module | ref/reflog/Worktree/objectを用いた区間の保護 |
| 新規default fixed layout | 保護制約を受け取る専用allocator |
| graphLayout / layoutState | mode分岐、従来stateとの分離、routingとの接続 |
| graphViewSession / message protocol | 有効設定・追加証拠・更新・dispose |
| Toolbar / App / styles | 既存設定操作の移設 |
| unit/integration tests、3 README、technical docs | 絶対条件・互換性・利用説明 |

製品のGit履歴を変更する操作は追加しない。新しい挙動が必要な共通処理は、従来モードの出力一致を確認してから導入する。
