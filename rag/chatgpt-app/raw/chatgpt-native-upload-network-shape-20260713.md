# ChatGPT native upload network／conversation shape

- 出典: 専用Chrome上のChatGPT公式UI添付をCDP Networkで観測
- 取得日: 2026-07-13
- fixture: `probe.txt`、215 bytes、`text/plain`。本文とSHA-256はproject test fixtureを正本とする。
- 確度: 高（実通信）
- 秘密除外: request／response body、header値、query値、file ID、library file ID、conversation ID、account ID、cookie、tokenは保存していない

## upload event順

1. `POST https://chatgpt.com/backend-api/f/conversation/prepare` → 200 JSON
2. `POST https://chatgpt.com/backend-api/files` → 200 JSON
3. `OPTIONS https://*.oaiusercontent.com/files/:uuid/raw` → 200
4. `PUT https://*.oaiusercontent.com/files/:uuid/raw`、`content-type: text/plain` → 201
5. `POST https://chatgpt.com/backend-api/files/process_upload_stream` → 200 SSE
6. `POST https://chatgpt.com/backend-api/lat/retrieval` → 200 JSON

署名付きstorage URLのqueryは値を保存せず、key名だけ観測した。単発fixtureではraw PUTが1回であり、chunk uploadは発生しなかった。

## conversation request shape

- `POST /backend-api/f/conversation`
- request body: 1,271 bytes
- `messages`: 1
- user message `content.content_type`: `text`
- user message `metadata.attachments`: 1
- attachment field: `id`、`is_big_paste`、`library_file_id`、`mime_type`、`name`、`size`、`source`
- safe value: `mime_type=text/plain`、`size=215`
- `metadata.selected_sources`: empty

## 結果

- ChatGPT画面で`probe.txt`を添付として確認。
- モデルがfile先頭のfixture識別子を回答。
- 研究用conversationはUIの正規archive操作で終了。
- 直接`fetch`による`PATCH /backend-api/conversation/:id`は401であり、公式integrity付きclientが必要。
