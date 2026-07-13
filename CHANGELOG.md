# Changelog

## 0.3.1 — 2026-07-14

- live browser launcherがmacOS専用である契約に合わせ、LinuxとWindowsのfactory diagnosticsを
  CDP不備の`not_ready`ではなく`unsupported`として報告するよう修正した。

## 0.3.0 — 2026-07-14

- BugHub factory向けに `gpt-connector factory-diagnostics --json` を追加した。既存
  `gpt-connector.diagnostics.v1` の `doctor` 契約は維持する。
- 明示的な canonical dotagents `collection.enabled: true` の時だけ動く、network I/O を
  持たない product-owned `runtime-errors` local aggregate を追加した。
- runtime error の公開面は固定 code/template と SHA-256 fingerprint のみを使う。prompt、
  応答、添付、識別子、credential、CDP dump、絶対 path、raw error は保存・出力しない。
- true headlessを使わず、cold startでは窓なしで専用profileのheadful Chromeを起動し、CDPで
  ChatGPT targetを最初から最小化状態で作成・確認してからapp readyを待つ`gpt-connector browser start`
  を追加した。既存endpointもapp probeより先に最小化する。現行macOS実測では最小化中も送受信を維持する。
- `gpt-connector browser show`で、正規専用profileの一意ChatGPT windowだけを明示的に表示へ戻せるようにした。認証要求時はstartが同じwindowを表示へ戻してから`AUTH_REQUIRED`を返す。
- window stateのCDP read-backを有界pollにし、非同期遷移直後の旧stateによるfalse failureを防いだ。
- cold startはhidden Chrome・background minimized targetから開始し、最小化確認後に正規PIDだけをunhideしてからprobeする。
- showはCDP stateのstale値に依存せず`Page.bringToFront`を送る。最終状態はWindowServerの正規PID/layer 0 window数で確認する。
