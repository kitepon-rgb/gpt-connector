# GPT Connector

[![npm version](https://img.shields.io/npm/v/gpt-connector.svg)](https://www.npmjs.com/package/gpt-connector)
[![license](https://img.shields.io/npm/l/gpt-connector.svg)](LICENSE)

Codex開発枠から、ログイン済みChatGPT公式Web runtimeの通常Chatを呼び出すローカルconnector。

ブラウザは認証・integrity・attestation・conversation lifecycleの実行環境として使う。composer、送信button、回答DOM、React fiberは操作・参照しない。

> [!WARNING]
> consumer Chatの非公開Web runtimeとminified bundleに依存する実験的実装。OpenAIの公開・安定APIではない。bundle contractが変わった場合は`RUNTIME_DRIFT`で停止し、別方式へ自動fallbackしない。

現在版は[`gpt-connector@0.3.0`](https://www.npmjs.com/package/gpt-connector)。ソースと変更履歴は[GitHub repository](https://github.com/kitepon-rgb/gpt-connector)を正とする。

## 成立済み機能

- 通常Chatのone-shot送信と自動archive。
- process内opaque sessionによる複数turn継続。
- explicit closeとserver archive read-back。
- live model catalog取得。
- model／thinking effort明示選択。
- Work-only modelの除外。
- 非対応model／effortの送信前拒否。
- 全regular fileのChatGPT正規添付。known extensionは標準MIME、unknown extensionは`application/octet-stream`。
- workspaceRoot境界、glob、MIME、size、秘密file denylistの送信前検証。
- 256KiB CDP chunk転送とpage側SHA-256照合。
- server attachment metadata read-backとモデル読取確認。
- caller既知slugによるconsult冪等性、terminal result回収、owner-only durable job台帳。
- upload／conversationを作らないdry-run、既存diagnostics、factory diagnostics。
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
true headlessは使わず、cold startでは窓なしで専用profileのheadful Chromeを起動する。CDP browser endpointからChatGPT targetを最初から最小化状態で作成し、最小化を確認してからapp readyを待つ。既存endpointではapp probeより先に専用ChatGPT windowを最小化する。現行macOS実測では最小化中も送受信を維持する。

Chromeのhidden状態はflashを覆うcold準備中だけに使い、最小化確認後は正規PIDだけをunhideしてからprobeする。hiddenのまま運用せず、Oracleのhide fallbackでもない。

`browser start`が成功を返す時点では専用ChatGPT windowは最小化済みである。認証が必要になった場合だけwindowを表示へ戻す。手動でログイン／確認するには次を使う。

window stateのCDP read-backは遷移直後の旧stateを単発判定せず、有界時間内に期待stateへ収束したことを確認する。

ChromeのCDPはshow後も最小化状態を返すことがあるため、表示／非表示の最終判定は正規PIDのWindowServer layer 0 window数で行う。start成功時は0、show成功時は1件以上である。
実機では同時cold startが`started` 1件／`already_ready` 1件へ収束し、新規専用Chrome PIDで15秒・10ms監視中のlayer 0 on-screen最大値は0だった。`models`とchat（`ACCEPTED_NO_FLASH_OK`）の後も0を維持し、show→startは0→1→0を確認した。

```bash
gpt-connector browser show
```

Chrome更新時はrelease smokeとして`browser start`、`models`、最小化中の`chat`、必要時の`browser show`を確認する。

```bash
gpt-connector browser start
```

初回だけ、開いた専用ChromeでChatGPTへ手動ログインする。connectorはpassword、cookie、tokenを読み出さない。

### AI installer向けセットアップ

CodexなどのAIが導入する場合は、[AI installer向けセットアップ契約](docs/ai-installer-setup-contract.md)に従う。AIはinstall、専用Chrome起動、read-only診断、MCP設定を担当し、人間には専用ChromeでのChatGPTログインだけを依頼する。通常ChromeやOracleのprofile、認証情報は使用しない。

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

CLIの`chat`はone-shot専用。`consult` jobはdurable台帳へ残るため、別processの`sessions`から回収できる。複数turnの会話sessionはMCP adapterを使う。

正規添付のdry-run:

```bash
gpt-connector consult \
  --endpoint http://127.0.0.1:9223 \
  --workspace-root "$PWD" \
  --file 'docs/*.md' \
  --prompt '添付資料を監査してください' \
  --slug review-001 \
  --model gpt-5-6-thinking \
  --effort extended \
  --dry-run
```

`--dry-run`を外すと、検証済みbytesをChatGPTへ正規添付して通常Chatへ送る。caller timeout後は同じconsultを作り直さず、次で回収する。

```bash
gpt-connector sessions --slug review-001
```

read-only診断:

```bash
gpt-connector doctor
gpt-connector --version
```

`doctor`は`gpt-connector.diagnostics.v1` JSONを返します。接続可能なら`overall: "ready"`、CDPや認証などが未準備なら`overall: "not_ready"`と安定`reasonCode`をstdoutへ返し、exit codeは非0です。診断はuploadや会話作成を行いません。

## BugHub factory 契約

既存の `doctor` と別に、factory consumer 用の versioned read-only JSON を提供します。

```bash
gpt-connector factory-diagnostics --json
gpt-connector runtime-errors diagnostics --json
gpt-connector runtime-errors snapshot --after-cursor 0 --limit 256 --json
```

`factory-diagnostics` は package version、既存 diagnostics schema、overall、consult job の
state/job schema と migration、CDP、official origin、auth、runtime bridge、stdio MCP contractを
固定 check ID で返します。Chrome/CDP/auth が未準備なら `not_ready`、live connector を提供しない
host は `unsupported`、検査できない項目は `unverified` です。いずれも upload、conversation、archive、
job 作成を行いません。

`runtime-errors` は product-owned local aggregate であり、network I/O は実装しません。canonical
dotagents factory config（POSIX: `~/.config/dotagents/factory-reporter.json`、Windows native:
`%LOCALAPPDATA%\\dotagents\\factory-reporter\\config.json`）が厳密な JSON shape で
`collection.enabled: true` の場合だけ collection を開始します。設定なし・不正設定・
`reporting.enabled`・token/credentialの存在は collection を有効にしません。既定はOFFです。

公開操作はすべて `--json` 必須です。

```bash
gpt-connector runtime-errors snapshot --json
gpt-connector runtime-errors diagnostics --json
gpt-connector runtime-errors ack 12 --json
gpt-connector runtime-errors resolve <sha256-fingerprint> --json
gpt-connector runtime-errors reopen <sha256-fingerprint> --json
gpt-connector runtime-errors compact --json
```

recordは固定 code/template、SHA-256 fingerprint、count、first/last seen、status、cursorだけを持ちます。
ack cursor は単調で、compact は retention を過ぎた resolved かつ ack 済み recordだけを削除します。
stateは製品所有directoryへ owner-only atomic writeし、symlink・権限 drift・schema改ざんを拒否します。
prompt、assistant response、file名/内容/digest、conversation/session/job ID、cookie/token、CDP dump、
絶対path、生stack/stderrは入力・保存・出力できません。

## Codex MCP

Codexはtrusted projectの`.codex/config.toml`を読み、stdio serverは`command`と`env`で構成できる。npm global install後は、利用するprojectへ次の設定を置く。

```toml
[mcp_servers.gpt_connector]
command = "gpt-connector-mcp"
startup_timeout_sec = 20
tool_timeout_sec = 240
enabled = true
required = false
enabled_tools = ["chatgpt_models", "chatgpt_chat", "chatgpt_close", "consult", "sessions", "diagnostics"]

[mcp_servers.gpt_connector.env]
GPT_CONNECTOR_CDP_ENDPOINT = "http://127.0.0.1:9223"
# 任意。未指定時は $XDG_STATE_HOME/gpt-connector、
# XDG_STATE_HOME未設定時は ~/.local/state/gpt-connector
GPT_CONNECTOR_STATE_DIR = "/absolute/product-owned/state/gpt-connector"
```

設定の正本はOpenAI公式の[Model Context Protocol設定](https://learn.chatgpt.com/docs/extend/mcp#configure-with-configtoml)。

1. `npm install --global gpt-connector`を実行する。
2. 専用Chromeを起動してログインする。
3. `.codex/config.toml`を置いたprojectで新しいCodex taskを開く。
4. `chatgpt_models`でlive catalogを確認する。
5. second opinionはcaller既知slugを付けて`consult`を呼ぶ。
6. timeout時は再送せず、同じslugを`sessions`へ渡す。
7. 既存互換の複数turnで`keepOpen=true`を使った場合は、最後に`chatgpt_close`を呼ぶ。

MCP tools:

- `chatgpt_models`: 通常Chat model／effort一覧。
- `chatgpt_chat`: 新規またはsession継続。既定`keepOpen=false`で応答後archive。
- `chatgpt_close`: sessionをarchiveしてhandleを破棄。deleteは行わない。
- `consult`: slug冪等化、任意の正規添付、model／effort、dry-runを持つsecond opinion入口。
- `sessions`: exact slug 1件の状態／terminal resultを返す。uploadや会話を作らず、connector未起動時は台帳を直接読む。
- `diagnostics`: 接続、bridge build、job／session／operation／upload buffer件数だけを返すread-only診断。

移行期間にCodex側のMCP server idを`oracle`へすれば、tool名は`oracle.consult`／`oracle.sessions`になる。別adapter packageやOracleへの自動fallbackは使わない。

## attachment contract

- `workspaceRoot`はabsolute directory、`files`はそこからのrelative pathまたはglob。
- spec順、glob内POSIX path順、realpath first occurrenceで決定的に解決する。
- absolute file path、`..`、root外symlink、directory、empty fileを拒否する。
- regular fileは形式を問わず元bytesのまま公式uploadへ渡す。一般的なtext、image、PDF、Office、archive、audio、videoには標準MIME、未知拡張子には`application/octet-stream`を使う。localで内容解析・変換は行わず、ChatGPTが解釈できる形式かは公式runtimeが判断する。
- 最大20 file、20MiB/file、64MiB total。
- `.env*`、key／certificate、credential／secret名など明白な秘密fileをoverrideなしで拒否する。
- ChatGPTへ渡すのはbytes、basename、MIMEだけ。ローカルabsolute pathはpage contextやtool resultへ渡さない。
- upload済みfileの削除手段は未成立。結果は`retention=unknown`、`cleanup=not_supported`と返し、archiveをfile cleanupとは表現しない。
- OpenAI公式は一般的なtext、spreadsheet、presentation、documentを対応対象として例示する一方、`.gdoc`は非対応としている。pass-through可能であることは、モデルが内容を解釈できる保証ではない。

詳細は[`docs/native-attachment-contract.md`](docs/native-attachment-contract.md)。

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

`consult` jobは別契約:

- callerが`^[a-z0-9][a-z0-9._-]{2,63}$`のslugを事前指定する。
- 同slug／同fingerprintは既存snapshotを返し、再upload／再送しない。
- 同slugへ異なるinputは`JOB_CONFLICT`。
- stateは`queued | uploading | submitted | running | succeeded | failed`。
- terminal jobはowner-only JSONへatomic保存し、process再起動後も`sessions`で回収できる。
- 再起動前の非terminal jobは完了有無を断定せず`JOB_RECOVERY_UNAVAILABLE`へ固定し、自動再送しない。

## failure codes

- `INVALID_INPUT`
- `AUTH_REQUIRED`
- `CDP_UNAVAILABLE`
- `RUNTIME_DRIFT`
- `MODEL_NOT_AVAILABLE`
- `EFFORT_NOT_SUPPORTED`
- `FILE_NOT_FOUND`
- `FILE_OUTSIDE_ROOT`
- `SENSITIVE_FILE_BLOCKED`
- `FILE_TYPE_NOT_SUPPORTED`
- `FILE_EMPTY`
- `FILE_LIMIT_EXCEEDED`
- `UPLOAD_FAILED`
- `UPLOAD_TIMEOUT`
- `ATTACHMENT_READBACK_FAILED`
- `CHAT_FAILED`
- `STREAM_INCOMPLETE`
- `SESSION_NOT_FOUND`
- `SESSION_BUSY`
- `ARCHIVE_FAILED`
- `JOB_NOT_FOUND`
- `JOB_CONFLICT`
- `JOB_RECOVERY_UNAVAILABLE`

## 秘密情報とログ

- cookie、authorization、access／refresh token、integrity、attestation、conduit tokenを取得・保存しない。
- CDP生dumpを保存しない。
- server conversation IDをtool resultやlogへ出さない。
- prompt、file本文、absolute pathをlogやjob台帳へ保存しない。
- terminal assistant responseはcaller timeout後の回収に必要なため、fingerprint／状態／結果とともにowner-only job台帳へ保存する。
- job台帳は製品所有state directoryに置き、他ツールの管理directoryやhookへ便乗しない。
- `.browser-profile/`、log、temporary dumpはgit管理外。

## architecture

```text
Codex ──stdio MCP──> resolver／job store ──> GptConnector core ──raw CDP──> ChatGPT page main world
                            │                                      │
                            └─ slug status                         ├─ official upload client
                                                                   ├─ builder／sender
                                                                   └─ state／server read-back
```

runtime roleは上限付きasset import graph、function source signature、object method shape、read-only catalog probeで一意検出する。候補が0件または複数なら実行しない。DOM selector、file input、React fiber、座標操作は本番経路に含まない。

## license

MIT
