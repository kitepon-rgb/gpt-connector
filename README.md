# GPT Connector

[![npm version](https://img.shields.io/npm/v/gpt-connector.svg)](https://www.npmjs.com/package/gpt-connector)
[![license](https://img.shields.io/npm/l/gpt-connector.svg)](LICENSE)

Codex開発枠から、ログイン済みChatGPT公式Web runtimeの通常Chatを呼び出すローカルconnector。

ブラウザは認証・integrity・attestation・conversation lifecycleの実行環境として使う。composer、送信button、回答DOM、React fiberは操作・参照しない。

> [!WARNING]
> consumer Chatの非公開Web runtimeとminified bundleに依存する実験的実装。OpenAIの公開・安定APIではない。bundle contractが変わった場合は`RUNTIME_DRIFT`で停止し、別方式へ自動fallbackしない。

公開版は[`gpt-connector@0.1.0`](https://www.npmjs.com/package/gpt-connector)。ソースと変更履歴は[GitHub repository](https://github.com/kitepon-rgb/gpt-connector)を正とする。

## 成立済み機能

- 通常Chatのone-shot送信と自動archive。
- process内opaque sessionによる複数turn継続。
- explicit closeとserver archive read-back。
- live model catalog取得。
- model／thinking effort明示選択。
- Work-only modelの除外。
- 非対応model／effortの送信前拒否。
- CLIとstdio MCP adapter。

## 前提

- macOS
- Google Chrome
- Node.js 26以上
- ChatGPTへログインできるaccount

sourceからbuildする場合だけpnpm 11以上も必要。

## npm global install

```bash
npm install --global gpt-connector
```

専用Chromeを起動する。通常ChromeとOracle profileは使用しない。

```bash
open -na 'Google Chrome' --args \
  --remote-debugging-port=9223 \
  --user-data-dir="$HOME/.gpt-connector/browser-profile" \
  --no-first-run \
  --no-default-browser-check \
  https://chatgpt.com/
```

初回だけ、開いた専用ChromeでChatGPTへ手動ログインする。connectorはpassword、cookie、tokenを読み出さない。

## source setup

```bash
git clone https://github.com/kitepon-rgb/gpt-connector.git
cd gpt-connector
pnpm install
pnpm check
pnpm build
```

read-only model smoke:

```bash
gpt-connector models --endpoint http://127.0.0.1:9223
```

one-shot Chat smoke:

```bash
gpt-connector chat \
  --endpoint http://127.0.0.1:9223 \
  --model gpt-5-6-thinking \
  --effort min \
  --prompt 'Reply with exactly: OK'
```

CLIは短命processなのでone-shot専用。複数turn sessionはMCP adapterを使う。

## Codex MCP

Codexはtrusted projectの`.codex/config.toml`を読み、stdio serverは`command`と`env`で構成できる。npm global install後は、利用するprojectへ次の設定を置く。

```toml
[mcp_servers.gpt_connector]
command = "gpt-connector-mcp"
startup_timeout_sec = 20
tool_timeout_sec = 240
enabled = true
required = false
enabled_tools = ["chatgpt_models", "chatgpt_chat", "chatgpt_close"]

[mcp_servers.gpt_connector.env]
GPT_CONNECTOR_CDP_ENDPOINT = "http://127.0.0.1:9223"
```

設定の正本はOpenAI公式の[Model Context Protocol設定](https://learn.chatgpt.com/docs/extend/mcp#configure-with-configtoml)。

1. `npm install --global gpt-connector`を実行する。
2. 専用Chromeを起動してログインする。
3. `.codex/config.toml`を置いたprojectで新しいCodex taskを開く。
4. `chatgpt_models`でlive catalogを確認する。
5. `chatgpt_chat`を呼ぶ。
6. `keepOpen=true`でsessionを作った場合は、最後に`chatgpt_close`を呼ぶ。

MCP tools:

- `chatgpt_models`: 通常Chat model／effort一覧。
- `chatgpt_chat`: 新規またはsession継続。既定`keepOpen=false`で応答後archive。
- `chatgpt_close`: sessionをarchiveしてhandleを破棄。deleteは行わない。

## model／effort contract

- catalogは毎回公式`/models` runtimeから取得する。
- `is_work_mode_model=true`は通常Chatから除外する。
- model未指定なら公式defaultへ委ねる。
- effort指定時はmodel指定も必須。
- effortは対象modelのlive `thinking_efforts`と完全一致させる。
- 非対応組合せをdefaultへfallbackしない。
- `serviceTier`は別軸で、初期版では指定しない。

## session contract

- session IDはconnector生成のopaque UUID。
- server conversation IDやclient thread IDを含まない。
- sessionはMCP server process memory限定。process再起動後は継続できない。
- 同一sessionへの並行turnは`SESSION_BUSY`。
- one-shotと`chatgpt_close`はserverの`is_archived=true`をread-backしてから成功を返す。
- delete機能はない。

## failure codes

- `AUTH_REQUIRED`
- `CDP_UNAVAILABLE`
- `RUNTIME_DRIFT`
- `MODEL_NOT_AVAILABLE`
- `EFFORT_NOT_SUPPORTED`
- `CHAT_FAILED`
- `STREAM_INCOMPLETE`
- `SESSION_NOT_FOUND`
- `SESSION_BUSY`
- `ARCHIVE_FAILED`

## 秘密情報とログ

- cookie、authorization、access／refresh token、integrity、attestation、conduit tokenを取得・保存しない。
- CDP生dumpを保存しない。
- server conversation IDをtool resultやlogへ出さない。
- prompt／responseをconnector側でlogしない。tool resultにはrequested assistant本文だけを返す。
- `.browser-profile/`、log、temporary dumpはgit管理外。

## architecture

```text
Codex ──stdio MCP──> GptConnector core ──raw CDP──> ChatGPT page main world
                                                       │
                                                       └─ official factory
                                                          → builder
                                                          → sender
                                                          → state getter
```

runtime roleはasset marker、function source signature、object method shape、read-only catalog probeで一意検出する。候補が0件または複数なら実行しない。

## license

MIT
