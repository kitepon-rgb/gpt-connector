# gpt-connectorによるdotagents Oracle置換評価

- 実施日: 2026-07-13
- 出典: `gpt-connector@0.1.0` npm global版、`0.2.0` sourceと専用Chromeの実測、dotagents正典／skill／factory contract／tests、`@steipete/oracle@0.16.0` dry-run・live・session台帳
- 確度: gpt-connector機能、dotagents静的消費契約、集計値は高。将来のprivate Web runtime安定性とOracle単発failureの一般化は中。
- 秘密情報: prompt本文、file内容、cookie、token、account ID、conversation ID、session IDは取得・保存していない

> 2026-07-13追補: 本稿の「text file入力をP0とし、binary upload parityを不要とする」裁定は、その後のオーナー判断で上書きされた。正規添付、durable job、diagnostics、全regular file pass-throughは`0.2.0`へ実装済み。prompt本文へのテキスト展開は未採用で、失敗時のfallbackにしない。現行契約は`docs/native-attachment-contract.md`、完了計画は`docs/archive/`を正とする。

## 0.2.0到達点

当初P0とした`consult`、files／glob、dry-run、durable `sessions`、timeout後の再送防止、version、diagnostics、MCP 6 toolsは実装済み。さらにPNGの正規upload／視覚認識と全regular file pass-throughまで成立した。

| dotagents需要 | 0.2.0 source | 現行判断 |
|---|---|---|
| Chat枠second opinion | 充足 | 公式page内部client、UI操作なし |
| model／effort明示とresolved確認 | 充足 | live catalogでfail-closed |
| files／glob／dry-run | 充足 | 正規attachment、本文展開なし |
| long/failure status | 充足 | durable slug、offline sessions |
| timeout後の重複送信防止 | 充足 | 同slug／同fingerprintはsnapshot lookup |
| version／diagnostics | 充足 | CLI、MCP、固定diagnostics schema |
| archive／read-back | 充足 | keepOpen=falseでarchive確認後成功 |
| file type | 充足 | 全regular fileをpass-through、runtime判断 |

技術機能面では、dotagents側shadowへ進める水準に達した。ただし本releaseではdotagents／ServerManagerを変更しておらず、工場登録・MCP切替・全host検証は別waveである。


## 0.1.0時点の結論

**Oracle全機能とのparityではなくdotagentsの実需要を基準にすれば、`gpt-connector`単独での置換は可能性が高く、理想優先順位1を第一選択へ戻せる。** 現行`0.1.0`の即時差し替えは不可だが、必要な追加面はOracle全体より小さい。

恒久的な別adapter製品は作らない。`gpt-connector`本体へ次を追加する。

1. text files／globとdry-runを持つ`consult`。
2. timeout後に再送せず確認できる最小job status／`sessions`。
3. factoryが読めるversion／diagnostics。
4. 移行期間だけ`oracle`というMCP server idから`consult`／`sessions`を呼べる互換面。

planned follow-up専用schema、binary upload、Deep Research、Project Sources、API engine、Oracle preset完全互換は切替条件にしない。

## dotagentsがOracleへ求めている役割

正典上の役割は次の部分集合である。

- ChatGPT Chat枠をCodex／Anthropic枠と分離して使うsecond opinion。
- 「実読不要の純推論」「裁定材料」「設計意見の別視点」「差分を貼れる規模の第三者レビュー」。
- API課金禁止、MCP入口限定、結果は助言としてローカル検証する。
- model／effortを意図どおり選びたい。
- 必要時だけ最小十分なfiles／globを渡す。
- long run／failureでは再送せずsessionsで状態確認する。
- 成功時archiveし、失敗時の下書き混入や残置を避ける。
- 工場コア製品として全hostでinstall、update、diagnostics、factory report対象になる。

実装物量、リポ全体を読む監査、Deep Research、画像生成はOracleレーンの担当ではない。静的検索で`oracle.consult`のprogrammatic consumerはなく、実呼出しはskill／正典に従うagent操作である。hookのOracle fixtureも現在は初回委譲INFOのgeneric testで、Oracle固有parameterを拒否しない。

## 実利用集計

