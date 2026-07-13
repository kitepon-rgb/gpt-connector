# ChatGPT デスクトップアプリを Oracle の非 UI 代替にできるか

出典: OpenAI 公式ドキュメント、ChatGPT.app 26.707.51957 のローカル観察、同梱 Codex CLI 0.144.0-alpha.4 の App Server 実測。取得・検証日: 2026-07-13。確度: claim ごとに記載。

## 問い

従来の Oracle（ブラウザ経由で ChatGPT の Chat 枠へ相談する機能）と同じ目的を、Codex が統合された新しい ChatGPT デスクトップアプリで、UI 操作なしに実現できるか。

## 結論

目的を二つに分ける必要がある。

1. **別コンテキストのモデルへ相談し、回答を回収する**: 可能。Codex App Server またはアプリの Codex thread tools を使えば、UI なしで projectless thread を作成・継続・読取できる。公式かつ更新耐性のある経路。
2. **従来 Chat の枠を使い、Codex/Work 枠と別勘定の第二意見を得る**: 現時点では不可能。公開された非 UI 経路は見つからず、Codex App Server は実測で `limitId: codex` を消費する。Chat の内部送信経路はアプリに存在するが、非公開かつ integrity/attestation に守られた consumer backend であり、コネクタとして直接利用すべきではない。

したがって、**安定性を最優先するなら「Codex-native Oracle」は作れるが、現行 Oracle の Chat 枠分離という価値は置き換えられない**。

## 製品境界

OpenAI は 2026-07-09 に Codex app が新 ChatGPT desktop app へ統合され、Codex は Chat と Work に並ぶ専用面として残ると説明している。つまり同じアプリ内にあっても、Chat・Work・Codex は同一ランタイム／同一公開 API とは限らない。

Work の公式説明も境界を明示する。

- Chat: 回答、説明、ブレインストーム、短い草稿
- Work: 明確な成果物を伴う委譲作業
- Codex: coding experience。非 coding work には Work と同じコア能力を利用できる

一次ソース:

