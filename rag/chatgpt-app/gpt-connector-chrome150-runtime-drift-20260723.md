# Chrome 150 / ChatGPT bundle drift復旧

- 出典: Chrome DevTools Protocol公式仕様、gpt-connector 0.4.7/0.4.8ローカル実測
- 取得・実測日: 2026-07-23
- 確度: 高

## 症状

- `browser start`が`RUNTIME_DRIFT`または`CDP_UNAVAILABLE`で停止する。
- Chrome 150は`Browser.setWindowBounds`へ成功応答するが、read-backは`maximized`のまま。
- ChatGPT bridge bootstrapは`RUNTIME_DRIFT:sender:0`で停止する。

## 原因

1. 製品がCDPの`minimized`状態とWindowServer非表示を二重の必須条件にしていた。
2. ChatGPT現行bundleでは公式送信関数のexportは残るが、旧識別文字列が関数sourceから消えた。
3. `browser show`の所有者検査が短い500ms probeへ結合されていた。

## 裁定

- macOS表示状態の正本は、profile照合済み専用PIDのAppKit `hidden`とWindowServer layer 0表示数に置く。
- CDPはtarget/window schema、公式origin、認証、bridgeをfail-closedで検証する。
- senderは一意性を維持した複数の構造markerで検出し、0件・複数件は引き続き停止する。
- 所有者検査は専用grace、cold start全体は30秒deadlineとする。

## 実測

- focused tests: 40/40
- typecheck/build: 成功
- 修正版`browser start`: `already_ready`
- live model catalog: 17モデル取得、default `gpt-5-5`
- benchmark・会話送信: 未実施
