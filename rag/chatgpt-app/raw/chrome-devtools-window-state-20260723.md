# Chrome DevTools Protocolのwindow state契約

- 出典:
  - https://chromedevtools.github.io/devtools-protocol/tot/Browser/
  - https://chromedevtools.github.io/devtools-protocol/tot/Target/
- 取得日: 2026-07-23
- 取得方法: MarkItDown
- 確度: 高（公式tip-of-tree仕様）

## 関連記述

Browser domainは`setWindowBounds`を「Set position and/or size of the browser window.」と説明し、
`WindowState`として`normal`、`minimized`、`maximized`、`fullscreen`を列挙する。

Target domainは`createTarget.windowState`を「Frame window state」と説明し、`newWindow=true`または
headless shellで使えるとする。`background=true`はtargetをforegroundへ出さずに作る指定である。

tip-of-tree仕様は実装の収束保証ではない。Chrome 150実測では成功応答後もstateが変化しないため、
製品の表示判定はmacOS実状態と照合する。