過去30日、今回の評価probeを除くOracle 44 sessionを、本文・file内容・IDなしで集計した。

| 観点 | 集計 | 判断 |
|---|---:|---|
| filesあり | 26/44（59%） | text file入力はP0 |
| filesなし | 18/44（41%） | 純推論one-shotも主要用途 |
| file spec総数 | 124 | resolver／上限が必要 |
| file種別 | `.md` 55、`.ts` 61、`.tsx` 4、`.mjs` 2、`.diff` 2 | 全てtext。binary upload parityは不要 |
| globを含むspec | 2 | include globは必要、複雑なbundle engineは後回し可 |
| thinking time指定 | 33/44（75%） | model／effort明示はP0 |
| thinking time内訳 | extended 26、heavy 5、standard 2 | 高effortを代表gateへ含める |
| planned follow-up | 0/44 | 専用schemaは不要 |
| status | completed 24、error 20 | failure回収を切替gateへ含める |
| duration | p50 256.8秒、p75 467.3秒、p90 613.5秒 | caller timeoutと裏runの分離を扱う |

直近48時間は評価probeを除き3件すべてerrorだが、標本が小さいためOracle全般の稼働率には一般化しない。

## gpt-connector実測

### 0.1.0基本面

- npm `latest=0.1.0`、global install済み、ChatGPT公式page target 1件。
- live catalogは通常Chat 17モデル。`gpt-5-6-thinking`等で`min／standard／extended／max`を選択可能。
- invalid modelは送信前に`MODEL_NOT_AVAILABLE`。
- CLI default one-shotは13.15秒、固定応答一致、resolved modelは`gpt-5-6-thinking`。
- CLI `gpt-5-6-thinking/min`は7.39秒、requested／resolved一致。
- global MCPでone-shot、2turn、explicit close、same-session並行拒否を確認。
- close後は`archived=true`、page bridge session 0／operation 0、MCP子process残置なし。
- `gpt-5-5-pro/standard` CLIは約28秒でstdout／stderrなしで終了。結果を回収できず、成功扱いしない。

### dotagents代表text probe

`src/connector.ts`、`src/page-bridge.ts`、本評価計画を連結した25,774文字を`gpt-5-6-thinking／extended`へ送信した。17.0秒で指定固定文、`finished_successfully`、resolved model／effort一致、one-shot archive成功。

この結果から、text context＋高effortの同期経路は実用域にある。永続jobを最初の実装項目にする必要はない。一方、1回の成功だけでtimeout recoveryを不要とはできない。

### default modelの注意

catalogの`defaultModel=gpt-5-5`とmodel未指定turnのresolved model `gpt-5-6-thinking`は一致しなかった。公式client側解決が介在するため、dotagentsではmodel／effortを毎回明示し、resolved metadataを検証する。

## Oracle 0.16.0実測

- dotagents skill／`docs/06_oracle-mcp.md`は0.15.2前提だが実体は0.16.0。factory contractのみ0.16.x。
- configは`manualLogin=true`、`modelStrategy=ignore`、`archiveConversations=auto`。
- dry-runでtext file inline化、planned follow-up、manual-login profile、archive policyを解決。
- live files＋follow-up runは300秒でMCP caller timeout後も継続。5分56秒まで`no thinking status detected`。
- CLIにcancel／stopはなく、対象run専用ChromeをTERM後にsessionはerrorへ確定。failure pathのarchive成功は未確認。
- 2026-07-11にはOracle 0.15.2で21.7秒の成功実績があり、単発failureを常時不動とは一般化しない。

## dotagents実需要に対する充足表

| dotagents需要 | 0.1.0 | 切替判断 |
|---|---|---|
| Chat枠second opinion | 充足 | 公式page内部clientでUI操作なし |
| model／effort明示 | 充足 | Oracle現運用より決定的。毎回明示する |
| resolved metadata | 充足 | gateでrequested一致を検査 |
| one-shot archive | 充足 | read-back確認済み |
| text files／glob | 欠落 | P0。実利用59% |
| dry-run | 欠落 | P0。file解決と送信構成だけ返す |
| long/failure status | 欠落 | P0。実装順はfilesの後 |
| timeout後の孤児防止 | 欠落 | P0。現実装は180秒後にpage operationをcancel／consumeしない |
| factory version／doctor | 欠落 | P0。dotagents工場統合に必要 |
| planned follow-up schema | 欠落 | 不要。実利用0、既存sessionで代替可能 |
| binary／research等 | 欠落 | 不要。Oracleレーンの実需要外 |

