#!/usr/bin/env node

import { createHash } from "node:crypto";
import process from "node:process";

import { CdpClient, discoverChatGptTarget } from "../../dist/src/cdp.js";

const endpoint = process.env.GPT_CONNECTOR_CDP_ENDPOINT ?? "http://127.0.0.1:9223";
const durationMs = Number.parseInt(process.env.GPT_CONNECTOR_OBSERVE_MS ?? "30000", 10);
const target = await discoverChatGptTarget(endpoint);
const client = await CdpClient.connect(target.webSocketDebuggerUrl);
const pending = new Set();
const seen = new Set();

function hash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function framesOf(stack, frames = []) {
  if (!stack || typeof stack !== "object") return frames;
  if (Array.isArray(stack.callFrames)) frames.push(...stack.callFrames);
  if (stack.parent) framesOf(stack.parent, frames);
  return frames;
}

const off = client.onEvent((event) => {
  if (event.method !== "Network.requestWillBeSent") return;
  const params = event.params ?? {};
  const request = params.request ?? {};
  if (typeof request.url !== "string") return;
  let path;
  try {
    path = new URL(request.url).pathname;
  } catch {
    return;
  }
  if (path !== "/backend-api/files" && !path.endsWith("/process_upload_stream")) return;
  const frame = framesOf(params.initiator?.stack).find((item) => item?.scriptId);
  if (!frame || seen.has(frame.scriptId)) return;
  seen.add(frame.scriptId);
  const task = client
    .call("Debugger.getScriptSource", { scriptId: frame.scriptId })
    .then((result) => {
      const source = typeof result.scriptSource === "string" ? result.scriptSource : "";
      const lines = source.split("\n");
      const line = lines[frame.lineNumber] ?? "";
      const start = Math.max(0, frame.columnNumber - 3_000);
      const end = Math.min(line.length, frame.columnNumber + 5_000);
      process.stdout.write(
        `${JSON.stringify({
          event: "initiator_source",
          fingerprint: hash(source),
          bytes: Buffer.byteLength(source),
          lineNumber: frame.lineNumber,
          columnNumber: frame.columnNumber,
          lineLength: line.length,
          snippetStart: start,
          snippetEnd: end,
        })}\n`,
      );
      process.stdout.write(`${line.slice(start, end)}\n`);
    })
    .catch(() => process.stdout.write(`${JSON.stringify({ event: "source_unavailable" })}\n`))
    .finally(() => pending.delete(task));
  pending.add(task);
});

try {
  await client.call("Debugger.enable");
  await client.call("Network.enable", { maxPostDataSize: 0 });
  process.stdout.write(`${JSON.stringify({ event: "ready", durationMs })}\n`);
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  await Promise.allSettled([...pending]);
  process.stdout.write(`${JSON.stringify({ event: "done", sourceCount: seen.size })}\n`);
} finally {
  off();
  client.close();
}
