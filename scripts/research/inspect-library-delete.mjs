#!/usr/bin/env node

import process from "node:process";

import { CdpClient, discoverChatGptTarget } from "../../dist/src/cdp.js";

const endpoint = process.env.GPT_CONNECTOR_CDP_ENDPOINT ?? "http://127.0.0.1:9223";
const target = await discoverChatGptTarget(endpoint);
const client = await CdpClient.connect(target.webSocketDebuggerUrl);

const expression = String.raw`(async () => {
  const html = await fetch("/library", { credentials: "include" })
    .then((response) => response.text());
  const paths = [...new Set([...html.matchAll(
    /\/cdn\/assets\/[a-zA-Z0-9_-]+\.js/g,
  )].map((match) => match[0]))];
  const results = [];
  for (const path of paths) {
    const source = await fetch(path).then((response) => response.text());
    const safeDeletePattern = new RegExp(
      "safeDelete\\(\\x60([^\\x60]+)\\x60",
      "g",
    );
    const literalPattern = new RegExp(
      "[\\x60\"](\\/(?:library|files)[^\\x60\"]*)[\\x60\"]|" +
        "[\\x60\"]([^\\x60\"]*(?:library|files)[^\\x60\"]*)[\\x60\"]",
      "g",
    );
    const safeDeletePaths = [...source.matchAll(safeDeletePattern)]
      .map((match) => match[1]);
    const literalPaths = [...source.matchAll(literalPattern)]
      .map((match) => match[1] ?? match[2]).filter((value) =>
      typeof value === "string" && value.startsWith("/") && value.length < 180);
    const markers = {
      deleteForever: source.includes("Delete forever"),
      recentlyDeleted: source.includes("Recently deleted"),
      safeDelete: source.includes("safeDelete"),
    };
    const relevantPaths = [...new Set([...safeDeletePaths, ...literalPaths])]
      .filter((value) => value.includes("file") || value.includes("library"));
    if (markers.deleteForever || markers.recentlyDeleted || relevantPaths.length > 0) {
      results.push({
        assetPath: path,
        bytes: new TextEncoder().encode(source).byteLength,
        markers,
        paths: relevantPaths,
      });
    }
  }
  return { scanned: paths.length, results };
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
