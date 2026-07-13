# ChatGPT Web consumer client — runtime discovery

- 出典: ログイン済みChatGPT公式Webページのmain world、読込済み公式ES module asset
- 取得日: 2026-07-13
- 確度: 高（runtime export、conversationモデル、active新規送信、公式state応答回収）
- 秘密情報: cookie、token、account id、conversation id、会話本文は取得・保存していない

## 結論

理想順位1「ページ内部の正規 conversation client 呼出し」は、Web版runtimeでも具体的な成立経路が見つかった。公式ES moduleがsubmission builderと高水準senderをexportしており、現在のconversationモデルもmain worldから型形状で取得できる。

既存page conversation modelを使う新規・継続送信に加え、公式factory生成conversationを使うDOM／React fiberなしの新規・2turn継続も成功した。challenge更新、rate limit、Chat枠消費量の直接カウンタ観測は未検証である。

## runtime確認

- 専用headful Chromeをproject所有profileで起動。
- CDP page targetへraw WebSocket接続。
- page内の `/api/auth/session` をstatus／booleanへ即時射影し、HTTP 200と認証済みを確認。
- React fiberは900 DOM element、3,688 fiber nodeで確認。
- desktop版の`AppScope`形状はWeb版fiber内に見つからなかった。
- 一方、`conversation` props形状 `{ctx, id, serverId$, config}` は多数のcomponentで共有されており、現在のconversationモデルを取得できる。

## 公式Web asset

読込済み204 assetを静的照合し、次を確認した。

- `/f/conversation/prepare`
- `/f/conversation`
- `conduit_token`
- `parent_message_id`
- `conversation_origin`

主要export:

- `JY`（内部名`a3n`）: prepare専用。conversation stateからprepare payloadを構築し、`/f/conversation/prepare`を呼ぶ。
- `kF`（内部名`YDr`）: 高水準sender。integrity、parent決定、optimistic state、prepare済みconduit、request、stream完了までを処理する。
- `DP`（内部名`J7t`）: submission builder。conversation、content、mode、selection等からprompt messageとcompletion parametersを構築する。

想定経路は `DP` → `kF`。composerの入力欄、送信button、回答DOMを必要としない可能性がある。

## CDP接続上の罠

Chrome DevTools page targetは`Origin` header付きのWebSocket upgradeを拒否した。loopback raw CDP接続から不要な`Origin` headerを外すと接続できた。認証状態やChatGPT pageの変更とは無関係なtransport条件である。

## 次の検証

承認済みの専用prompt 1件を `DP` → `kF` で新規conversationへ送り、次を確認する。

1. DOM eventなしで送信が開始する。
2. `/f/conversation/prepare` と `/f/conversation` が公式clientから発生する。
3. stream完了とassistant本文をDOM表示以外から回収できる。
4. conversationが通常Chat履歴として保存される。

## active probe 1

承認済みprobe文1件を、同一page main world内で `DP` → `kF` の順に実行した。

- preflight: 新規conversation、server id未発行、mode `primary_assistant`。
- builder: user roleのprompt messageとcompletion parametersを正常構築。
- sender: `eventSource: "url"` で例外なくstream完了までresolve。
- response: 公式state getter `Jjt/Sh` と `Bjt.getLastAssistantMessage` から取得。
- completion: `finished_successfully`、`end_turn=true`。
- assistant text: `BRIDGE_OK`（完全一致）。
- UI依存: composer、送信button、回答DOMを使用していない。
- 履歴: server conversationとして作成。
- 後始末: 公式API client `safePatch` で`is_archived: true`。delete未実施。

CDP Network observerはpath filterのprefix仮定が誤っており、endpoint event順を取り逃した。公式stateによる応答回収は成功したが、Network観測成功としては扱わない。再送は行わなかった。

## active probe 2・3 — 継続とNetwork順序

同一conversationを一時unarchiveし、`DP` → `kF`で継続した。

- probe 2: `CONTINUE_OK`、`finished_successfully`、`end_turn=true`。
- probe 3: `NETWORK_OK`。公式stateとSSE response bodyで一致。
- endpoint順: `/f/conversation` request → HTTP 200 SSE → `/f/conversation/prepare` request → stream finished → prepare HTTP 200 JSON → prepare finished。
- 解釈: 既存conduitを現在turnに使い、完了後に次turn用conduitをprepareする。
- 後始末: conversationを再archive。delete未実施。

## 反証 — fiberなし新規conversation

公式export `_gt/TT(clientThreadId)` と `Hjt.initThread(...)` だけでlocal conversationを作り、DOM・fiberなしで `DP` → `kF` を試した。

- server id signalとlocal assistant placeholderは作成された。
- assistant本文、status、end_turnは確定しなかった。
- server read-backはaccess拒否。
- archiveは`Conversation not found`。
- local threadを公式storeから削除し、一時page参照を破棄した。

この組合せだけでは標準new-conversation lifecycleを再現できない。原因はplain UUIDが公式client ID契約を満たさず、server IDとして扱われた可能性が高い。

## 公式factoryによる完全UI非依存経路

標準new-conversation呼出し元を逆引きし、次を特定した。

- `ggt/Vgt`: conversation factory。
- `cMt/yh`: 公式client ID generator。`WEB:`系IDを作る。
- `Hjt.initThread`: thread initializer。

このfactoryを使い、DOM・React fiberを一切参照せず factory → initThread → `DP` → `kF` を実行した。

- 単発probe: `FACTORY_OK`、`finished_successfully`、`end_turn=true`。
- 同一conversation turn 1: `FACTORY_CHAIN_1`、完全一致・完了。
- 同一conversation turn 2: `FACTORY_CHAIN_2`、完全一致・完了。
- transport: `/f/conversation` HTTP 200 SSE、完了後 `/f/conversation/prepare` HTTP 200 JSON。
- response: 公式state getterとmessage tree APIから回収。
- cleanup: server `is_archived=true`をread-backで確認。delete未実施。

結論として、理想順位1は新規作成・継続・応答回収まで完全UI非依存で成立する。ただし非公開・minifiedな内部exportとasset hashへ依存するため、正規の安定APIではない。
