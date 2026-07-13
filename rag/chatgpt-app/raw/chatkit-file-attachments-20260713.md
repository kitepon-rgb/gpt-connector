# ChatKit file attachment設定

- 出典: https://developers.openai.com/api/docs/guides/chatkit-themes#enable-file-attachments
- 取得日: 2026-07-13
- 取得方法: OpenAI Developer Docs MCPで該当節取得。MarkItDownでも取得し、出力8,094文字で空取得でないことを確認。
- 確度: 高（OpenAI公式文書）

## Verbatim excerpt

> Attachments are disabled by default. To enable them, add attachments configuration. Unless you are doing a custom backend, you must use the `hosted` upload strategy.

> You can also control the number, size, and types of files that users can attach to messages.

## この調査での境界

ChatKitではuploadとmessage attachmentが明示的に分かれることを示す。ただしChatKitは公開API製品であり、consumer ChatGPT Webの内部upload仕様を証明しない。
