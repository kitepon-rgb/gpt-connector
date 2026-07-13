# gpt-connector production native attachment E2E

- 出典: `gpt-connector` production coreのローカル実ブラウザ実行
- 取得日: 2026-07-13
- 確度: 高（専用Chrome、固定fixture、server read-back、terminal台帳の実測）
- 秘密衛生: cookie、token、account ID、conversation ID、server file ID、署名URLは保存していない

## 実行条件

- fixture: `test/fixtures/native-attachment/probe.txt`
- model: `gpt-5-6-thinking`
- effort: `extended`
- `keepOpen=false`
- ローカルbytesは256KiB chunkでCDP page contextへ転送
- page contextでSHA-256を再計算し、公式upload objectを呼び出した
- DOM selector、file input、座標操作、prompt本文展開、Oracle/API fallbackは未使用

## 結果

- job state: `succeeded`
- fixture marker完全一致: true
- resolved model: `gpt-5-6-thinking`
- resolved effort: `extended`
- server attachment read-back: 1件
- name: `probe.txt`
- MIME: `text/plain`
- conversation archive read-back: true
- retention: `unknown`
- cleanup: `not_supported`
- error: null

## slug／再起動回収

terminal台帳を一時state directoryへatomic保存し、新しい`GptConnector` instanceから同じslugを読み直した。

- reloaded state: `succeeded`
- 同slug／同fingerprintの再consult: `succeeded` snapshotを返却
- `updatedAt`不変: true
- 応答marker不変: true
- 再consult所要: 525ms
- 再upload／再conversation: 実行しない分岐を通過

非terminal jobはstore単体testで、process再起動時に`failed`／`JOB_RECOVERY_UNAVAILABLE`へ固定し、自動再送しないことを確認した。

## asset discovery修正

初回production E2Eは、asset import graphに未走査queueが残ること自体をdrift扱いし、800件上限で送信前停止した。read-only診断では、初期315候補、393件走査時点でcore／conversation／upload各1件、残queue 2,081件だった。

ChatGPT全体の無関係graph完走はrole一意性の必要条件ではないため、探索上限800内で各roleが1件であることを要求し、queue残存だけでは失敗しないよう修正した。import後もbridgeがsender／builder／upload objectの構造一意性を再検証する。

## cleanup

- 成功conversationはarchive済み。
- upload済みfileは削除手段未成立のため、削除済みとは扱わない。
- E2E専用の一時state directory 2件は削除済み。

## 複数添付追試

- fixture: `probe.txt`、`probe.md`
- model／effort: `gpt-5-6-thinking`／`standard`
- server attachment read-back: 2件
- 添付名順: `probe.txt`→`probe.md`で一致
- MIME順: `text/plain`→`text/markdown`で一致
- モデル回答: 各fixtureの固定識別子が指定順に完全一致
- archive: true
- retention: unknown
- cleanup: not_supported
- DOM selector、file input、座標操作、prompt本文展開、Oracle/API fallback: 未使用
- 一時state directory: 実行終了時に削除

## npm配布物追試

- npm tarball: 54 entries、`dist/src`、README、LICENSE、package metadataだけを収録
- 隔離prefixへのglobal install: 成功
- CLI version: package versionと一致
- stdio MCP: 6 toolsを列挙
- offline sessions: terminal resultをCDP接続・再送なしで回収
- consult dry-run: 2添付を解決し、upload／conversationとも未実行
- diagnostics: version一致、upload／operation 0
- 初回は試験側がstate directoryを`0755`で作成したため、owner-only検査が意図どおり拒否した。directory作成を製品へ任せた再試験で成功した。

## 独立反証と修正

独立refuterに、添付順序、slug再送防止、fallback不在の3主張を反証させた。初回の古い差分に基づく2指摘は現行実装照合で撤回されたが、再読込後に次の2反例が成立した。

- live writer中に初期化したobserverが、writerのterminal永続化後も古い非terminal snapshotを返す。
- 同一writerの複数active jobで、最初のterminalがglobal leaseを解放し、残jobのtransitionを失敗させる。

