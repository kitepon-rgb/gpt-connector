# ChatGPT native attachment UI-independent E2E（sanitized observation）

- 出典: 専用Chromeのログイン済みChatGPT通常Chat、公式page runtime client
- 実施日: 2026-07-13
- fixture: `probe.txt`、215 bytes、`text/plain`
- 確度: 高（実upload、実conversation、server read-back、モデル回答、UI表示）
- 秘密除外: cookie、token、account ID、conversation ID、server file ID、署名付きURL、request／response bodyは保存していない。

## UI非依存upload

- Nodeでfixture bytesを読み、base64でCDP page contextへ渡した。
- page contextで`File`を構成し、DOM／file inputなしで公式upload objectを呼んだ。
- 結果は`ready`、progress 100、server file IDあり、file specあり、error callback 0件。

## attachmentとconversation

- 公式attachment normalizationのshapeに従い、file specをconversation builderの`attachments`へ1件渡した。
- 公式senderで新規通常Chatへ送信した。
- 送信後、公式`safeGet`でserver会話をread-backし、attachment 1件、name=`probe.txt`、MIME=`text/plain`を確認した。
- model回答はfixture先頭の識別子`GPT_CONNECTOR_NATIVE_ATTACHMENT_PROBE_20260713_TXT`と完全一致した。
- responseは`finished_successfully`、`end_turn=true`。
- resolved modelは`gpt-5-6-thinking`、resolved effortは`extended`。
- 公式archiveとread-back成功後、bridge session 0、operation 0。

## UI表示

- senderが遷移した研究用conversation documentに対し、対象文字列`probe.txt`の存在だけをbooleanで問い合わせ、trueを確認した。
- UI element一覧、sidebar title一覧、本文一覧は取得していない。
- 確認後はChatGPT homeへ戻した。

## 失敗と残課題

- 再現試験の開始点探索に失敗した1回はconversation作成前に停止したが、直前のupload 1件は孤立した。削除手段未確認のためcleanup済みとは扱わない。
- 状態確認でCDP target URLをそのままterminalへ1回出し、研究用conversation IDが表示された。ファイル保存はしていない。以後はURL全体でなくorigin／path分類またはbooleanだけを返す。
- `.md`と`.txt`のruntime uploadでは`File.type=text/plain`でもprocessing後の`fileSpec.mimeType`が空だった。conversation attachmentではlocal `File.type`を明示的fallbackとして使い、server read-backは`text/plain`だった。production契約ではこのMIME決定規則を固定し、黙った推定にしない。
