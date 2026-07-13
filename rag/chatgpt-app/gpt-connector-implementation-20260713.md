# GPT Connector 実装・実ブラウザ検証

- 出典: projectのlocal source／test、専用Chromeの実browser smoke
- 実施日: 2026-07-13
- 確度: 高（CLI／MCP one-shot、MCP 2turn、model／effort、archive）
- 秘密情報: cookie、authorization、token、attestation、conduit値、server conversation IDは取得・保存していない

## 実装結果

理想順位1「page内部の正規conversation client呼出し」をcore、CLI、stdio MCP adapterとして実装した。方式2・3は実装していない。

主要構成:

- loopback限定raw CDP client。
- official ChatGPT page target／auth boolean gate。
- loaded asset marker classificationとSHA-256 fingerprint。
- function source signature／object method shape／read-only `/models` probeによるrole discovery。
- official factory、thread initializer、submission builder、high-level sender、state getter、message tree API、API clientを束ねるpage bridge。
- bridge source hash由来`buildId`によるstale bridge拒否。
- page内operation stateとNode側polling。
- opaque process-memory session registry。
- model／effort fail-closed validation。
- server archive read-back。

## 0.2.0追加実装

- DOM／file inputなしの公式runtime native attachment。
- workspaceRoot相対path／glob、realpath boundary、秘密filename denylist、20 files／20MiB per file／64MiB total。
- 全regular fileのbyte pass-through。known extensionは標準MIME、unknown extensionは`application/octet-stream`。
- 256KiB CDP chunk転送、page側SHA-256再照合、server attachment read-back。
- caller既知slugによるdurable consult job、同fingerprint再送防止、process再起動後のterminal回収。
- owner-only atomic state、writer lease、非terminal再起動時の`JOB_RECOVERY_UNAVAILABLE`固定。
- upload／conversationを作らないdry-runとread-only diagnostics。
- PNGの正規upload、server read-back、固定visual marker認識、model／effort、archiveをproduction `consult`で実証。

## 公開surface

CLI:

- `models`
- one-shot `chat`
- durable `consult`
- offline `sessions`
- `doctor`／`diagnostics`
- `--version`

MCP:

- `chatgpt_models`
- `chatgpt_chat`
- `chatgpt_close`
- `consult`
- `sessions`
- `diagnostics`

CLIは短命processのためsession継続を装わない。複数turnは長寿命MCP process内だけで提供する。

`consult`はCLI timeout後もdurable jobとして回収できる。`sessions`はCDP接続や再送なしでexact slug 1件を返す。

## 0.1.0公開結果

- GitHub: `kitepon-rgb/gpt-connector`をpublic公開。
- npm: `gpt-connector@0.1.0`をMIT License、dist-tag `latest`でpublic公開。
- npm tarball: 45ファイル、24.7 kB。`dist/src`、README、LICENSE、package metadataだけを収録し、`.codex`、test、docs、rag、ローカル絶対パスは除外。
- npm global install後の`gpt-connector models`で既定`gpt-5-5`／通常Chat 17モデルを取得。
- global `gpt-connector-mcp`へMCP SDK clientで接続し、`chatgpt_models`、`chatgpt_chat`、`chatgpt_close`を列挙。

## 0.2.0 release gate

- unit／characterization: 62件green。
- lint、typecheck、build、diff check: green。
- production `consult`でtext複数添付、同名、10件batch、PNG visual markerを実証。
- requested／resolved model・effort、server attachment read-back、archive、bridge残存0を確認。
- known text／imageとunknown extensionのdry-runでMIME、bytes、SHA-256を確認。
- `0.2.0` tarballは54 entries、50.4 kB。`dist/src`、README、LICENSE、package metadataだけを収録。
- 隔離prefix install後、CLI `0.2.0`、doctor ready／bridge count 0、stdio MCP 6 toolsを確認。
- npm `gpt-connector@0.2.0`をpublic公開。`latest=0.2.0`、registry shasum／integrityは検証tarballと一致。
- `/opt/homebrew/bin/gpt-connector`へglobal installし、CLI `0.2.0`、doctor ready、MCP 6 toolsを確認。
- global `consult --dry-run`でknown text、PNG、unknown extensionのMIME／bytes／SHA-256一致、upload／conversation未実行を確認。
- 初回publishは隔離展開物をESLintが走査してprepublish停止。`.gpt-connector-tmp/**`を正規ignoreへ追加し、展開物を残したfull gate後に公開成功。失敗時点でregistry未公開もread-backした。

