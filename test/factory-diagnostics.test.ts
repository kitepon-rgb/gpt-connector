import assert from "node:assert/strict";
import test from "node:test";

import { factoryDiagnostics, factoryDiagnosticsSchema } from "../src/factory-diagnostics.js";
import { ConnectorError } from "../src/errors.js";

test("factory diagnosticsはCDP不在でもread-only固定check IDsを返す", async () => {
  const result = await factoryDiagnostics({ endpoint: "http://127.0.0.1:1" });
  assert.equal(result.schema, factoryDiagnosticsSchema);
  assert.equal(result.overall, "not_ready");
  assert.deepEqual(result.checks.map((check) => check.id), ["version", "state_schema", "job_schema", "migration", "cdp", "official_origin", "auth", "runtime_bridge", "mcp_contract"]);
  assert.equal(result.checks.find((check) => check.id === "cdp")?.status, "not_ready");
  assert.equal(result.checks.find((check) => check.id === "runtime_bridge")?.status, "unverified");
});

test("factory diagnosticsは不正なuser endpointを通常入力拒否しbugへ分類しない", async () => {
  await assert.rejects(
    factoryDiagnostics({ endpoint: "https://example.com" }),
    (error) => error instanceof ConnectorError && error.code === "INVALID_INPUT",
  );
});
