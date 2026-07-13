# ChatGPT consumer Chat CDP bridge — 静的 discovery

- 出典: ChatGPT desktop app 26.707.51957 のローカル bundle、ローカル process／CDP target 実測
- 取得日: 2026-07-13
- 確度: 高（desktop client 構造）、中（Web 版との共有関係）
- 秘密情報: token、cookie、account id、conversation 本文は取得・保存していない

## 結論

理想順位1「ページ内部の正規 conversation client 呼出し」は、静的構造上は候補が残る。desktop bundle には高水準 send 関数と consumer conversation transport が存在し、request 構築、integrity、conduit token、SSE、conversation state を公式 client に委ねられる。

未解決点は送信関数ではなく、実行中の `AppScope` 取得である。scope は React context 内に保持され、安定した global dispatcher や consumer Chat 専用 Electron IPC は確認できなかった。したがって、React fiber 走査のような内部 UI framework 依存しか使えない場合は、理想順位1の「UI構造非依存」を満たさない可能性がある。

## desktop transport

確認した状態遷移:

1. `prepareIntegrity()` が integrity／attestation 準備を行う。
2. `POST /f/conversation/prepare` が `conduit_token` を返す。
3. `x-conduit-token` と integrity 関連 header を伴って `POST /f/conversation` を開始する。
4. SSE event を conversation state、assistant message、title、完了状態へ反映する。
5. resume 用の `/f/conversation/resume` 入口も存在する。

desktop/native branch は `/ios/attestation_challenge` を扱う。Web 版が同じ client contract を共有するかは、loaded asset の限定観察だけでは確定できなかった。

## 高水準 client

高水準 send flow は user message、model、parent message、conversation id、temporary Chat fields 等を request へ組み立て、completion stream を開始する。stream decode と state 更新も同じ公式 client 系に属する。

この入口を live scope とともに呼び出せれば、composer、送信 button、回答 DOM を使わずに通常 Chat を開始できる可能性がある。ただし minified symbol 名は安定契約ではない。

## Electron bridge と handoff

preload bridge に consumer Chat を直接送信する IPC は確認できない。製品内の handoff は Chat から Work/Codex へ渡す方向が中心であり、Codex 開発枠から通常 Chat へ戻す公開入口にはならない。

## CDP runtime の現状

- 通常利用中の Chrome: remote debugging 無効。
- 稼働中 ChatGPT desktop app: remote debugging 無効。
- `127.0.0.1:9222` の別 Chrome: 接続可能だが ChatGPT page target なし。
- browser extension 経由の page evaluation: isolated world のため main-world の React context／fiber を直接評価できない。

次の調査には、ログイン済みかつ remote debugging 有効な専用 headful Chrome runtime が必要である。

追記: プロジェクト所有・git 管理外の専用 profile で headful Chrome を起動し、`127.0.0.1:9223` の CDP endpoint と `https://chatgpt.com/` の page target を確認した。初回ログインは未実施であり、認証情報は観察していない。

## 優先順位への影響

1. 正規 conversation client 呼出し: 候補維持。live scope の安定取得を次に検証する。
2. CDP Fetch interception: 1が internal framework 依存しか持たない場合に限り進む。
3. 最小 UI trigger＋通信差し替え: 1・2の不成立後のみ進む。

下位方式が簡単に見えても、この順序は変更しない。
