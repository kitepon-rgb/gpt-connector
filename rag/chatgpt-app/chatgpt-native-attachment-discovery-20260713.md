# ChatGPT正規添付の発見記録

- 実施日: 2026-07-13
- 対象: `gpt-connector@0.2.0` source、専用Chrome、ログイン済みChatGPT通常Chat
- 確度: 基準UI upload／conversation shape、UI非依存runtime upload／conversation attachment E2Eは高。negative characterizationとretentionは未確定。

## 現在の結論

ChatGPT通常Chatには、本文貼り付けではない正規file uploadとmessage attachment経路が存在する。小型text fixtureについて、upload、UI添付表示、conversation attachment、モデル読取まで成立した。

自作PNG fixtureでも、DOM／file inputなしのupload `ready`、server attachment read-back、固定visual marker `MARKER 7Q4M`のモデル回答、model／effort一致、archive、bridge残存0が成立した。PNGは元bytesのまま`image/png`として渡せばよく、local画像decoderは添付機能の責務に含めない。

後続裁定でfile type allowlist自体も除去した。known extensionは標準MIME、unknown extensionは`application/octet-stream`として元bytesを渡し、公式runtimeに最終判定を委ねる。localでのUTF-8、画像、PDF、Office、archive等のcontent validationは行わない。

加えて、Nodeで読んだfixture bytesをCDP page contextへ渡し、DOM／file inputなしで公式upload clientを呼ぶ実証にも成功した。結果は`ready`、progress 100、server file IDとfile specあり、error 0件だった。

UI非依存で得たfile specを通常conversationへ関連付ける実証も完了した。UI表示、server attachment read-back、モデル読取、model／effort一致、archive、bridge cleanupが揃った。

Phase 1の最終裁定は**「条件付きで可能」**。negative characterizationではauth 401、storage failure、0-byte、timeout、CDP切断、runtime drift、upload後送信前失敗を明示エラーとして観測した。generic file deleteは404で成立せず、retentionは未確定。このため無条件可能とはしない。

## 発見した経路

1. ChatGPTへfile metadataを登録する。
2. 返却された署名付き`oaiusercontent.com` URLへraw bytesをPUTする。
3. ChatGPTへupload processingを要求し、SSEで完了を待つ。
4. conversation user messageの`metadata.attachments`へfile参照を入れる。
5. 通常conversation senderで送信する。

conversation attachmentは`id`と`library_file_id`の二つの内部参照を持ち、MIME、name、size、source等を伴う。内部ID値は保存していない。

## 追加で見つかった阻害要因

- 直接`fetch`によるconversation archiveは401。cookieだけでは足りず、公式clientのintegrity付きrequestが必要。
- ページ遷移後のloaded assetでは、従来core discovery markerが0件になった。`gpt-connector models`も`RUNTIME_DRIFT`で停止した。
- よって次の作業は、upload clientだけでなく、現buildにおける公式core client／sender／builder markerの再発見を含む。

## UI非依存runtime uploadの発見

- 現buildは`/_next/static/chunks/`ではなく`/cdn/assets/`を主要asset pathに使う。
- bootstrap inline moduleから公式root assetを抽出し、同一origin import graphを探索することで、固定build名なしにupload moduleへ到達できた。
- upload objectはmethod集合の構造シグネチャで一意にでき、複数moduleのre-exportはobject参照同一性で重複排除できる。
- upload use caseは`Retrieval = 3`、内部kindは`my_files`。state contractは`files$()`／`files$.set()`で再現できた。
- 公式clientはfile entry作成、署名付きstorage upload、processing SSE、ready file spec生成を一続きで所有する。wire requestを手組みする必要はない。

## UI非依存E2Eの結果

- conversation attachmentは1件としてserver read-backされ、name=`probe.txt`、MIME=`text/plain`だった。
- モデル回答はfixture識別子と完全一致し、`finished_successfully`／`end_turn=true`だった。
- requested／resolvedは`gpt-5-6-thinking`／`extended`で一致した。
- 公式archive read-back後、bridge session／operationはともに0。
- senderが開いたconversation documentで添付名の存在をboolean確認し、UI表示もtrueだった。
- よって本文貼り付けではなく、native server attachmentとしてモデルへ渡ったと判断できる。

## 観測上の失敗

archive操作を探すread-only probeでbutton一覧を広く取得し、既存chat titleをterminalへ出した。本文、conversation ID、cookie、tokenは出力せず、ファイルやRAGへ保存していない。以後は一意`data-testid`または対象文字列だけを問い合わせ、UI element一覧を取得しない。

別の状態確認ではCDP target URLをterminalへそのまま出し、研究用conversation IDが1回表示された。保存はしていない。以後はURL全体でなくorigin／path分類または対象booleanだけを返す。

再現試験のconversation asset探索が送信前に失敗したため、直前に成功したupload 1件が孤立した。削除手段とretentionが未確認なのでcleanup済みとは扱わない。

## 後続実装

- 公開入力、local file policy、opaque handle、error code、retention表示はproduction契約へ実装済み。
- 全regular fileをUTF-8検証から分離し、既存のworkspace／size／secret境界とchunk uploadを共有する。
