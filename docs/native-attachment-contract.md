# Native attachment／Oracle replacement contract

作成日: 2026-07-13

状態: `gpt-connector@0.2.0`公開契約

## 目的

`gpt-connector`が、ローカルworkspaceのfileをChatGPT通常Chatへ正規attachmentとして送り、caller timeout後も同じ相談を再送せず回収できる公開契約を定める。

本文展開、OpenAI API、Oracleへのfallback、server ID公開はこの契約に含めない。

## 公開method

### `consult(input)`

```ts
interface ConsultInput {
  prompt: string;
  files?: string[];
  workspaceRoot?: string;
  model?: string;
  effort?: string;
  slug: string;
  keepOpen?: boolean;
  dryRun?: boolean;
}
```

- schemaはstrict。未知fieldを拒否する。
- `slug`はcallerが事前に決めるidempotency／recovery key。`^[a-z0-9][a-z0-9._-]{2,63}$`。
- `files`が1件以上なら`workspaceRoot`必須。`workspaceRoot`はabsolute directory。
- `files`要素はworkspaceRoot相対のfile pathまたはglob。absolute path、NUL、空文字、`..` segmentを拒否する。
- `effort`指定時は`model`必須。live catalogにない組合せを拒否する。
- `keepOpen`既定false。trueの成功時だけ既存のopaque `sessionId`を返せる。
- `dryRun=true`はpath／glob／MIME／size／model／effortを検証するが、upload、conversation、job予約を行わない。

### `sessions({ slug })`

- exact slug 1件だけを返す。全job一覧は公開しない。
- caller timeout後も同じjobのstate／terminal result／errorを返す。
- lookupはupload／conversation／再送を発生させない。

### `models()`／`close({ sessionId })`

- 現行契約を維持する。
- `close`はconversation archiveであり、attachment file deleteではない。

### `doctor`／`diagnostics`

- schemaは`gpt-connector.diagnostics.v1`。
- `overall=ready`では`reasonCode=ready`、CDP／origin／authとsession／operation／upload／job件数を返す。
- CDP接続前の失敗でも同じschemaをstdoutへ返し、`overall=not_ready`と`cdp_unavailable`等の安定reason codeを持たせる。取得不能なboolean／countは`null`であり、0やfalseへ偽装しない。
- CLI doctorは`not_ready`で非0終了する。diagnosticsはupload、conversation、prompt出力を行わない。

## slug idempotency

- 初回`consult`だけがjobを作る。
- 同じslugを再度呼んだ場合、同じinput fingerprintなら既存snapshotを返し、upload／sendを再実行しない。
- 同じslugでinput fingerprintが異なる場合は`JOB_CONFLICT`。
- fingerprintはprompt hash、解決後fileのrelative path／bytes／SHA-256、requested model／effort／keepOpenから作る。prompt本文、file本文、absolute pathは台帳へ保存しない。
- terminal jobも同じslugで再取得できる。
- 台帳は製品所有のstate directoryへowner-onlyでatomic保存する。既定は`$XDG_STATE_HOME/gpt-connector`、未指定時は`~/.local/state/gpt-connector`。
- state directory単位のwriter leaseを持ち、別processの新規job作成をfail-closedにする。同一writer内の複数active jobは許可し、最後の非terminal jobがterminalになるまでleaseを保持する。
- lock非所有の`sessions`／同slug`consult`／diagnosticsはatomic台帳を再読込し、live writerが更新したterminal snapshotを古いmemory cacheで隠さない。
- process再起動時、terminal jobは回収する。非terminal jobは完了有無を断定できないため`JOB_RECOVERY_UNAVAILABLE`でfailedへ固定し、自動再送しない。

## file解決

### 順序と重複

1. `files` specをcaller指定順に処理する。
2. 各globのmatchをnormalized relative POSIX path昇順にする。
3. realpath単位でfirst occurrenceを残し、後続重複を除く。
4. この順序をupload順、conversation attachment順、result summary順で維持する。

globが0件matchなら`FILE_NOT_FOUND`。一部だけ成功扱いにしない。

### boundary

- `realpath(workspaceRoot)`をboundary正本にする。
- 各matchの`realpath`がroot外なら`FILE_OUTSIDE_ROOT`。
- root内symlink→root内targetは許可する。root外targetは`FILE_OUTSIDE_ROOT`。
- directory、socket、device、FIFOは拒否し、regular fileだけを許可する。
- ChatGPTへ渡すのはbytes、basename、MIMEだけ。workspaceRoot／absolute pathはpage context、job台帳、tool resultへ渡さない。

### sensitive file denylist

