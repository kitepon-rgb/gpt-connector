# AI installer向けセットアップ契約 実施プラン

## 目的

AI installerがREADMEから必要な手順を判断し、人間にはChatGPTへの手動ログインだけを依頼して、`gpt-connector`を再現可能かつ安全に導入できるようにする。

## 範囲

- AI installer向けの前提、手順、人間の操作点、完了条件、禁止事項、復旧方法を文書契約として固定する。
- READMEから契約へ到達できる入口を追加する。
- npm packageからも契約本文を読めるよう、公開allowlistへ契約ファイル1件だけを追加する。
- CLI、Chrome起動処理、MCP実装、version、npm registryは変更しない。

## TODO

- [x] `docs/ai-installer-setup-contract.md`を追加する。
- [x] READMEのinstall手順から契約へリンクする。
- [x] npm tarballへ契約ファイルだけを追加する。
- [x] 文書内コマンド、リンク、差分、既存project gateを検証する。
- [x] 完了後、このプランを`docs/archive/`へ退避する。

## 検証結果

- `git diff --check`: 成功。
- `npm pack --dry-run --json`: 55 entries、`docs/`配下は`docs/ai-installer-setup-contract.md`の1件だけ。
- `pnpm check`: lint、typecheck、62 testsすべて成功。
- npm publish、version変更、global install、commit、pushは実施していない。
