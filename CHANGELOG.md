# Changelog

## Unreleased

- BugHub factory向けに `gpt-connector factory-diagnostics --json` を追加した。既存
  `gpt-connector.diagnostics.v1` の `doctor` 契約は維持する。
- 明示的な canonical dotagents `collection.enabled: true` の時だけ動く、network I/O を
  持たない product-owned `runtime-errors` local aggregate を追加した。
- runtime error の公開面は固定 code/template と SHA-256 fingerprint のみを使う。prompt、
  応答、添付、識別子、credential、CDP dump、絶対 path、raw error は保存・出力しない。