初回releaseは次を`SENSITIVE_FILE_BLOCKED`で拒否し、overrideを持たない。

- `.env`、`.env.*`、`.npmrc`、`.netrc`
- `*.pem`、`*.key`、`*.p12`、`*.pfx`、`*.kdbx`
- `id_rsa*`、`id_ed25519*`
- `credentials*.json`、`service-account*.json`、`secrets.*`

本文のsemantic secret scanは行わない。これは明白なfileを誤送信しない境界であり、「secretがない」保証ではない。

## file typeとMIME

workspace境界とfile policyを通過したregular fileは、形式を問わずnative attachmentとして公式runtimeへ渡す。内容をlocal parserで検査・変換しない。

既知拡張子には標準MIMEを付ける。

- document text: `.txt`、`.md`、`.rst`
- data／config: `.json`、`.jsonl`、`.yaml`、`.yml`、`.toml`、`.ini`、`.xml`、`.csv`、`.tsv`
- web／source: `.js`、`.mjs`、`.cjs`、`.ts`、`.mts`、`.cts`、`.jsx`、`.tsx`、`.py`、`.rb`、`.go`、`.rs`、`.java`、`.kt`、`.swift`、`.c`、`.h`、`.cpp`、`.hpp`、`.cs`、`.php`、`.sh`、`.bash`、`.zsh`、`.fish`、`.ps1`、`.sql`、`.css`、`.scss`、`.html`
- review: `.diff`、`.patch`
- image: `.svg`、`.png`、`.jpg`、`.jpeg`、`.gif`、`.webp`、`.bmp`、`.tif`、`.tiff`、`.heic`、`.heif`
- document: `.pdf`、`.rtf`、`.doc`、`.docx`、`.odt`
- spreadsheet: `.xls`、`.xlsx`、`.ods`
- presentation: `.ppt`、`.pptx`、`.odp`
- archive／ebook: `.zip`、`.tar`、`.gz`、`.tgz`、`.bz2`、`.7z`、`.rar`、`.epub`
- audio: `.mp3`、`.wav`、`.m4a`、`.ogg`、`.flac`、`.aac`
- video: `.mp4`、`.mov`、`.webm`、`.mkv`

text／sourceは原則`text/plain`、既知形式には対応する標準MIMEを使う。未知拡張子または拡張子なしは`application/octet-stream`とする。不正UTF-8を含め、content validationは行わない。

OpenAI公式は一般的なtext、spreadsheet、presentation、documentを対応対象とし、XLSX、XLS、CSV、TSV、DOCX、PPTX、PDF、TXTを例示する。`.gdoc`は公式非対応。archive、audio、video、未知形式へMIMEを付けて送信できることは、ChatGPTが内容を解釈できる保証ではない。公式runtimeが拒否した場合は既存error契約で明示し、変換やfallbackを行わない。

## limit

- file spec: 最大20。glob展開後も20以下。
- empty file: `FILE_EMPTY`でupload前拒否。
- single file: 初回releaseは20 MiB。
- total: 初回releaseは64 MiB。
- OpenAI公式hard limit 512MB/file、text/document 2M tokens/fileは上位制約として併記する。
- 2M tokenはlocalで正確に判定せず、server `too_many_tokens`を`FILE_LIMIT_EXCEEDED`へ写像する。
- connector limitは実測matrixを通して拡張する。server hard limitへ黙って丸投げしない。

## dry-run result

```ts
interface ConsultDryRunResult {
  dryRun: true;
  slug: string;
  files: Array<{
    relativePath: string;
    name: string;
    bytes: number;
    mimeType: string;
    sha256: string;
  }>;
  totalBytes: number;
  requestedModel: string | null;
  requestedEffort: string | null;
  limits: {
    maxFiles: 20;
    maxFileBytes: number;
    maxTotalBytes: number;
  };
  uploadWouldRun: false;
  conversationWouldRun: false;
}
```

relative pathとcontent hashはcallerが指定fileを検証するため返してよい。absolute path、本文、server IDは返さない。

## job state／result

stateは`queued | uploading | submitted | running | succeeded | failed`。

```ts
interface ConsultSnapshot {
  slug: string;
  state: JobState;
  createdAt: string;
  updatedAt: string;
  result: null | {
    text: string;
    status: string;
    endTurn: true;
    resolvedModel: string | null;
    resolvedEffort: string | null;
    sessionId?: string;
    attachments: {
      count: number;
      names: string[];
      mimeTypes: Array<string | null>;
      readBack: "confirmed";
      retention: "unknown";
      cleanup: "not_supported" | "failed" | "deleted";
    };
    archived: boolean;
  };
  error: null | {
    code: ConnectorErrorCode;
    message: string;
    retry: "never" | "after_input_change" | "after_auth" | "after_runtime_update" | "status_first";
    partialUpload?: {
      count: number;
      cleanup: "not_supported" | "failed";
    };
  };
}
```

