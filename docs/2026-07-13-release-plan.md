# GPT Connector 0.1.0 リリース計画

作成日: 2026-07-13

## 目的

`gpt-connector` 0.1.0をGitHubとnpmへ公開し、npm公開版をglobal installしてCLI／MCP binの起動を確認する。

## 承認済み公開条件

- GitHub: `kitepon-rgb/gpt-connector`をpublicで新規作成する。
- npm: `gpt-connector@0.1.0`をpublic公開する。
- license: MIT。
- npm tarballへローカル`.codex/config.toml`、test、docs、ragを含めない。

## TODO

- [x] MIT LICENSEとnpm公開metadataを追加する。
- [x] READMEをclone固有の絶対パスから公開利用手順へ直す。
- [x] `files` allowlistで公開物を`dist/src`、README、LICENSEへ限定する。
- [x] lint、typecheck、test、build、`npm pack --dry-run`を通す。
- [x] GitHub public repositoryを作成して`origin`を設定する。
- [ ] 対象pathを明示して初回commitする。
- [ ] `main`をpushしてupstreamを設定する。
- [ ] `gpt-connector@0.1.0`をnpmへpublic publishする。
- [ ] npm registryの公開metadataとtarball内容をread-backする。
- [ ] 公開版をnpm global installし、2つのbinを確認する。
- [ ] リリース計画を完了裁定して`docs/archive/`へ移す。

## 停止条件

- package名またはversionが取得済み。
- tarballに秘密値、ローカル絶対パス、browser profile、調査資料が混入する。
- gateがred。
- GitHub／npm認証または公開read-backに失敗する。
