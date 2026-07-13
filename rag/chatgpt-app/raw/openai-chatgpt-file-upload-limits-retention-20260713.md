# OpenAI公式 ChatGPT file upload limits／retention

- 出典1: https://help.openai.com/en/articles/8983675
- 出典2: https://help.openai.com/en/articles/8555545-uploading-images-and-files-in-chatgpt
- 出典3: https://help.openai.com/en/articles/20001052-library
- 取得日: 2026-07-13
- 取得方法: OpenAI Help Centerをweb取得。`MarkItDown <URL>`は403で0 bytesだったため、取得失敗を確認したうえでweb取得へ切り替えた。
- 確度: 高（OpenAI公式。ただしplan／rollout／peak時制限は変動し得る）

## 対応file type

- text、spreadsheet、presentation、documentの一般的な拡張子を対応対象とする。
- 例示はXLSX、XLS、CSV、TSV、DOCX、PPTX、PDF、TXT。
- `.gdoc`は非対応で、PDFやDOCX等へのexportが案内されている。

2026-07-13に公式Help Centerを再確認し、上記カテゴリと例示が維持されていることを確認した。gpt-connectorはこの一覧をlocal allowlistには使わず、known extensionへ標準MIMEを付け、unknown extensionを`application/octet-stream`で公式runtimeへ渡す。これはtransport対応であり、公式に挙げられていないarchive、audio、video、unknown binaryの内容解釈を保証しない。

production dry-runでは、known textを`text/markdown`、known imageを`image/png`、拡張子なしfileを`application/octet-stream`として解決し、bytesとSHA-256を返した。`uploadWouldRun=false`、`conversationWouldRun=false`を確認した。

## size／usage limit

- ChatGPT conversation／GPTともhard limitは512MB/file。
- text／documentは2M tokens/file。spreadsheetはこのtoken上限の対象外。
- CSV／spreadsheetは行サイズ等により約50MB。
- imageは20MB/image。
- FAQ取得時点では80 files/3 hours、Freeは3 uploads/day。peak時に引き下げ得る。
- failed uploadもrolling upload-rate capへ数えられる場合がある。
- user／organization storage capがあり、UIで残rolling quotaは表示されない。

## retention／delete

- FAQはfileが対応chatのretentionに紐づくと説明する。
- 新しいLibrary記事は、upload／生成fileをLibraryへ保存し、chatを削除してもLibrary fileは削除されないと説明する。
- Library fileはLibraryから手動削除し、Recently deletedを経て永久削除できる。永久削除予定は通常30日以内だが例外がある。
- Temporary ChatのuploadはLibraryへ保存されない。
- 記事間とrollout状態に差があるため、connectorはarchive／chat deleteをfile cleanupと同一視しない。runtime read-backを優先し、不明ならretention不明と表示する。
