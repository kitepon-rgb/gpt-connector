# ChatGPT通常枠 画像生成E2E（sanitized raw record）

- 出典: ログイン済みChatGPT公式Web runtime、専用Chrome、gpt-connector production path
- 取得日: 2026-07-17
- 確度: 高（実runtimeで生成・回収・視覚確認）
- 秘密除外: cookie、token、header、request／response body、Library ID、file ID、conversation ID、message ID、content URL、absolute workspace pathは保存していない

## 観測shape

- 最終assistant messageは`status=finished_successfully`、`end_turn=true`だが、画像生成turnではtext partが空文字だった。
- 生成画像本体は同一turnの`author.role=tool` messageにあり、contentは`multimodal_text`、partは`image_asset_pointer`だった。
- image partは`asset_pointer`、`mime_type`、`size_bytes`、`width`、`height`を持った。
- tool message metadataと最終assistant metadataは`turn_exchange_id`／`working_turn_id`が一致した。
- Library imageは`origination_thread_id`／`origination_message_id`を持ち、server conversationとtool messageへ完全一致した。
- Library imageの`file_id`はtool messageの`asset_pointer`に含まれた。
- sender完了直後はserver conversationの`current_node`反映が遅れる場合があり、page treeの最終assistantをturn正本にしてserver mappingを有界pollする必要があった。

## production E2E結果

- request model: `gpt-5-6-thinking`
- request effort: `min`
- terminal state: `succeeded`
- resolved model: `gpt-5-6-thinking`
- resolved effort: `min`
- image count: 1
- MIME: `image/png`
- dimensions: 1024 × 1536
- bytes: 908128
- page／Node SHA-256: 一致
- relative output: `result-4.png`
- conversation archive read-back: confirmed
- Library retention: retained
- Library cleanup: not supported by this feature
- visual check: 白背景、中央の濃青正方形、その下の`E2E`を確認

## negative characterization

1. assistant text必須の既存契約は、画像生成成功を`STREAM_INCOMPLETE`へ誤分類した。
2. Libraryの最新画像だけを時刻で選ぶ方法は、並行生成を取り違えるためproduction contractから棄却した。
3. server `current_node`をsender直後に単発取得する方法はeventual consistencyで失敗したため棄却した。
4. page最終assistantのturn IDを正本とし、server mappingの同一turn tool messageとLibrary origination IDを二重相関する方法で成功した。

## 追加soft-delete characterization

- 取得日: 2026-07-17
- ChatGPT自身のLibrary runtime assetで、`library_file_id`／`file_id`／任意のfile name・parentと
  `soft_delete=true`を渡す公式client経路を確認した。
- 当方のE2E promptに一致する生成画像だけを対象に1件実行し、active Library listから消えた。
- production契約はlocal保存とNode側digest再検証後にだけ同じsoft-deleteを行う。
- Recently Deletedからの永久削除は行わない。
- cleanup E2Eの1回で、requested `gpt-5-6-thinking`に対しresolved metadataが
  `gpt-5-4-auto-thinking`となるruntime側model変更を観測した。production契約はこれを成功扱いせず、
  `MODEL_RESOLUTION_MISMATCH`で停止して生成元をsoft-deleteする。

## final production E2E（厳密model解決＋soft-delete）

- request/resolved model: `gpt-5-6-thinking` / `gpt-5-6-thinking`
- request/resolved effort: `min` / `min`
- terminal state: `succeeded`
- image count / MIME: 1 / `image/png`
- dimensions / bytes: 1254 × 1254 / 895315
- page／Node SHA-256: 一致
- local save: confirmed
- Library retention: `recently_deleted`
- Library cleanup: `soft_deleted`
- conversation archive read-back: confirmed
