# Git Lines icon — 採用案 v1

`resources/icon-v1.png` は組み込み image_gen で生成・背景調整し、ユーザーが採用した1254×1254pxのPNG。ユーザーの了承を受けてPNGの透明度を直接補正し、角丸の外側を透明化した。Marketplace用の拡張アイコンとしてpackage.jsonから参照する。デザイン変更時は原稿を残し、次のversionの画像へ更新する。

- シアンの実線と3つのcommit点：現在の履歴の主レーン
- 緑の分岐：Gitのparent関係を持つbranch
- 灰色のcommit点と紫の破線矢印：過去のcommitと現在を結ぶOperation Overlay
- 文字を入れず、小さい表示でも線と点で特徴を伝える

Panel container用の小さな単色アイコンは `resources/git-lines.svg` を使う。

背景調整前の比較用画像は `icon-v1-original.png`、透明度補正前の採用画像は `icon-v1-opaque.png` に保存。design資料はVSIXへ含めない。

## PNG transparency correction

Pillowで元画像と同じ寸法の角丸マスク（半径268px）を8倍解像度で作成し、BOXフィルターで縮小してアルファチャンネルへ適用した。輪郭は元画像の暗色タイルの内側に収め、境界をアンチエイリアス処理した。全画素のRGB値、画像寸法、シンボルの位置と不透明度は維持している。

保存後のPNGを再読込し、完全透明60,800画素、境界の半透明1,820画素、不透明1,509,896画素を確認した。四隅の64×64px領域はすべてアルファ0。白背景・暗色背景へ合成した320px／128px表示でも輪郭を確認した。

## Generation prompt

```text
Use case: logo-brand. Asset type: one square application icon for the VS Code extension Git Lines. Create a distinctive polished first-draft icon that communicates its actual features: solid branching Git commit ancestry and a separate dashed historical rewrite relation. Style: extremely clean flat vector-like app icon, bold rounded line caps, sharp geometry, restrained modern developer-tool identity. Background: deep charcoal rounded square with generous safe margins. The symbol occupies about 70 percent of the canvas. Composition: a vertical cyan main line with three filled circular commit nodes; one solid green branch curves from the lower main node towards one green node at the upper right. One small muted gray historical commit node sits at the lower right. A secondary violet curved dashed arrow with three substantial dashes connects the gray historical node to the middle cyan commit, taking a smooth clear route and remaining visually distinct from the solid ancestry lines. Exactly five commit circles total. Make the cyan/green solid ancestry immediately readable and the violet operation overlay a distinct secondary accent. Balanced negative space, high contrast, memorable silhouette, still legible at 128 by 128 pixels. Output one 1024 by 1024 square icon. No text, letters, labels, UI screenshot, legend, perspective, 3D effects, or surrounding presentation.
```

## Background edit prompt

```text
Edit this Git Lines icon. Preserve the existing symbol, all five commit circles, their positions, cyan and green solid branch lines, gray historical commit node, and purple dashed rewrite arrow. Change only the background and alpha treatment: replace the entire background with perfectly uniform solid deep charcoal #111820 across the entire square canvas, including all corners. The image must be FULLY OPAQUE EVERYWHERE, alpha 255 at every pixel, with no transparent or semitransparent regions, no holes, no shadow patterns, and no texture. Keep the symbol crisp and flat with clean antialiasing, no added text or decoration. Produce a finished square app-icon raster with the same composition, now on a completely even opaque charcoal square.
```