- [ChatGPT desktop What's new](raw/chatgpt-desktop-whats-new-20260713.md)
- [Get started with Work](raw/chatgpt-work-20260713.md)

## 公開されている非 UI 経路

### Codex App Server

公式 App Server は JSON-RPC 2.0 で次を公開する。

- `thread/start`, `thread/resume`, `thread/read`, `thread/list`
- `turn/start`, `turn/steer`, `turn/interrupt`
- streamed item/turn notifications
- ChatGPT account login と rate-limit read
- stdio、Unix socket、実験的 WebSocket transport

これは「認証・会話履歴・approval・streamed agent events を含む Codex の深い統合」の公式入口である。別プロセスの `codex app-server` を起動して JSON-RPC を使う設計なら、DOM や Electron renderer に依存しない。

一次ソース: [Codex App Server](raw/codex-app-server-20260713.md)

### 現在の ChatGPT app が Codex に公開する thread tools

本セッションで観測した callable capability:

- `create_thread`: project または projectless Codex thread を作成
- `send_message_to_thread`: 既存 thread に追送
- `read_thread`: thread の状態・turn を非表示のまま読取
- `list_threads`, `fork_thread`, `set_thread_archived` など

これは「相談を別 thread に投げて回収する」用途を満たす。ただし API の説明自体が Codex thread と明記し、選択可能モデルも Codex/Work 系だけである。

## ローカル実測

対象:

- `/Applications/ChatGPT.app`
- app version `26.707.51957` / build `5175`
- bundle id `com.openai.codex`
- bundled Codex CLI `0.144.0-alpha.4`

同梱 CLI で schema を生成し、App Server へ read-only JSON-RPC を送った。

### collaboration mode

`collaborationMode/list` の応答は次の二つだけだった。

- `Plan` (`plan`)
- `Default` (`default`)

Chat mode / Work mode は App Server collaboration mode として露出していない。

### models

`model/list` は GPT-5.5 と GPT-5.6 Sol/Terra/Luna など Codex/Work 用モデルを返す。Chat の consumer model picker を操作する API ではない。

### quota

`account/rateLimits/read` の主 limit は `limitId: codex` だった。個人の使用率や reset 時刻は本記録へ保存しない。

この結果から、App Server 経由の consultation は Chat 枠ではなく Codex 枠を消費すると判定できる（確度: reproduced）。

## アプリ内部 Chat 経路の観察

`app.asar` には以下が存在する。

- `isEverydayWorkMode`
- `isTemporaryChat`
- consumer conversation state と model/thinking effort
- `/f/conversation/prepare`, `/f/conversation/resume`
- `sentinel/chat-requirements/prepare`
- conduit token、integrity headers、app attestation challenge

したがって Chat/Work のネイティブ実装は確実に同梱されている。しかしこれは公開 App Server schema に出ない別経路で、consumer backend の integrity chain を伴う。直接利用には非公開 protocol、アプリ認証状態、attestation の複製または流用が必要になる。

判定: **不採用**。

- 公開契約でないため更新で壊れる
- 認証 token の所有境界を破る
- anti-abuse/integrity mechanism の回避へ近づく
- UI 自動化を避けても、より危険な private API 依存へ置き換わるだけ

## handoff の向き

アプリ内部には ChatGPT の `handoff` dynamic tool がある。説明は「ChatGPT から Work mode または Codex へ request を redirect」する方向で、作成された destination thread は `codex://threads/{id}` で開く。

これは Chat → Work/Codex の移送であり、Codex → Chat の新規 conversation 作成・送信・回答回収 API ではない。現在の Codex callable tools にも reverse handoff は露出していない。

## 候補比較

| 経路 | UI 非依存 | 公式 | 別コンテキスト | Chat 枠 | 判定 |
|---|---:|---:|---:|---:|---|
| Codex App Server | Yes | Yes | Yes | No (`codex`) | 安定版の相談経路として採用可能 |
| ChatGPT app thread tools | Yes | Yes（host capability） | Yes | No | Codex 内だけで使う最短経路 |
| Chat/Work internal conversation API | Yes | No | Yes | おそらく Yes | token/integrity/private API のため不採用 |
| Oracle browser engine | No（headful browser） | No | Yes | Yes | Chat 枠分離が必要な間は現行維持 |

## 推奨

用途を二本立てにする。

1. **通常の第二意見**: `codex app-server` を包む MCP/skill を新設し、projectless・read-only・tool use 最小で別 thread に相談する。名称例 `codex_consult`。回答 stream と final message を caller へ返し、作成 thread id を記録する。
2. **Chat 枠を使う第二意見**: Oracle を残す。Chat の公開 create/send/read API または Codex→Chat reverse handoff が公式に追加された時だけ置換を再検討する。

Codex 内だけなら host の `create_thread` → `read_thread` で足りる可能性が高く、MCP を作る前に一回の end-to-end probe を行う価値がある。ただし thread tool の作成は明示的なユーザー依頼が必要なため、本調査では実行していない。

## 再訪条件

次のいずれかが公式に出た時に再調査する。

- Codex/ChatGPT host tool に `create_chat`, `send_message_to_chat`, `read_chat` 相当が追加
- App Server schema に consumer Chat source/mode/provider が追加
- Codex → Chat の reverse handoff が追加
- consumer Chat conversation API が公開・サポート対象になる
- OpenAI が Chat と Codex/Work の quota 統合を明示し、枠分離の意味が消える

## 反証

親が次の反対仮説を検証した。

- 「名前が ChatGPT になったので App Server thread は Chat 枠か」→ quota 実測 `codex` で棄却。
- 「Work mode を App Server collaboration mode に指定できるか」→ `Plan` / `Default` のみで棄却。
- 「アプリ内部 Chat API を安全なローカル IPC として呼べるか」→公開 schema になく、integrity/attestation 付き private backend だったため棄却。
- 「既存 handoff が Codex→Chat に使えるか」→ Chat→Work/Codex の一方向だったため棄却。

独立した子エージェント反証は行っていない（本セッションでは委譲を明示許可されていないため）。