## 0.1.0実測

- unit／characterization: 23件green。
- lint、typecheck、build: green。
- CLI models: 既定`gpt-5-5`、通常Chat 17モデル、configurable effort 6モデル。
- CLI one-shot: `CONNECTOR_OK`、`gpt-5-6-thinking`、`min`、完了・archive。
- core 2turn: `SESSION_ONE`→`SESSION_TWO`、model／effort維持、explicit close archive。
- MCP one-shot: tool discovery 3件、`MCP_OK`、model／effort一致、archive。
- MCP 2turn: `MCP_SESSION_ONE`→`MCP_SESSION_TWO`、`chatgpt_close` archive。
- 最終bridge: `FINAL_IMPL_OK`、archive後session 0／operation 0。
- invalid model: `MODEL_NOT_AVAILABLE`、session 0／operation 0。conversation factory未実行。

全active probeはarchive済み。delete未実施。

## 反証で見つけた修正

1. api client候補が2件あった。export順で選ばず、read-only`/models` catalog契約が成功する候補を一意選択した。
2. thread getter候補にroute判定関数が混ざった。arity 1かつ単純`state.threads[key]` lookupへ限定した。
3. model validation前にsessionを作っていた。validation後に公式factoryを呼ぶ順序へ変更した。
4. Chat失敗後のarchive失敗を空catchしていた。cleanup不確実は`ARCHIVE_FAILED`で明示するよう変更した。
5. MCP初回接続失敗Promiseを保持していた。次toolで正規再接続できるよう、失敗時にlazy promiseを破棄した。
6. bridge versionだけでは古い同version sourceを再利用した。source hashの`buildId`完全一致を追加した。
7. `querySelectorAll`を使ったasset列挙を除去し、headのresource declarationをselectorなしで読むよう変更した。

## toolchainの罠

- TypeScript 7.0.2は`typescript-eslint@8.63.0`のpeer範囲外。TypeScript 6.0.3へ固定した。
- pnpm 11.12のbuild許可は`pnpm-workspace.yaml`の`allowBuilds`を使う。
- `pnpm ignored-builds`はplaceholderを設定ファイルへ追記し、既存`allowBuilds`と重複させ得る。
- `tsx -e`はCJS output扱いでtop-level awaitを拒否する。async IIFEで包む。

## 残余リスク

- private/minified Web runtime依存。
- asset／schema／integrity drift。
- accountやmodel entitlement変更。
- MCP processの強制終了時はopen sessionのarchiveを保証できない。通常終了signalではshutdown archiveを試みるが、利用側は`chatgpt_close`を正規契約とする。
- CDP Fetchの一回限りの故障注入で、`/api/auth/session`の未認証応答は`AUTH_REQUIRED`、サーバーへ送らない空の完了SSEは`STREAM_INCOMPLETE`になることを実ブラウザ確認した。後者の終了後はpage内session 0／operation 0。
- 最初のstream注入はURL patternを狭く仮定したため一致せず、通常送信が1件成功した。one-shot archiveとsession／operation 0を確認後、prefixを固定しないpattern＋URL pathnameの厳密判定へ直して再実行した。
- challenge refreshとrate limitは忠実な人工再現を行っていない。自然発生時の再検証事項である。
- consumer `/f/conversation`通信とCodex App Server非経由は観測済みだが、Chat／Codexの直接quota counterは公開観測できず、枠増減自体は未確認。

## 公式資料

- MCP TypeScript SDK v1.29.0を採用。公式repositoryはv2 pre-alpha期間中、productionにv1.xを推奨している。
- Codex project-scoped MCP設定は`.codex/config.toml`の`[mcp_servers.<name>]`を使用する。npm global installでは`command = "gpt-connector-mcp"`とする。
