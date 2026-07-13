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
  );

  assert.doesNotMatch(expression, /querySelector|__reactFiber|\.click\(|dispatchEvent/u);
  assert.match(expression, /conversationFactory/u);
  assert.match(expression, /requestedModelId/u);
  assert.match(expression, /sessionCount/u);
  assert.match(expression, new RegExp(bridgeBuildId, "u"));
});

test("asset discoveryもUI selectorへ依存しない", async () => {
  const source = await import("../src/asset-discovery.js");
  assert.doesNotMatch(source.listLoadedAssetUrls.toString(), /querySelector|__reactFiber/u);
});

test("bridge callは引数をJSONとして閉じ込める", () => {
  let captured: unknown;
  const expression = createBridgeCallExpression("startChat", [
    { prompt: "`);globalThis.pwned=true;//" },
  ]);
  const context = {
    __gptConnectorBridgeV1: {
      startChat: (input: unknown) => {
        captured = input;
      },
    },
  };

  vm.runInNewContext(expression, context);
  assert.equal(
    (captured as { prompt?: unknown } | undefined)?.prompt,
    "`);globalThis.pwned=true;//",
  );
  assert.equal("pwned" in context, false);
});
