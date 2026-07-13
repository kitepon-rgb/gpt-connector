import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import {
  bridgeBuildId,
  createBridgeBootstrapExpression,
  createBridgeCallExpression,
} from "../src/page-bridge.js";

test("bridgeはDOM selector・event・fiberを利用しない", () => {
  const expression = createBridgeBootstrapExpression(
    "https://cdn.oaistatic.com/assets/core.js",
    "https://cdn.oaistatic.com/assets/conversation.js",
    "https://cdn.oaistatic.com/assets/upload.js",
  );

  assert.doesNotMatch(expression, /querySelector|__reactFiber|\.click\(|dispatchEvent/u);
  assert.match(expression, /conversationFactory/u);
  assert.match(expression, /requestedModelId/u);
  assert.match(expression, /sessionCount/u);
  assert.match(expression, new RegExp(bridgeBuildId, "u"));
  assert.doesNotThrow(() => new Function(expression));
});

test("bridgeは公式upload objectとattachment read-backを一意化する", () => {
  const expression = createBridgeBootstrapExpression(
    "https://cdn.oaistatic.com/assets/core.js",
    "https://cdn.oaistatic.com/assets/conversation.js",
    "https://cdn.oaistatic.com/assets/upload.js",
  );

  assert.doesNotMatch(expression, /attachments:\s*\[\]/u);
  assert.match(expression, /attachLibraryFile/u);
  assert.match(expression, /createFileCompleted/u);
  assert.match(expression, /uploadCompleted/u);
  assert.match(expression, /uploadFile/u);
  assert.match(expression, /createUpload/u);
  assert.match(expression, /appendUploadChunk/u);
  assert.match(expression, /startUpload/u);
  assert.match(expression, /discardUpload/u);
  assert.match(expression, /attachmentHandles/u);
  assert.match(expression, /ATTACHMENT_READBACK_FAILED/u);
});

test("asset discoveryもUI selectorへ依存しない", async () => {
  const source = await import("../src/asset-discovery.js");
  assert.doesNotMatch(source.listLoadedAssetUrls.toString(), /querySelector|__reactFiber/u);
});

test("bridge callはupload methodの引数をJSONとして閉じ込める", () => {
  let captured: unknown;
  const expression = createBridgeCallExpression("startUpload", [
    { name: "`);globalThis.pwned=true;//" },
  ]);
  const context = {
    __gptConnectorBridgeV1: {
      startUpload: (input: unknown) => {
        captured = input;
      },
    },
  };

  vm.runInNewContext(expression, context);
  assert.equal(
    (captured as { name?: unknown } | undefined)?.name,
    "`);globalThis.pwned=true;//",
  );
  assert.equal("pwned" in context, false);
});
