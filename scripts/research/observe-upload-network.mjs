#!/usr/bin/env node

import process from "node:process";

import { CdpClient, discoverChatGptTarget } from "../../dist/src/cdp.js";

const endpoint = process.env.GPT_CONNECTOR_CDP_ENDPOINT ?? "http://127.0.0.1:9223";
const durationMs = Number.parseInt(process.env.GPT_CONNECTOR_OBSERVE_MS ?? "45000", 10);

if (!Number.isFinite(durationMs) || durationMs < 1_000 || durationMs > 300_000) {
  throw new Error("GPT_CONNECTOR_OBSERVE_MSは1000〜300000の整数で指定してください。");
}

const target = await discoverChatGptTarget(endpoint);
const client = await CdpClient.connect(target.webSocketDebuggerUrl);
const requests = new Map();
let sequence = 0;

function normalizedUrl(raw) {
  try {
    const url = new URL(raw);
    const path = url.pathname
      .split("/")
      .map((segment) => {
        if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment)) return ":uuid";
        if (segment.length > 48) return ":id";
        return segment;
      })
      .join("/");
    return {
      origin: url.origin,
      path,
      queryKeys: [...new Set([...url.searchParams.keys()])].sort(),
    };
  } catch {
    return { origin: "invalid", path: "invalid", queryKeys: [] };
  }
}

function safeContentType(headers) {
  const entry = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === "content-type");
  if (entry === undefined || typeof entry[1] !== "string") return null;
  return entry[1].split(";", 1)[0]?.trim() || null;
}

function safeContentLength(headers) {
  const entry = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === "content-length");
  if (entry === undefined) return null;
  const value = Number.parseInt(String(entry[1]), 10);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function relevant(method, type, url) {
  if (/upload|attachment|file|conversation/i.test(url)) return true;
  return method !== "GET" && (type === "Fetch" || type === "XHR");
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

const off = client.onEvent((event) => {
  const params = event.params ?? {};
  if (event.method === "Network.requestWillBeSent") {
    const request = params.request ?? {};
    const method = typeof request.method === "string" ? request.method : "UNKNOWN";
    const type = typeof params.type === "string" ? params.type : "Unknown";
    const url = typeof request.url === "string" ? request.url : "";
    if (!relevant(method, type, url)) return;
    const id = ++sequence;
    requests.set(params.requestId, id);
    emit({
      event: "request",
      id,
      method,
      type,
      url: normalizedUrl(url),
      contentType: safeContentType(request.headers),
      contentLength: safeContentLength(request.headers),
      postDataBytes: typeof request.postData === "string" ? Buffer.byteLength(request.postData) : null,
    });
    return;
  }

  if (event.method === "Network.responseReceived") {
    const id = requests.get(params.requestId);
    if (id === undefined) return;
    const response = params.response ?? {};
    emit({
      event: "response",
      id,
      status: typeof response.status === "number" ? response.status : null,
      mimeType: typeof response.mimeType === "string" ? response.mimeType : null,
      contentLength: safeContentLength(response.headers),
    });
    return;
  }

  if (event.method === "Network.loadingFailed") {
    const id = requests.get(params.requestId);
    if (id === undefined) return;
    emit({
      event: "failed",
      id,
      blockedReason: typeof params.blockedReason === "string" ? params.blockedReason : null,
      canceled: params.canceled === true,
    });
  }
});

try {
  await client.call("Network.enable", { maxPostDataSize: 0 });
  emit({ event: "ready", durationMs });
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  emit({ event: "done", observedRequests: sequence });
} finally {
  off();
  client.close();
}