status／同slug reserveの台帳再読込、最後の非terminal jobまでのlease保持、既所有leaseでの追加reserve時のin-memory台帳維持を実装した。直接回帰testと全59 testsを通し、refuterの再反証では両反例とも不成立、新しい成立指摘なしとなった。

## Oracle同条件shadow

- 比較条件: 同一prompt、`probe.txt`→`probe.md`、各製品1回、実添付、成功時archive
- gpt-connector: 成功。両識別子の順序、server attachment 2件、model／effort、archiveを確認
- Oracle: 0.16.0、browser engine、attachments always、model strategy ignore、archive auto
- Oracle結果: `Attachments did not finish uploading before timeout`でChat応答前にerror
- Oracle失敗後: 再送せず、正規化後sessionとローカルlogからerrorを回収
- 比較上の裁定: 今回の1試行では、OracleのUI依存attachment経路が失敗し、gpt-connectorのofficial runtime attachment経路は成功した。1試行だけで一般的成功率は推定しない。

## 代表matrixと15件添付

| case | files | effort | 結果 |
|---|---:|---|---|
| no-file | 0 | standard | 固定marker、attachment 0、read-back、archive成功 |
| single | 1 | extended | 固定marker、name／MIME、archive成功 |
| multi | 2 | standard | 2 marker／name／MIMEの順序、archive成功 |
| same-name | 2 | max | 同名`same.txt` 2件を内部identityとmarker順で識別、74.9秒、archive成功 |
| batch | 10 | standard | 10 marker／name／MIMEの順序、48.0秒、archive成功 |

- 正規添付実走合計: 15件
- 誤送信: 0
- prompt混線: 0
- file取り違え: 0
- archive漏れ: 0
- requested／resolved model・effort不一致: 0
- retention／file delete: 引き続きunknown／not_supported

## PNGと全file pass-through追補

- production `consult`で22,427 bytesの自作PNGを`image/png`として正規添付した。
- server read-backは`visual-marker.png` 1件、モデル回答は`MARKER 7Q4M`と厳密一致。
- requested／resolvedは`gpt-5-6-thinking`／`extended`、conversation archive、bridge残存0。
- resolverのfile type allowlistとUTF-8 decodeを除去した。
- known extensionは標準MIME、unknown extension／拡張子なしは`application/octet-stream`。
- known text、known image、unknown extensionのproduction dry-runでbytes／MIME／SHA-256一致、upload／conversation未実行を確認。
- 全62 tests、lint、typecheck、build、diff checkがgreen。
- pass-through可能であることは、公式runtimeがfile内容を解釈できる保証ではない。

## 0.2.0 release candidate配布物

- tarball: 54 entries、50,395 bytes、unpacked 220,747 bytes。
- 内容: `dist/src`、README、LICENSE、package metadataだけ。
- 除外確認: docs、RAG、tests、fixtures、research scripts、state、browser profile。
- credential形、local absolute path、private key形のscan: 0件。
- 隔離prefix global形式install: 成功。
- CLI: `0.2.0`。
- doctor: ready、session／operation／upload／buffered bytes／job 0。
- stdio MCP: `chatgpt_models`、`chatgpt_chat`、`chatgpt_close`、`consult`、`sessions`、`diagnostics`の6 tools。

## 0.2.0公開結果

- npm public publish: 成功、`latest=0.2.0`。
- registry shasum／integrity: 検証tarballと完全一致。
- 初回publish: 隔離展開物をESLintが走査し、prepublishで42 errors。公開前停止とregistry未公開を確認。
- 根本修正: `.gpt-connector-tmp/**`をESLint ignoreへ追加し、展開物を残したまま62 tests／lint／typecheck／buildを通して再publish。
- global install: `/opt/homebrew/bin/gpt-connector`、version `0.2.0`。
- global doctor: ready、bridge／job count 0。
- global stdio MCP: 6 tools。
- global consult dry-run: known text、PNG、unknown extensionのMIME／bytes／SHA-256一致、upload／conversation未実行。
