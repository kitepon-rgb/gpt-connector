#!/usr/bin/env node

import process from "node:process";

import { CdpClient, discoverChatGptTarget } from "../../dist/src/cdp.js";

const endpoint = process.env.GPT_CONNECTOR_CDP_ENDPOINT ?? "http://127.0.0.1:9223";
const durationMs = Number.parseInt(process.env.GPT_CONNECTOR_OBSERVE_MS ?? "60000", 10);
const safeValueKeys = new Set([
  "author_role",
  "content_type",
  "file_size",
  "height",
  "mime_type",
  "role",
  "size",
  "status",
  "type",
  "use_case",
  "width",
]);

if (!Number.isFinite(durationMs) || durationMs < 1_000 || durationMs > 300_000) {
  throw new Error("GPT_CONNECTOR_OBSERVE_MSは1000〜300000の整数で指定してください。");
}

function summarize(value, key = "root", depth = 0) {
  if (depth > 6) return { kind: "depth_limit" };
  if (value === null) return { kind: "null" };
  if (Array.isArray(value)) {
    return {
      kind: "array",
      length: value.length,
      items: value.slice(0, 3).map((item) => summarize(item, key, depth + 1)),
    };
  }
  if (typeof value === "object") {
    return {
      kind: "object",
      fields: Object.fromEntries(
        Object.entries(value)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([childKey, child]) => [childKey, summarize(child, childKey, depth + 1)]),
      ),
    };
  }
  if (safeValueKeys.has(key) && ["string", "number", "boolean"].includes(typeof value)) {
    return { kind: typeof value, value };
  }
  if (typeof value === "string") {
    return { kind: "string", length: value.length };
  }
  return { kind: typeof value };
}

const target = await discoverChatGptTarget(endpoint);
const client = await CdpClient.connect(target.webSocketDebuggerUrl);
const pending = new Set();
let matched = 0;

const off = client.onEvent((event) => {
  if (event.method !== "Network.requestWillBeSent") return;
  const params = event.params ?? {};
  const request = params.request ?? {};
  if (request.method !== "POST" || typeof request.url !== "string") return;
  let path;
  try {
    path = new URL(request.url).pathname;
  } catch {
    return;
  }
  if (!path.endsWith("/f/conversation")) return;
  matched += 1;
  const task = client
    .call("Network.getRequestPostData", { requestId: params.requestId })
    .then((result) => {
      const bytes = typeof result.postData === "string" ? Buffer.byteLength(result.postData) : 0;
      let shape;
      try {
        shape = summarize(JSON.parse(result.postData));
      } catch {
        shape = { kind: "unparsed" };
      }
      process.stdout.write(`${JSON.stringify({ event: "conversation_request", bytes, shape })}\n`);
    })
    .catch(() => {
      process.stdout.write(`${JSON.stringify({ event: "conversation_request_unavailable" })}\n`);
    })
    .finally(() => pending.delete(task));
  pending.add(task);
});

try {
  await client.call("Network.enable", { maxPostDataSize: 0 });
  process.stdout.write(`${JSON.stringify({ event: "ready", durationMs })}\n`);
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  await Promise.allSettled([...pending]);
  process.stdout.write(`${JSON.stringify({ event: "done", matched })}\n`);
} finally {
  off();
  client.close();
}
