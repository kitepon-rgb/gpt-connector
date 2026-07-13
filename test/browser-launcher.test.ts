import assert from "node:assert/strict";
import test from "node:test";
import { startBrowser } from "../src/browser-launcher.js";

test("macOS launcherはoffscreen CDP専用profileで起動しheadlessを渡さない", async () => {
  let command = ""; let args: readonly string[] = [];
  let calls = 0;
  const result = await startBrowser({ platform: "darwin", home: "/tmp/gpt-browser-test", endpointReady: async () => false, appReady: async () => ++calls >= 3, sleep: async () => {}, spawn: (c, a) => { command = c; args = a; return { once: () => undefined }; } });
  assert.equal(result.status, "started"); assert.equal(command, "open"); assert.ok(args.includes("--window-position=-32000,-32000")); assert.ok(args.includes("--remote-debugging-port=9223")); assert.ok(args.includes("--no-first-run")); assert.ok(args.includes("https://chatgpt.com/")); assert.ok(args.some((value) => value.includes(".gpt-connector/browser-profile"))); assert.ok(args.every((value) => !value.includes("headless")));
});
test("endpointとapp readyではspawnしない", async () => { let spawned = false; const result = await startBrowser({ platform: "darwin", endpointReady: async () => true, appReady: async () => true, spawn: () => { spawned = true; return { once: () => undefined }; } }); assert.equal(result.status, "already_ready"); assert.equal(spawned, false); });
test("非macOSはheadless fallbackせず拒否する", async () => { await assert.rejects(startBrowser({ platform: "linux", fetch: async () => { throw new Error("down"); } }), /未対応/); });
test("spawn errorを成功扱いせず拒否する", async () => { await assert.rejects(startBrowser({ platform: "darwin", fetch: async () => { throw new Error("down"); }, spawn: () => ({ once: (_event, listener) => { listener(new Error("open failed")); } }) }), /open failed/); });
test("endpoint readyでもapp loadingならspawnせず待機してalready_readyを返す", async () => { let probes = 0; let spawned = false; const result = await startBrowser({ platform: "darwin", endpointReady: async () => true, appReady: async () => ++probes >= 3, sleep: async () => {}, spawn: () => { spawned = true; return { once: () => undefined }; } }); assert.equal(result.status, "already_ready"); assert.equal(probes, 3); assert.equal(spawned, false); });
test("app ready timeoutを明示エラーにする", async () => { await assert.rejects(startBrowser({ platform: "darwin", endpointReady: async () => false, appReady: async () => false, sleep: async () => {}, spawn: () => ({ once: () => undefined }) }), /ChatGPT app/); });
