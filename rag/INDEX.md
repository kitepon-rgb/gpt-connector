# rag/ INDEX

調査・研究の再利用棚。一次ソースは `raw/`、要約・実測・判断はコンパイル記事に分離する。

- [chatgpt-app/chatgpt-desktop-oracle-route-20260713.md](chatgpt-app/chatgpt-desktop-oracle-route-20260713.md) — 新 ChatGPT desktop app を Oracle の非 UI 代替にできるか: Codex-native consultation は可能だが quota は `codex`、consumer Chat は private integrity API のため非採用。Chat 枠分離が必要なら Oracle 継続（2026-07-13・公式資料＋ローカル実測）
- [chatgpt-app/chatgpt-cdp-bridge-static-discovery-20260713.md](chatgpt-app/chatgpt-cdp-bridge-static-discovery-20260713.md) — consumer client、`/f/conversation/*`、live `AppScope`、CDP runtime の静的 discovery。理想順位1は候補維持、次は専用のログイン済みCDP runtimeが必要（2026-07-13・ローカル実測）
- [chatgpt-app/chatgpt-web-client-runtime-discovery-20260713.md](chatgpt-app/chatgpt-web-client-runtime-discovery-20260713.md) — 公式factory→initThread→`DP`→`kF`で、DOM／React fiberなしの新規・2turn継続・公式state応答回収を実証。plain UUID失敗もnegative characterizationとして記録（2026-07-13・ローカル実測）
- [chatgpt-app/chatgpt-web-model-effort-selection-20260713.md](chatgpt-app/chatgpt-web-model-effort-selection-20260713.md) — 公式`/models` catalog、通常Chat／Work分離、`requestedModelId`＋`thinkingEffort`明示選択、assistant metadata一致、非対応組合せの送信前拒否を実証（2026-07-13・ローカル実測）
- [chatgpt-app/gpt-connector-implementation-20260713.md](chatgpt-app/gpt-connector-implementation-20260713.md) — core／CLI／stdio MCP実装、23 tests、実browser one-shot／2turn／model-effort／archive、auth／空SSE故障注入、反証修正7件、pnpm 11とFetch URL patternの罠を記録（2026-07-13・ローカル実測）
- [chatgpt-app/raw/codex-app-server-20260713.md](chatgpt-app/raw/codex-app-server-20260713.md) — OpenAI 公式 Codex App Server 全文（MarkItDown、2026-07-13取得）
- [chatgpt-app/raw/chatgpt-desktop-whats-new-20260713.md](chatgpt-app/raw/chatgpt-desktop-whats-new-20260713.md) — Codex app の ChatGPT desktop app 統合と Chat/Work/Codex の並存（OpenAI公式、2026-07-13取得）
- [chatgpt-app/raw/chatgpt-work-20260713.md](chatgpt-app/raw/chatgpt-work-20260713.md) — Chat と Work の役割境界、desktop Work と Codex の関係（OpenAI公式、2026-07-13取得）
