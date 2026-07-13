import assert from "node:assert/strict";
import test from "node:test";

import { mcpServerVersion, mcpToolNames } from "../src/mcp-server.js";
import { packageVersion } from "../src/version.js";

test("MCP tool名を固定する", () => {
  assert.deepEqual(mcpToolNames, [
    "chatgpt_models",
    "chatgpt_chat",
    "chatgpt_close",
    "consult",
    "sessions",
    "diagnostics",
  ]);
});

test("MCP server versionをpackage公開versionと一致させる", () => {
  assert.equal(mcpServerVersion, packageVersion);
});
