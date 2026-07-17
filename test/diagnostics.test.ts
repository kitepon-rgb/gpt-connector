import assert from "node:assert/strict";
import test from "node:test";

import { GptConnector } from "../src/connector.js";
import { bridgeBuildId } from "../src/page-bridge.js";
import { packageVersion } from "../src/version.js";

test("doctorはCDP不在でも固定schemaのnot_readyを返す", async () => {
  const result = await GptConnector.doctor({ endpoint: "http://127.0.0.1:1" });

  assert.deepEqual(result, {
    schema: "gpt-connector.diagnostics.v1",
    packageVersion,
    overall: "not_ready",
    reasonCode: "cdp_unavailable",
    cdpConnected: false,
    officialOrigin: null,
    authenticated: null,
    bridgeBuildId,
    sessionCount: null,
    operationCount: null,
    uploadCount: null,
    bufferedUploadBytes: null,
    downloadCount: null,
    bufferedDownloadBytes: null,
    jobCount: null,
    activeJobCount: null,
    terminalJobCount: null,
  });
});
