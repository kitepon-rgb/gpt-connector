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
- [x] 対象pathを明示して初回commitする。commit: `97b1884`。
- [x] `main`をpushしてupstreamを設定する。GitHub read-backも同一commitを確認した。
- [x] `gpt-connector@0.1.0`をnpmへpublic publishする。dist-tagは`latest`。
- [x] npm registryの公開metadataと45ファイルのtarball内容をread-backする。
- [x] 公開版をnpm global installし、CLIのlive model取得とMCP 3 tools列挙を確認する。
- [x] リリース計画を完了裁定して`docs/archive/`へ移す。

## 完了結果

- GitHub public repositoryの`main`へ初期実装と公開実績をpushした。
- npm registryで`gpt-connector@0.1.0`、dist-tag `latest`、MIT、45ファイルのtarballをread-backした。
- npm global installした公開版でlive model catalogとMCP 3 toolsを確認した。
- コード・公開物・文書の最終gateはgreen。

## 停止条件

- package名またはversionが取得済み。
- tarballに秘密値、ローカル絶対パス、browser profile、調査資料が混入する。
- gateがred。
- GitHub／npm認証または公開read-backに失敗する。
