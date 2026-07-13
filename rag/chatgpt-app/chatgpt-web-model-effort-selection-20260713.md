# ChatGPT Web — model／thinking effort選択

- 出典: ログイン済みChatGPT公式Web runtime、公式`/models` catalog、active probeのassistant metadata
- 取得日: 2026-07-13
- 確度: 高（catalog contract、明示選択、fail-closed validation）
- 時点性: model一覧と利用可否はaccount／runtime依存。固定値ではなく実行時catalogを正とする

## 結論

UIを使わず、通常Chatのmodelとthinking effortを明示選択できる。高水準sender `kF/YDr` は `requestedModelId`、`thinkingEffort`、`serviceTier` を別fieldとして受け取る。

model catalogは公式clientの`GET /models`から取得できる。通常Chat connectorはWork-only modelを除外し、model／effortの組合せを送信前に検証できる。

## catalog contract

主要field:

- `default_model_slug`
- `models[].slug`
- `models[].title`
- `models[].reasoning_type`
- `models[].thinking_efforts[].thinking_effort`
- `models[].default_thinking_effort`
- `models[].configurable_thinking_effort`
- `models[].is_work_mode_model`
- `versions[].enabled`
- `versions[].slugs`
- `versions[].intelligence_presets`

取得時点の通常Chat既定は`gpt-5-5`。明示effortを持つ代表例:

- `gpt-5-6-thinking`: `min / standard / extended / max`
- `gpt-5-5-thinking`: `min / standard / extended / max`
- `gpt-5-4-thinking`: `min / standard / extended / max`
- `gpt-5-6-pro`: `standard`
- `gpt-5-5-pro`: `standard / extended`
- `gpt-5-4-pro`: `standard / extended`

Instant／non-reasoning modelは通常`thinking_efforts`が空であり、effortを渡さない。

## active probe

指定:

- model: `gpt-5-6-thinking`
- thinking effort: `min`
- service tier: 未指定

結果:

- response: `MODEL_EFFORT_OK`
- status: `finished_successfully`
- end turn: true
- `resolved_model_slug`: `gpt-5-6-thinking`
- `model_slug`: `gpt-5-6-thinking`
- `default_model_slug`: `gpt-5-6-thinking`
- `thinking_effort`: `min`

probe conversationはarchive済み。delete未実施。

## fail-closed validation

非対応例`gpt-5-5-instant + max`は、live catalog上でeffort候補が空のためconversation作成前・sender呼出し前に拒否した。暗黙defaultへのfallbackは行わない。

推奨validation:

1. live catalogにmodelが存在する。
2. 通常Chatでは`is_work_mode_model !== true`。
3. effort指定時は`thinking_efforts`に完全一致する。
4. model／effort未指定はfield自体を省略する。
5. `serviceTier`は独立して扱い、無指定なら省略する。
