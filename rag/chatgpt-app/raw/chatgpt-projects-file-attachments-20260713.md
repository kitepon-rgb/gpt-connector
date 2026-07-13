# ChatGPT Projects／chatのfile attachment記述

- 出典: https://learn.chatgpt.com/docs/projects
- 取得日: 2026-07-13
- 取得方法: OpenAI Developer Docs MCPで全文取得。MarkItDownでも取得し、出力34,492文字で空取得でないことを確認。
- 確度: 高（OpenAI公式文書）

## Verbatim excerpt

> A ChatGPT project doesn’t provide direct access to a folder on your computer, so upload or connect the sources you want ChatGPT to use.

> Attach files or image inputs directly to a chat when they apply only to that conversation.

## この調査での境界

公式文書はChatGPTがupload済みfileをchatへ添付できることを確認する根拠になる。一方、consumer ChatGPT Webのupload endpoint、request schema、file ID、integrity／attestation、retentionは公開しておらず、CDP実測が必要。
