import assert from "node:assert/strict";
import test from "node:test";

import { imageOperationTimeoutMs, imageResolutionMatches } from "../src/connector.js";

test("画像生成は通常Chatの180秒を越えて待てる", () => {
  assert.equal(imageOperationTimeoutMs, 360_000);
});

test("画像生成はrequested model/effortとresolved値の完全一致だけを受け入れる", () => {
  assert.equal(imageResolutionMatches("gpt-5-6-thinking", "min", "gpt-5-6-thinking", "min"), true);
  assert.equal(imageResolutionMatches("gpt-5-6-thinking", "min", "gpt-5-4-auto-thinking", "min"), false);
  assert.equal(imageResolutionMatches("gpt-5-6-thinking", "min", "gpt-5-6-thinking", "standard"), false);
  assert.equal(imageResolutionMatches("gpt-5-6-thinking", "min", null, "min"), false);
});

test("effort未指定時もmodel一致は必須でresolved effortだけは問わない", () => {
  assert.equal(imageResolutionMatches("gpt-5-6-thinking", undefined, "gpt-5-6-thinking", null), true);
  assert.equal(imageResolutionMatches("gpt-5-6-thinking", undefined, "gpt-5-6-thinking", "standard"), true);
  assert.equal(imageResolutionMatches("gpt-5-6-thinking", undefined, "gpt-5-4-auto-thinking", null), false);
});
