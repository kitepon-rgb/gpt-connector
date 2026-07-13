# ChatGPT native upload runtime contract（sanitized observation）

- 出典: `https://chatgpt.com/cdn/assets/4813494d-l2qppef9tkwaz2nr.js`
- 取得日: 2026-07-13
- 取得方法: 専用Chromeのupload initiator stackからassetを特定。direct fetchした公式静的JSを構造検索し、page runtimeでmodule exportを検査した。
- 確度: 高（公開静的assetと実runtime呼出し）
- 秘密除外: cookie、token、account ID、conversation ID、server file ID、署名付きURL、request／response bodyは保存していない。

## MarkItDown取得記録

- URLを直接渡す方法はASCII誤推定により`UnicodeDecodeError`、出力0 bytesで失敗した。
- `curl`のstdoutを`markitdown -x .js -m text/javascript -c UTF-8`へ渡す方法は4,563,940 bytesを出力した。
- 全assetは巨大かつbuild固有なので保存せず、以下の契約に必要なsanitized抜粋だけを残す。

## 構造契約

- file picker stateは`files$()`と`files$.set(next)`を持つ。
- upload objectは`reset`、`restoreFiles`、`uploadFile`、`createFileCompleted`、`updateProgress`、`uploadCompleted`、`remove`、`removeUserInitiated`、`attachLibraryFile`を持つ。
- text／document向けuse caseは`Retrieval = 3`、upload kindは`my_files`。
- `uploadFile`の主要引数は、state、temporary ID、`File`、use case、image MIME allowlist、intl、toaster、options、product attachment policy、connector metadata。
- optionsは少なくとも`entrySurface`、`selectionMethod`、`isBigPaste`、auth／temporary chat／projectの状態、error callbackを受け取る。

## 公式clientが行う処理

1. 公式`safePost('/files')`でfile entryと署名付きupload URLを取得する。
2. Azure／AWS／Estuary／multipartのstrategyに応じてraw bytesを送る。
3. `safePost('/files/process_upload_stream')`を呼び、SSE progressを処理する。
4. 完了時にfile picker stateを`ready`へ更新し、conversation attachment用のfile specを格納する。

## transport分岐

- small fixture実測は署名付きAzure URLへのsingle PUTだった。
- direct PUTは`Content-Type`とAzure blob headerを組み立て、ChatGPT Authorization／account headerを付けない。署名URLがstorage認可を担う。
- server responseが`direct_azure_multipart`で、有効なpart size／count／concurrencyかつ計算part数2以上の場合だけblock uploadとblock-list commitへ分岐する。これは静的確認で、large file実走はしていない。
- AWS signed URLはqueryに`x-amz-algorithm`があるかで判定し、Azure固有headerを付けない。
- client SHA-256はLibrary保存metadataがtrue、Estuary以外、かつfeature flag有効時だけ計算してprocessing requestへ付加する。small fixtureでは未実走。
- Estuary combined uploadはAuthorizationに加え、workspace cookieがpersonal以外の時だけ`ChatGPT-Account-ID`を付ける。small fixtureはこの分岐を使っていない。
- same-originの`/files`と`/files/process_upload_stream`は公式`safePost`がauth／integrity middlewareを所有する。

## UI非依存probe結果

- bootstrap inline moduleから3つの公式root assetを抽出した。
- 同一origin import graphを9 asset探索し、upload markerを持つmoduleとupload objectを構造シグネチャで一意にした。
- Nodeで読んだ214-byte Markdown fixtureをbase64でpage contextへ渡し、DOM／file inputなしで`File`を構成した。
- 公式`uploadFile`の完了結果は`status=ready`、`progress=100`、`source=local`、server file IDあり、file specあり、error callback 0件だった。
- 実ID値、署名付きURL、file本文は保存していない。
