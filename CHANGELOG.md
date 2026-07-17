# Changelog

## 0.4.3 — 2026-07-18

- dead writerの非terminal jobをread-only `sessions`が`JOB_RECOVERY_UNAVAILABLE`へ回収した後、
  `get()`の台帳再読込でraw stateへ巻き戻す問題を修正した。read-only回収は台帳を書き換えない。

## 0.4.2 — 2026-07-18

- 画像生成の`MODEL_RESOLUTION_MISMATCH`へrequested／resolved model・effortを含め、失敗jobを
  `sessions`で回収した時に安全な選択metadataまで診断できるようにした。promptや画像情報は記録しない。

## 0.4.1 — 2026-07-18

- 画像生成だけruntime operation待機上限を180秒から360秒へ延長し、生成画像のdownloadが揃った直後に
  connector側timeoutが先に発火して結果を失う問題を修正した。通常Chatとuploadの上限は変更しない。

## 0.4.0 — 2026-07-17

- ChatGPT通常枠の画像生成を正式機能化し、CLI `image` とMCP `chatgpt_image` を追加した。
- 生成画像はserver conversationの同一turnとLibraryの`origination` metadataを相関し、MIME、byte数、
  dimensions、SHA-256を照合してから256KiB chunkでローカルへ回収する。
- 保存先をabsolute `workspaceRoot` 配下へ限定し、root外symlink、既存file上書き、MIME／拡張子不一致を
  fail-closedで拒否する。複数枚は決定的suffixで保存する。
- 画像jobを既存slug台帳と`sessions`回収へ統合し、会話は成功・失敗ともarchiveする。local保存とdigest
  再検証後、生成元だけをChatGPT LibraryのRecently Deletedへsoft-deleteし、失敗／partialも結果へ明示する。
- 画像jobはrequested model／effortとassistantのresolved metadataの完全一致を必須にし、runtime側の暗黙model
  変更を`MODEL_RESOLUTION_MISMATCH`で拒否する。

## 0.3.1 — 2026-07-14

- live browser launcherがmacOS専用である契約に合わせ、LinuxとWindowsのfactory diagnosticsを
  CDP不備の`not_ready`ではなく`unsupported`として報告するよう修正した。

## 0.3.0 — 2026-07-14

- BugHub factory向けに `gpt-connector factory-diagnostics --json` を追加した。既存
  `gpt-connector.diagnostics.v1` の `doctor` 契約は維持する。
- 明示的な canonical dotagents `collection.enabled: true` の時だけ動く、network I/O を
  持たない product-owned `runtime-errors` local aggregate を追加した。
- runtime error の公開面は固定 code/template と SHA-256 fingerprint のみを使う。prompt、
  応答、添付、識別子、credential、CDP dump、絶対 path、raw error は保存・出力しない。
- true headlessを使わず、cold startでは窓なしで専用profileのheadful Chromeを起動し、CDPで
  ChatGPT targetを最初から最小化状態で作成・確認してからapp readyを待つ`gpt-connector browser start`
  を追加した。既存endpointもapp probeより先に最小化する。現行macOS実測では最小化中も送受信を維持する。
- `gpt-connector browser show`で、正規専用profileの一意ChatGPT windowだけを明示的に表示へ戻せるようにした。認証要求時はstartが同じwindowを表示へ戻してから`AUTH_REQUIRED`を返す。
- window stateのCDP read-backを有界pollにし、非同期遷移直後の旧stateによるfalse failureを防いだ。
- cold startはhidden Chrome・background minimized targetから開始し、最小化確認後に正規PIDだけをunhideしてからprobeする。
- showはCDP stateのstale値に依存せず`Page.bringToFront`を送る。最終状態はWindowServerの正規PID/layer 0 window数で確認する。
