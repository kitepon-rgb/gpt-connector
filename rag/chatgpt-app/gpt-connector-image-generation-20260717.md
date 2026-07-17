# gpt-connector 画像生成正式化

- 出典: [[raw/chatgpt-native-image-generation-e2e-20260717]]、[[raw/openai-chatgpt-file-upload-limits-retention-20260713]]
- 取得・実装日: 2026-07-17
- 確度: 高（production path E2Eとfocused tests）

## 結論

ChatGPT通常枠の画像生成は、OpenAI API keyやAPI課金経路を追加せずgpt-connectorへ正式実装できる。
ただしconsumer ChatGPTの非公開Web runtimeであり、公開安定APIではない。runtime drift時は明示エラーで停止する。

正式契約は次の通り。

1. callerはlive catalogに存在するmodelと、必要なら対応effortを明示する。
   resolved metadataがrequested selectionと異なる場合は成功扱いしない。
2. connectorは画像生成toolの使用と実画像1枚の生成をpromptへ明示する。
3. page treeの最終assistantから`turn_exchange_id`／`working_turn_id`を取得する。
4. server conversation mappingに同じturnの`image_asset_pointer` tool messageが現れるまで有界pollする。
5. Library nodeはconversationとtool messageのorigination IDが両方一致するものだけを採用する。
6. Library contentをpage側で取得し、MIME、byte数、dimensions、SHA-256を検証する。
7. 256KiB chunkでNode側へ転送し、byte数とSHA-256を再検証する。
8. absolute `workspaceRoot`配下のrelative outputへno-clobber保存する。root外symlinkとMIME／拡張子不一致を拒否する。
9. job terminal resultは既存slug台帳へ保存し、caller timeout後は`sessions`から再送なしで回収する。
10. local保存とdigest再検証後、生成元だけをLibraryのRecently Deletedへsoft-deleteする。成功／失敗／partialを結果へ明示する。

## 公開面

- CLI: `gpt-connector image`
- MCP: `chatgpt_image`
- status回収: `sessions`
- failure: `IMAGE_NOT_GENERATED`、`IMAGE_READBACK_FAILED`、`IMAGE_DOWNLOAD_FAILED`、`IMAGE_OUTPUT_FAILED`、`IMAGE_CLEANUP_FAILED`、`MODEL_RESOLUTION_MISMATCH`

## soft-delete実測

ChatGPT Library自身のruntime assetは、`library_file_id`と`file_id`を両方渡し、
`soft_delete=true`でRecently Deletedへ移す。E2E promptに完全一致した当方の生成画像1件で実行し、
active Library listから消えたことを確認した。local保存前の削除と、時刻だけで対象を選ぶ削除は禁止する。

最終production E2Eでは `gpt-5-6-thinking/min` がrequested/resolvedで完全一致し、PNG回収・Node側digest一致・local保存・`soft_deleted`・conversation archiveを一回で確認した。

job台帳とtool resultへはrelative output、MIME、byte数、dimensions、SHA-256だけを出す。Library／conversation／messageの内部ID、content URL、absolute pathは出さない。
