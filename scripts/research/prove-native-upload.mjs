#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import process from "node:process";

import {
  discoverRuntimeAssets,
  listLoadedAssetUrls,
} from "../../dist/src/asset-discovery.js";
import { CdpClient, discoverChatGptTarget } from "../../dist/src/cdp.js";

const endpoint = process.env.GPT_CONNECTOR_CDP_ENDPOINT ?? "http://127.0.0.1:9223";
const fixture = resolve(
  process.env.GPT_CONNECTOR_UPLOAD_FIXTURE ??
    "test/fixtures/native-attachment/probe.txt",
);
const emptyFile = process.env.GPT_CONNECTOR_UPLOAD_EMPTY === "1";
const fault = process.env.GPT_CONNECTOR_UPLOAD_FAULT ?? "none";
if (!new Set(["none", "auth_401", "storage_throw", "create_timeout"]).has(fault)) {
  throw new Error(`unsupported research fault: ${fault}`);
}
const bytes = emptyFile ? Buffer.alloc(0) : await readFile(fixture);
const target = await discoverChatGptTarget(endpoint);
const client = await CdpClient.connect(target.webSocketDebuggerUrl);
await client.call("Runtime.enable");
const assets = await discoverRuntimeAssets(await listLoadedAssetUrls(client));
const imageMimeAllowlist = (process.env.GPT_CONNECTOR_IMAGE_MIME_ALLOWLIST ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const payload = JSON.stringify({
  assets: {
    coreUrl: assets.coreUrl,
    conversationUrl: assets.conversationUrl,
    uploadUrl: assets.uploadUrl,
  },
  base64: bytes.toString("base64"),
  fault,
  imageMimeAllowlist,
  name: emptyFile ? "empty.txt" : basename(fixture),
  type: process.env.GPT_CONNECTOR_UPLOAD_MIME ?? "text/plain",
});

const expression = String.raw`(async () => {
  const payload = ${payload};
  if (document.readyState !== "complete") {
    await new Promise((resolve) => addEventListener("load", resolve, { once: true }));
  }
  const uploadModule = await import(payload.assets.uploadUrl);
  const uploadObjects = [];
  for (const value of Object.values(uploadModule)) {
    if (typeof value !== "object" || value === null) continue;
    const keys = Object.keys(value).sort();
    if (
      keys.includes("attachLibraryFile") &&
      keys.includes("createFileCompleted") &&
      keys.includes("uploadCompleted") &&
      typeof value.uploadFile === "function" &&
      !uploadObjects.some((item) => item.value === value)
    ) uploadObjects.push({ url: payload.assets.uploadUrl, value });
  }
  if (uploadObjects.length !== 1) {
    throw new Error("upload object discovery was not unique: " + uploadObjects.length);
  }
  let files = [];
  const files$ = () => files;
  files$.set = (next) => {
    files = typeof next === "function" ? next(files) : next;
  };
  const errors = [];
  const intl = {
    formatMessage(descriptor, values = {}) {
      let message = descriptor?.defaultMessage ?? descriptor?.id ?? "upload error";
      for (const [key, value] of Object.entries(values)) {
        message = message.replaceAll("{" + key + "}", String(value));
      }
      return message;
    },
  };
  const toaster = {
    danger() {},
    info() {},
    toasts$: () => [],
  };
  const binary = atob(payload.base64);
  const body = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    body[index] = binary.charCodeAt(index);
  }
  const file = new File([body], payload.name, {
    type: payload.type,
    lastModified: 0,
  });
  const tempId = crypto.randomUUID();
  const faultHits = [];
  const restorers = [];
  if (payload.fault === "auth_401" || payload.fault === "create_timeout") {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = function (...args) {
      const input = args[0];
      const url = typeof input === "string" ? input : input?.url;
      if (typeof url === "string" && new URL(url, location.origin).pathname === "/backend-api/files") {
        faultHits.push(payload.fault);
        if (payload.fault === "create_timeout") return new Promise(() => {});
        return Promise.resolve(new Response("{}", {
          status: 401,
          headers: { "content-type": "application/json" },
        }));
      }
      return Reflect.apply(originalFetch, this, args);
    };
    restorers.push(() => { globalThis.fetch = originalFetch; });
  }
  if (payload.fault === "storage_throw") {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    const urls = new WeakMap();
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      urls.set(this, String(url));
      return Reflect.apply(originalOpen, this, [method, url, ...rest]);
    };
    XMLHttpRequest.prototype.send = function (...args) {
      const url = urls.get(this);
      if (typeof url === "string") {
        const parsed = new URL(url, location.origin);
        if (parsed.hostname.endsWith("oaiusercontent.com") && parsed.pathname.includes("/files/")) {
          faultHits.push("storage_throw");
          throw new DOMException("injected storage failure", "NetworkError");
        }
      }
      return Reflect.apply(originalSend, this, args);
    };
    restorers.push(() => {
      XMLHttpRequest.prototype.open = originalOpen;
      XMLHttpRequest.prototype.send = originalSend;
    });
  }
  try {
    await uploadObjects[0].value.uploadFile(
      { files$ },
      tempId,
      file,
      3,
      payload.imageMimeAllowlist,
      intl,
      toaster,
      {
        entrySurface: "composer",
        selectionMethod: "file_picker",
        isBigPaste: false,
        isUnauthenticated: false,
        isTemporaryChat: false,
        isProjectThread: false,
        onUploadError(_file, error) {
          errors.push({
            name: error?.name ?? null,
            code: error?.code ?? null,
            status: error?.status ?? null,
          });
        },
        suppressDefaultErrorToast: true,
      },
      undefined,
    );
  } finally {
    for (const restore of restorers.reverse()) restore();
  }
  const result = files.find((item) => item.tempId === tempId) ?? null;
  globalThis.__gptNativeUploadProofV1 = {
    assets: payload.assets,
    result,
  };
  return {
    assetMatches: 1,
    imageMimeAllowlist: payload.imageMimeAllowlist,
    uploadObjectMatches: uploadObjects.length,
    fault: payload.fault,
    faultHits,
    errors,
    result: result == null ? null : {
      status: result.status,
      progress: result.progress,
      source: result.source,
      hasFileId: typeof result.fileId === "string" && result.fileId.length > 0,
      hasFileSpec: result.fileSpec != null,
      fileSpec: result.fileSpec == null ? null : {
        name: result.fileSpec.name,
        size: result.fileSpec.size,
        mimeType: result.fileSpec.mimeType,
        hasId: typeof result.fileSpec.id === "string" && result.fileSpec.id.length > 0,
        hasLibraryFileId:
          typeof result.fileSpec.libraryFileId === "string" &&
          result.fileSpec.libraryFileId.length > 0,
      },
    },
  };
})()`;

try {
  let response;
  try {
    response = await client.call(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true },
      fault === "create_timeout" ? 1_500 : 120_000,
    );
  } catch (error) {
    if (fault !== "create_timeout") throw error;
    await client.call("Page.reload", { ignoreCache: false });
    process.stdout.write(`${JSON.stringify({
      fault,
      timedOut: true,
      pageReloaded: true,
      errorCode: error?.code ?? null,
    }, null, 2)}\n`);
    process.exitCode = 0;
    response = null;
  }
  if (response != null) {
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    }
    process.stdout.write(`${JSON.stringify(response.result?.value ?? null, null, 2)}\n`);
  }
} finally {
  client.close();
}