- terminal successはserver attachment read-backとassistant完了を確認してから返す。
- `keepOpen=false`はarchive read-back後だけ`succeeded`。
- file deleteが404の現状では`retention=unknown`、`cleanup=not_supported`を返す。archiveをfile cleanupと表現しない。
- server file ID、library file ID、conversation ID、client thread ID、conduit tokenは返さない。

## error code

既存codeに以下を追加する。

- `INVALID_INPUT`
- `FILE_NOT_FOUND`
- `FILE_OUTSIDE_ROOT`
- `SENSITIVE_FILE_BLOCKED`
- `FILE_TYPE_NOT_SUPPORTED`
- `FILE_EMPTY`
- `FILE_LIMIT_EXCEEDED`
- `UPLOAD_FAILED`
- `UPLOAD_TIMEOUT`
- `ATTACHMENT_READBACK_FAILED`
- `JOB_NOT_FOUND`
- `JOB_CONFLICT`
- `JOB_RECOVERY_UNAVAILABLE`

server／runtime mapping:

- 401／403 auth failure → `AUTH_REQUIRED`
- `file_zero_bytes`／`file_empty` → `FILE_EMPTY`
- 413／`too_many_tokens` → `FILE_LIMIT_EXCEEDED`
- `unhandled_mime_type` → `FILE_TYPE_NOT_SUPPORTED`
- `failed_upload_to_blobstore` → `UPLOAD_FAILED`
- connector upload deadline → `UPLOAD_TIMEOUT`
- attachment name／count／MIME read-back mismatch → `ATTACHMENT_READBACK_FAILED`
- private role／fingerprint不一致 → `RUNTIME_DRIFT`

error mappingに失敗しても成功扱いにせず、既知でないruntime errorは`UPLOAD_FAILED`または`CHAT_FAILED`としてcodeとsanitized messageを残す。

## lifecycle

```text
resolve/validate
  → queued
  → uploading
  → submitted
  → running
  → read-back
  → archive（keepOpen=false）
  → succeeded
```

- uploadはfile順に行う。1件でも失敗したらconversationを作らない。
- 部分upload済みfileはjob内部へ記録するが、削除成功を保証しない。
- 部分upload後の失敗は`partialUpload.count`とcleanup状態をterminal errorへ残し、一括失敗の陰に隠さない。
- caller timeoutはjob cancelを意味しない。`sessions(slug)`で状態を先に確認する。
- explicit cancelと細粒度progressは初回releaseでは未実装。dotagents切替前必須はstate遷移とterminal回収で満たし、未実装機能へfallbackしない。
- CDP切断／process crash時は重複送信の可能性を除外できるまで自動retryしない。
- prompt本文展開、Oracle、API engine、別model、別effortへのfallbackはない。

## 互換

- 現行`chatgpt_chat`／`sessionId`は既存利用向けに残す。
- dotagents移行面は同じcoreの`consult`／`sessions`を使い、別adapter packageを作らない。
- 移行期間だけMCP server idを`oracle`にできるが、実体commandは`gpt-connector-mcp`。
- Oracle固有`engine`を受ける互換面を作る場合、`browser`だけを受理し、他値を拒否する。

## 親反証

- file pathをabsoluteのまま受ける方が簡単: MCP cwdとhost差異、誤送信範囲が広がるため棄却。absolute `workspaceRoot`＋relative specに固定する。
- serverが512MBを許すので同値にする: 初回runtime transfer／memory matrixがなく、dotagents実績にも不要。20MiB/file／64MiB totalから実測で拡張する。
- 未知binaryをlocalで拒否する: attachment transportの責務をChatGPT対応形式の判定へ広げるため棄却。`application/octet-stream`で公式runtimeへ渡し、その成否を明示する。
- 各形式をlocal parserで厳密検査する: 添付transportの責務をcontent validationへ広げるため棄却。元bytesを標準MIMEまたはoctet-streamで渡す。
- timeout時に同じslugで再実行する: upload／conversation重複の危険があるため棄却。同じslugはsnapshot lookupになる。
- archiveでfileも片付く: generic DELETE 404とLibrary仕様に反するため棄却。retention unknownを公開する。
- secret overrideが必要: 初回Oracle移行に不要で誤送信リスクを増やす。denylist overrideなしで開始する。
