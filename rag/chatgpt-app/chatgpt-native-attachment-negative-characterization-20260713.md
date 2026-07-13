# ChatGPT正規添付 negative characterization

- 実施日: 2026-07-13
- 対象: 専用Chrome、ログイン済みChatGPT通常Chat、公式page runtime client
- 確度: 高（実fault injection／実server応答／公式静的asset）。長期retentionだけ未確定。

## 結果表

| case | 結果 | server／conversation | 自動retry裁定 |
|---|---|---|---|
| auth 401 injection | `RequestError`、status 401、result null | file entry前に遮断、conversationなし | 認証回復確認後だけ可 |
| raw storage failure | `UserFileError`、`failed_upload_to_blobstore`、result null | file entry作成後。孤立entryの可能性あり | 自動retry不可 |
| 0-byte `.txt` | `RequestError`、400、`file_zero_bytes`、result null | ready fileなし | 入力修正後だけ可 |
| create-file timeout | 1.5秒でCDP call timeout、page reload | faultはfile entry前。wrapper破棄 | 現codeは`CDP_UNAVAILABLE`で粒度不足 |
| CDP disconnect | pending read-only callが`CDP_UNAVAILABLE` | Chrome／loginは維持 | 実operation中は状態確認前の再送禁止 |
| runtime marker欠落 | `RUNTIME_DRIFT` unit negative 7/7 green | network／conversationなし | build再発見まで禁止 |
| upload後・送信前discovery失敗 | conversation作成前に停止 | 孤立upload 1件 | file handle／cleanup確認前の再upload禁止 |
| generic delete | 公式`safeDelete('/files/{file_id}')`が404 | GETでは対象`available` | 削除成功扱い禁止 |
| `.bin` + octet-stream | `ready`、error 0 | 会話へは送らず孤立upload | 「binaryはserver拒否」と仮定禁止 |

## count／duplicate／MIME policy

- HTML file inputの`accept`は空、`multiple=true`。拡張子gateはHTML属性にない。
- 現runtimeの同時添付上限は20。20件ある状態の次fileは送信前max分岐へ入り、network 0。
- duplicate signatureは`name + size + lastModified + type`。同名でもsignatureが違えばlocal stateへ追加できる。
- OpenAI公式は一般的な文書系拡張子を対応対象とし、`.gdoc`は非対応と明記する。
- 直接runtime clientへproduct attachment policyを渡さないprobeでは`.bin`もreadyになった。productionは公式対応type／sizeをlocal preflightし、private clientへ丸投げしない。
- `fileSpec.mimeType`が空でもlocal `File.type`は保持される場合がある。E2Eではattachment MIMEへ`File.type`を明示し、server read-backは`text/plain`だった。

## delete／retention

- upload objectの`remove`／`removeUserInitiated`はlocal state削除とactive upload cancelだけで、server deleteは行わない。
- Library route assetには通常fileの`safeDelete('/files/{file_id}')`と、library fileの`delete_stream(...soft_delete=true)`が存在する。
- 研究fixtureはGET可能で`available`だったが、generic DELETEは404、Library完全一致検索は0、library IDなしだった。
- よって現経路では一般file deletionを実証できていない。page memoryのIDを消してもserver cleanupではない。
- OpenAI公式Library仕様もchat archiveをfile deleteとは扱っていない。成功会話のarchive後fileと孤立uploadの保持期間は不明として契約化する。

## fallback確認

- すべてのfailureでprompt本文への展開、Oracle呼出し、別endpointの手組み、暗黙再送は行っていない。
- fault wrapperはsuccess／error時に復元し、timeoutだけはpage reloadでexecution contextごと破棄した。

## 反対仮説の検証

- 「モデルはpromptからmarkerを知った」: promptにはmarkerを含めず、fileの場所だけを質問したため反証。
- 「本文貼り付けだった」: server read-backでmessage attachment 1件を確認し、name／MIMEも一致したため反証。
- 「UI操作で添付した」: E2E uploadはNode bytes→page `File`→公式upload objectで、DOM／file inputを使っていないため反証。
- 「model／effortがfallbackした」: assistant metadataのresolved値がrequested値と一致したため反証。
- 「完全にproduction-ready」: delete 404、retention不明、private asset drift、loaded-asset timing依存が残るため反証。このため無条件可能ではなく条件付き可能とする。

## Phase 1裁定

**条件付きで可能。**

UI非依存のnative upload、server attachment、モデル読取、UI表示、model／effort、archiveは成立した。production化の条件は、bootstrap/import graph discovery、fail-closed fingerprint、local file policy、timeout／job recovery、retention明示、暗黙fallback禁止である。
