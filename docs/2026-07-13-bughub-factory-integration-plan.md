# BugHub factory 契約適合（Wave 6.0 / 6.1）

正本: dotagents `docs/plan_bughub-factory-integration.md` Wave 6.0 / 6.1  
対象: `gpt-connector` のみ。既存 AI installer 作業とは変更ファイル・commit を分離する。

## 目的

既存の Chat、consult、MCP、添付、durable job、`gpt-connector.diagnostics.v1` を壊さず、
BugHub factory が製品内部を推測せずに利用できる read-only diagnostics と、明示 opt-in の
local runtime-error aggregate を製品所有で提供する。送信・upload・会話作成・archive・job 作成は
この変更の対象外であり、追加しない。

## TODO

- [x] Wave 6 正本、worktree、既存 CLI／diagnostics／job store を実読して前提を確認する。
- [x] `doctor` を保持する別の `factory-diagnostics --json` versioned read-only 契約を設計する。
- [x] canonical dotagents config の厳密な `collection.enabled === true` だけを読む runtime store を実装する。
- [x] fixed code/template、SHA-256 fingerprint、集約、resolve/reopen、cursor/ack、retention を実装する。
- [x] owner-only atomic state、symlink/tamper 拒否、bounded snapshot、privacy negative fixture を実装する。
- [x] CLI と修正可能な connector 境界へ best-effort 観測を接続し、store 異常を固定診断で可視化する。
- [x] README、npm 公開 allowlist、変更履歴を更新する。
- [x] `pnpm check` と `npm pack --dry-run --json` を実行し、失敗があれば修正する。

## 設計判断

- factory diagnostics は CDP 接続を読むだけで、ChatGPT runtime に mutation を送らない。host 非対応は
  `unsupported`、CDP/auth 未準備は `not_ready`、検査不能は `unverified` として分離する。
- runtime-error store は product-owned state にのみ保存する。collection OFF/設定不正時は state を
  作成せず、network I/O は一切持たない。
- 観測入力は固定 error code と時刻だけに限定する。prompt、応答、file/session/job/conversation ID、
  token/cookie、CDP dump、絶対 path、raw error/stack/stderr は API・保存・公開 JSON のいずれにも通さない。
