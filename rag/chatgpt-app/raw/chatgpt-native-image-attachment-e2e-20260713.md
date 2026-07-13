# ChatGPT native image attachment E2E

- 出典: OpenAI公式Docs MCP、`https://developers.openai.com/apps-sdk/reference#file-apis`、`https://developers.openai.com/apps-sdk/build/state-management#image-ids-in-widget-state-model-visible-images-chatgpt-extension`、`https://developers.openai.com/api/docs/guides/images-vision`、ログイン済み`chatgpt.com`公式page runtime
- 取得日: 2026-07-13
- 取得方法: OpenAI Docs MCPで公式ページを取得し、専用CDP runtimeのsanitized probeと照合する。MarkItDownではなくDocs MCP取得である。
- 確度: 公式公開面は高。consumer通常Chat WebのPNG shapeは実機E2Eで高。
- 秘密除外: token、cookie、account ID、conversation ID、server file ID、署名付きURL、request／response bodyを保存しない。

## 公式公開面から確定できること

- ChatGPTのApps SDK面には、fileをuploadしてfile IDを得るhelperがある。
- modelが画像をfollow-upで参照する公開契約には`imageIds`があり、単なるfile uploadとmodel可視化を同一視できない。
- 公式vision資料はPNG、JPEG、WEBP、非animated GIFを画像入力形式として挙げ、file IDで画像入力を渡せると説明する。
- 上記はconsumer通常Chat Web内部のconversation payloadを公開するものではない。production採用形式は実runtimeでupload、server attachment、視覚認識を確認したものに限定する。

## 自作fixture

- path: `test/fixtures/native-attachment/image/visual-marker.png`
- source: `test/fixtures/native-attachment/source/visual-marker.svg`
- MIME: `image/png`
- dimensions: 640×360
- bytes: 22,427
- SHA-256: `ea9846a5508ed6350e38f94eb8366bcd91c0b646a7a41b0523f5726fd42946db`
- visual marker: `MARKER 7Q4M`
- visual primitives: red circle、blue square
- privacy: 自作の図形と固定英数字のみ。個人情報、秘密、既存画像なし。

## 現時点の反対仮説

1. generic file attachmentとしてuploadできても、通常Chat modelへ画像入力として渡らない可能性がある。
2. `uploadFile`のimage MIME allowlist引数が空の現行経路では、画像だけ別処理または拒否になる可能性がある。
3. server metadataへattachmentが残っても、モデルの視覚認識が成立しない可能性がある。

この三点は、upload `ready`、server read-back、固定visual marker回答を別々に観測して判定する。

## 通常Chat Web実測

専用の新規会話と上記fixtureだけを使い、DOM、file input、座標操作なしで公式page runtimeを呼び出した。

- upload: `ready`、progress 100、name一致、22,427 bytes一致、server file IDあり、upload errorなし。
- MIME: upload resultの`fileSpec.mimeType`は未設定。元のbrowser `File.type`は`image/png`で、現行normalization後のconversation attachmentは`image/png`になった。
- dimensions: upload resultの`fileSpec.width`／`height`は未設定。fixtureの640×360はlocal sourceで確定しているが、runtime read-back由来とは扱わない。
- conversation: server read-backでattachment 1件、name `visual-marker.png`、MIME `image/png`が一致した。
- vision: assistantは説明なしで`MARKER 7Q4M`と回答し、固定visual markerと厳密一致した。
- selection: requested／resolved modelは`gpt-5-6-thinking`、effortは`extended`で一致した。
- completion: `finished_successfully`、`endTurn=true`。
- lifecycle: conversation archive後、bridge diagnosticsはsession、operation、upload、buffered upload bytesがすべて0。
- retention: conversation archiveは確認したが、upload file retentionは`unknown`、cleanupは`not_supported`のまま。

server file ID、conversation ID、token、cookie、account IDは保存していない。

## 裁定

PNGは、通常Chat Webの正規upload、conversation attachment、モデル視覚認識の三点が揃った。production候補に進めてよい。gpt-connectorは添付transportに責務を限定し、`.png`を`image/png`として元bytesのまま公式runtimeへ渡す。PNG signature、構造、CRC、dimensionsはlocalで検査しない。runtime metadataがdimensionsを返さなかったため、dimensionsをserver証拠として公開しない。

UI上のfile名表示は正規ゲートに採用しない。archive済み会話のDOM文字列は公開契約ではなく、UI非依存という目的にも反するためである。

## Production `consult`実測

PNGを許可したproduction sourceに対し、CLIの`consult`を使って同じfixtureを検証した。研究用bootstrapへの差し込みではなく、通常のresolver、SHA-256、CDP chunk転送、公式upload client、conversation builder、server read-back、durable jobを通した。

- dry-run: 22,427 bytes、`image/png`、SHA-256がfixtureと一致し、`uploadWouldRun=false`、`conversationWouldRun=false`。
- job: `succeeded`、errorなし。
- assistant: `MARKER 7Q4M`と厳密一致、`finished_successfully`、`endTurn=true`。
- selection: resolved model `gpt-5-6-thinking`、effort `extended`がrequested値と一致。
- attachment read-back: 1件、name `visual-marker.png`、MIME `image/png`、`readBack=confirmed`。
- lifecycle: `archived=true`。直後のdiagnosticsはsession、operation、upload、buffered bytes、active jobがすべて0。
- retention: `unknown`、cleanup `not_supported`。

検証job台帳はrepository内のgitignore済み一時directoryへ隔離し、diagnostics確認後に削除した。server file ID、conversation ID、token、cookie、account IDは出力・保存していない。
