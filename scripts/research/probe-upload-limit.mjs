#!/usr/bin/env node

import process from "node:process";

import { CdpClient, discoverChatGptTarget } from "../../dist/src/cdp.js";

const endpoint = process.env.GPT_CONNECTOR_CDP_ENDPOINT ?? "http://127.0.0.1:9223";
const target = await discoverChatGptTarget(endpoint);
const client = await CdpClient.connect(target.webSocketDebuggerUrl);

const expression = String.raw`(async () => {
  const candidates = [...new Set([
    ...[...document.querySelectorAll('script[type="module"]')]
      .flatMap((script) =>
        script.textContent.match(/\/cdn\/assets\/[a-zA-Z0-9_-]+\.js/g) ?? [])
      .map((path) => new URL(path, location.origin).href),
    ...performance.getEntriesByType("resource").map((entry) => entry.name),
  ])].filter((url) => url.includes("/cdn/assets/") && url.includes(".js"));
  const queue = [...candidates];
  const seen = new Set();
  let uploadObject;
  let uploadSource = "";
  while (queue.length > 0 && seen.size < 200 && uploadObject == null) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    const source = await fetch(url).then((response) => response.text());
    if (
      source.includes("process_upload_stream") &&
      source.includes("attachLibraryFile") &&
      source.includes("uploadFile:async")
    ) {
      const module = await import(url);
      uploadObject = Object.values(module).find((value) =>
        value && typeof value === "object" &&
        typeof value.uploadFile === "function" &&
        typeof value.attachLibraryFile === "function");
      uploadSource = source;
      if (uploadObject) break;
    }
    for (const match of source.matchAll(
      /(?:https:\/\/chatgpt\.com)?(?:\/cdn\/assets\/|\.\.?\/)[a-zA-Z0-9_-]+\.js/g,
    )) {
      const discovered = new URL(match[0], url).href;
      if (discovered.startsWith("https://chatgpt.com/cdn/assets/") && !seen.has(discovered)) {
        queue.push(discovered);
      }
    }
  }
  if (!uploadObject) throw new Error("upload object was not found");
  let firstBlockedAt = null;
  let reportedMax = null;
  for (let count = 0; count <= 100; count += 1) {
    let files = Array.from({ length: count }, (_, index) => ({
      tempId: "existing-" + index,
      status: "ready",
      fileSignature: "existing-signature-" + index,
    }));
    const files$ = () => files;
    files$.set = (next) => {
      files = typeof next === "function" ? next(files) : next;
    };
    let blocked = false;
    const intl = {
      formatMessage(_descriptor, values = {}) {
        if (typeof values.maxUploads === "number") reportedMax = values.maxUploads;
        return "blocked";
      },
    };
    const toaster = {
      danger() { blocked = true; },
      info() {},
      toasts$: () => [],
    };
    await uploadObject.uploadFile(
      { files$ },
      crypto.randomUUID(),
      new File(["x"], "limit-probe.txt", { type: "text/plain" }),
      3,
      [],
      intl,
      toaster,
      {
        entrySurface: "composer",
        selectionMethod: "file_picker",
        isBigPaste: false,
        skipUpload: true,
      },
      undefined,
    );
    if (blocked) {
      firstBlockedAt = count;
      break;
    }
  }
  const firstFile = new File(["xx"], "same-name.txt", {
    type: "text/plain",
    lastModified: 1,
  });
  const secondFile = new File(["x"], "same-name.txt", {
    type: "text/plain",
    lastModified: 1,
  });
  let sameNameFiles = [{
    tempId: "existing",
    status: "ready",
    fileSignature: JSON.stringify({
      name: firstFile.name,
      size: firstFile.size,
      lastModified: firstFile.lastModified,
      type: firstFile.type,
    }),
  }];
  const sameNameFiles$ = () => sameNameFiles;
  sameNameFiles$.set = (next) => {
    sameNameFiles = typeof next === "function" ? next(sameNameFiles) : next;
  };
  await uploadObject.uploadFile(
    { files$: sameNameFiles$ },
    crypto.randomUUID(),
    secondFile,
    3,
    [],
    { formatMessage: () => "message" },
    { danger() {}, info() {}, toasts$: () => [] },
    {
      entrySurface: "composer",
      selectionMethod: "file_picker",
      isBigPaste: false,
      skipUpload: true,
    },
    undefined,
  );
  return {
    firstBlockedAt,
    reportedMax,
    networkUsed: false,
    sameNameDifferentSignatureAccepted: sameNameFiles.length === 2,
    exactDuplicateSignatureRuleFound:
      uploadSource.includes("lastModified:e.lastModified") &&
      uploadSource.includes("fileSignature"),
  };
})()`;

try {
  const response = await client.call(
    "Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true },
    120_000,
  );
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  }
  process.stdout.write(`${JSON.stringify(response.result?.value ?? null, null, 2)}\n`);
} finally {
  client.close();
}
