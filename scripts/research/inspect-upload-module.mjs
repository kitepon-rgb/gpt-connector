#!/usr/bin/env node

import process from "node:process";
import { resolve } from "node:path";

import { CdpClient, discoverChatGptTarget } from "../../dist/src/cdp.js";

const endpoint = process.env.GPT_CONNECTOR_CDP_ENDPOINT ?? "http://127.0.0.1:9223";
const fixture = resolve(
  process.env.GPT_CONNECTOR_UPLOAD_FIXTURE ??
    "test/fixtures/native-attachment/probe-runtime.md",
);
const target = await discoverChatGptTarget(endpoint);
const client = await CdpClient.connect(target.webSocketDebuggerUrl);

const inspectExpression = String.raw`(async () => {
  const events = globalThis.__gptUploadStackProbeV1?.events ?? [];
  const stack = events.map((event) => event.stack).find((value) =>
    typeof value === "string" && (
      value.includes("/_next/static/chunks/") || value.includes("/cdn/assets/")
    )
  );
  const match = stack?.match(
    /(https:\/\/[^\s)]+(?:\/_next\/static\/chunks\/|\/cdn\/assets\/)[^:\s)]+\.js)/,
  );
  let assetUrl = match?.[1];
  if (!assetUrl) {
    const candidates = [...new Set(performance.getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((url) => url.includes("/_next/static/chunks/") && url.includes(".js")))];
    for (const url of candidates) {
      const source = await fetch(url).then((response) => response.text());
      if (
        source.includes("process_upload_stream") &&
        source.includes("attachLibraryFile") &&
        source.includes("uploadFile:async")
      ) {
        assetUrl = url;
        break;
      }
    }
  }
  if (!assetUrl) {
    return {
      diagnostic: events.map((event) => String(event.stack)
        .split("\n")
        .slice(1, 25)),
    };
  }
  const module = await import(assetUrl);
  return {
    uploadFile: Function.prototype.toString.call(module.ti.uploadFile),
    wrapper: Function.prototype.toString.call(module.cT),
  };
})()`;

try {
  await client.call("Runtime.evaluate", {
    expression: String.raw`(() => {
      globalThis.__gptUploadStackProbeV1?.restore?.();
      const originalFetch = globalThis.fetch;
      const originalOpen = XMLHttpRequest.prototype.open;
      const originalSend = XMLHttpRequest.prototype.send;
      const xhrUrls = new WeakMap();
      const events = [];
      globalThis.fetch = function (...args) {
        const input = args[0];
        const url = typeof input === "string" ? input : input?.url;
        if (typeof url === "string" && (
          url.includes("/backend-api/files") || url.includes("process_upload_stream")
        )) {
          events.push({ stack: new Error("upload-stack").stack });
        }
        return Reflect.apply(originalFetch, this, args);
      };
      XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        xhrUrls.set(this, String(url));
        return Reflect.apply(originalOpen, this, [method, url, ...rest]);
      };
      XMLHttpRequest.prototype.send = function (...args) {
        const url = xhrUrls.get(this);
        if (typeof url === "string" && (
          url.includes("/backend-api/files") ||
          url.includes("process_upload_stream") ||
          url.includes("oaiusercontent.com/files/")
        )) {
          events.push({ stack: new Error("upload-stack").stack });
        }
        return Reflect.apply(originalSend, this, args);
      };
      globalThis.__gptUploadStackProbeV1 = {
        events,
        restore() {
          globalThis.fetch = originalFetch;
          XMLHttpRequest.prototype.open = originalOpen;
          XMLHttpRequest.prototype.send = originalSend;
          delete globalThis.__gptUploadStackProbeV1;
        },
      };
      return true;
    })()`,
  });
  const input = await client.call("Runtime.evaluate", {
    expression: String.raw`[...document.querySelectorAll('input[type="file"]')]
      .find((element) => !String(element.accept).startsWith("image/"))`,
    returnByValue: false,
  });
  const objectId = input.result?.objectId;
  if (typeof objectId !== "string") throw new Error("general file input was not found");
  await client.call("DOM.setFileInputFiles", { files: [fixture], objectId });
  let eventCount = 0;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const count = await client.call("Runtime.evaluate", {
      expression: "globalThis.__gptUploadStackProbeV1?.events.length ?? 0",
      returnByValue: true,
    });
    eventCount = count.result?.value ?? 0;
    if (eventCount > 0) break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  }
  if (eventCount === 0) throw new Error("upload stack probe captured no event");
  const result = await client.call("Runtime.evaluate", {
    expression: inspectExpression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "Runtime.evaluate failed");
  }
  process.stdout.write(`${JSON.stringify(result.result?.value ?? null, null, 2)}\n`);
} finally {
  await client
    .call("Runtime.evaluate", {
      expression: "globalThis.__gptUploadStackProbeV1?.restore?.()",
    })
    .catch(() => {});
  await client.call("Page.reload", { ignoreCache: false }).catch(() => {});
  client.close();
}
