import assert from "node:assert/strict";
import test from "node:test";

import { discoverRuntimeAssets } from "../src/asset-discovery.js";
import { ConnectorError } from "../src/errors.js";

const urls = [
  "https://cdn.oaistatic.com/assets/core.js",
  "https://cdn.oaistatic.com/assets/conversation.js",
  "https://cdn.oaistatic.com/assets/other.js",
];

const sources = new Map([
  [urls[0], "/f/conversation/prepare conduit_token completion.submit.request"],
  [
    urls[1],
    "contentToSend allSystemHints selectedSkillIds build_request_params.prompt_message",
  ],
  [urls[2], "unrelated"],
]);

const fakeFetch: typeof fetch = async (input) => {
  const source = sources.get(String(input));
  return new Response(source ?? "", { status: source === undefined ? 404 : 200 });
};

test("coreとconversation assetをmarkerで一意に分類する", async () => {
  const result = await discoverRuntimeAssets(urls, fakeFetch);
  assert.equal(result.coreUrl, urls[0]);
  assert.equal(result.conversationUrl, urls[1]);
  assert.match(result.coreFingerprint, /^[0-9a-f]{16}$/u);
});

test("候補が複数ならruntime driftで止める", async () => {
  const duplicateUrl = "https://cdn.oaistatic.com/assets/core-copy.js";
  sources.set(duplicateUrl, sources.get(urls[0])!);

  await assert.rejects(
    discoverRuntimeAssets([...urls, duplicateUrl], fakeFetch),
    (error) => error instanceof ConnectorError && error.code === "RUNTIME_DRIFT",
  );
});
