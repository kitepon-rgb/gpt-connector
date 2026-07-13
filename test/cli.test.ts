import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

function runCli(...args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", resolve("src/cli.ts"), ...args], {
    encoding: "utf8",
    env: { ...process.env, GPT_CONNECTOR_ENDPOINT: "http://127.0.0.1:1" },
  });
}

test("--helpはCDP接続前にusageを表示する", () => {
  const result = runCli("--help");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^usage: gpt-connector/u);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /CDP_UNAVAILABLE/u);
});

test("引数なしもCDP接続前にusageを表示する", () => {
  const result = runCli();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^usage: gpt-connector/u);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /CDP_UNAVAILABLE/u);
});
