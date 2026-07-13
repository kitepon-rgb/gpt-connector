import assert from "node:assert/strict";
import test from "node:test";

import { mcpToolNames } from "../src/mcp-server.js";

test("MCP tool名を固定する", () => {
  assert.deepEqual(mcpToolNames, ["chatgpt_models", "chatgpt_chat", "chatgpt_close"]);
});