## 最小追加契約

### `consult`

- required: `prompt`
- optional: `files`、`dryRun`、`slug`、`model`、`effort`
- 一般利用ではslugを任意にできるが、dotagents標準形ではcaller生成の一意slugを必須にする。同期MCPがtimeoutしてもcallerが復旧キーを失わないためである。
- `engine`を互換入力として受けるなら`browser`だけ許可し、それ以外は明示拒否。
- `files`はUTF-8 textだけ。決定的sort、glob、重複排除、秘密pattern除外、総byte上限、文字数／概算tokenを持つ。
- `dryRun`はChromeへ送信せず、解決file一覧、bytes、概算token、requested model／effort、endpoint／auth可否を返す。本文は返さない。
- model／effort未指定をdotagents標準形にしない。未知値をsafe defaultへ落とさない。

### `sessions`／job status

- opaque job ID、caller既知の一意slug、queued／running／succeeded／failed、開始／更新／完了時刻、resultまたはerror code。
- prompt本文、file内容、conversation ID、cookie、tokenを保存／出力しない。
- caller timeout後に`sessions(slug)`で同じjobを検索し、再送せずterminal状態を確認できる。
- timeout時は裏operationを回収可能にするか、明示cancel＋archiveまで終えてterminal failureにする。
- process restart回収とexplicit cancelの完全版はP1でもよいが、切替前に少なくともcaller timeout時の孤児化をなくす。

### factory診断

- `gpt-connector --version`。
- machine-readable diagnostics／doctor: package version、CDP到達、target一意性、公式origin、auth、bridge build、open job／session／operation件数。
- Chat送信、conversation作成、secret出力を行わないread-only診断。

## 実装順

1. **Release A — consult＋text context**: schema、files／glob resolver、dry-run、size／secret gate、契約test。
2. **Release B — failure recovery**: job status、timeout後再取得、孤児operation防止、archive／cleanup fault injection。
3. **Release C — factory統合面**: version、diagnostics JSON、`consult`／`sessions`互換tool、global smoke。
4. **Shadow gate**: no-files／files、standard／extended／max、auth loss、runtime drift、timeout、restartを実ブラウザで検証。Oracleへの自動fallbackは禁止。
5. **dotagents切替wave**: factory product contractとServerManager期待schema、agents-update、verify-install、MCP登録、skill、02／05／06正典、wrapper testsを同時更新。旧Oracle履歴は削除せず`not_applicable`へ遷移。
6. **Oracle撤去**: 全host greenとオーナー承認後。rollbackはMCP commandを前releaseへ戻す。

## 反対仮説

- **純推論なのでfiles不要**: 26/44がfiles付きで棄却。ただし全てtextなのでbinary uploadは不要。
- **callerがtextを連結すればよい**: glob、秘密除外、size cap、順序がhostごとに分裂するため棄却。
- **17秒で終わるのでstatus不要**: 代表probeは成功したが、Oracle p90 613.5秒、Pro無出力、現timeout構造の孤児化が残るため切替gateからは外せない。ただし実装順は2番目へ下げる。
- **Oracle API全体を模倣すべき**: planned follow-up 0、binary 0、programmatic consumerなしのため棄却。
- **恒久adapterが必要**: 移行期のtool名互換だけで足りる。別packageは所有境界、version、診断、failure modeを増やすため棄却。

## 最終裁定

- 理想優先順位1 `gpt-connector`単独置換: **採用候補。Release A〜Cとshadow gate後に切替可。**
- 優先順位2 恒久Oracle互換adapter: **不採用。移行期互換だけ本体に置く。**
- 優先順位3 Oracle併用: **shadow期間とrollback用に限定。自動fallbackはしない。**

独立subagent反証は実施していない。ユーザーから委譲許可がないため、親自身で上記5反対仮説を検証した。
