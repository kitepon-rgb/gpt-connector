#!/usr/bin/env node

import { createHash } from "node:crypto";
import process from "node:process";

import { CdpClient, discoverChatGptTarget } from "../../dist/src/cdp.js";

const endpoint = process.env.GPT_CONNECTOR_CDP_ENDPOINT ?? "http://127.0.0.1:9223";
const durationMs = Number.parseInt(process.env.GPT_CONNECTOR_OBSERVE_MS ?? "45000", 10);
const sourceMarkers = [
  "/backend-api/files",
  "process_upload_stream",
  "library_file_id",
  "upload_url",
  "use_case",
  "file_id",
];

if (!Number.isFinite(durationMs) || durationMs < 1_000 || durationMs > 300_000) {
  throw new Error("GPT_CONNECTOR_OBSERVE_MSは1000〜300000の整数で指定してください。");
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function collectFrames(stack, frames = []) {
  if (!stack || typeof stack !== "object") return frames;
  if (Array.isArray(stack.callFrames)) frames.push(...stack.callFrames);
  if (stack.parent) collectFrames(stack.parent, frames);
  return frames;
}

function relevant(raw) {
  try {
    const url = new URL(raw);
    return (
      url.pathname === "/backend-api/files" ||
      url.pathname.endsWith("/process_upload_stream") ||
      (url.hostname.endsWith(".oaiusercontent.com") && /\/files\/[^/]+\/raw$/u.test(url.pathname))
    );
  } catch {
    return false;
  }
}

const target = await discoverChatGptTarget(endpoint);
const client = await CdpClient.connect(target.webSocketDebuggerUrl);
const pending = new Set();
const sourceCache = new Map();
let matched = 0;

async function sourceSummary(url) {
  if (sourceCache.has(url)) return sourceCache.get(url);
  const task = (async () => {
    try {
      const response = await fetch(url);
      if (!response.ok) return { available: false, status: response.status };
      const source = await response.text();
      return {
        available: true,
        fingerprint: hash(source),
        bytes: Buffer.byteLength(source),
        markers: sourceMarkers.filter((marker) => source.includes(marker)),
      };
    } catch {
      return { available: false, status: null };
    }
  })();
  sourceCache.set(url, task);
  return task;
}

const off = client.onEvent((event) => {
  if (event.method !== "Network.requestWillBeSent") return;
  const params = event.params ?? {};
  const request = params.request ?? {};
  if (typeof request.url !== "string" || !relevant(request.url)) return;
  matched += 1;
  const frames = collectFrames(params.initiator?.stack)
    .filter((frame) => typeof frame.url === "string" && frame.url.length > 0)
    .slice(0, 12);
  const task = Promise.all(
    frames.map(async (frame) => ({
      functionName: typeof frame.functionName === "string" ? frame.functionName : "",
      lineNumber: typeof frame.lineNumber === "number" ? frame.lineNumber : null,
      columnNumber: typeof frame.columnNumber === "number" ? frame.columnNumber : null,
      urlFingerprint: hash(frame.url),
      source: await sourceSummary(frame.url),
    })),
  )
    .then((summaries) => {
      const url = new URL(request.url);
      process.stdout.write(
        `${JSON.stringify({
          event: "upload_initiator",
          request: url.pathname.endsWith("process_upload_stream")
            ? "process_upload_stream"
            : url.hostname.endsWith(".oaiusercontent.com")
              ? "raw_put"
              : "file_init",
          frames: summaries,
        })}\n`,
      );
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
