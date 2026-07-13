import { createHash } from "node:crypto";

import { ConnectorError } from "./errors.js";
import { evaluateByValue } from "./runtime-evaluate.js";
import type { CdpClient } from "./cdp.js";

export interface RuntimeAssets {
  readonly coreUrl: string;
  readonly conversationUrl: string;
  readonly coreFingerprint: string;
  readonly conversationFingerprint: string;
}

interface AssetCandidate {
  readonly url: string;
  readonly source: string;
}

const coreMarkers = [
  "/f/conversation/prepare",
  "conduit_token",
  "completion.submit.request",
] as const;

const conversationMarkers = [
  "contentToSend",
  "allSystemHints",
  "selectedSkillIds",
  "build_request_params.prompt_message",
] as const;

function allowedAssetUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "chatgpt.com" || url.hostname.endsWith(".oaistatic.com")) &&
      url.pathname.endsWith(".js")
    );
  } catch {
    return false;
  }
}

function fingerprint(source: string): string {
  return createHash("sha256").update(source).digest("hex").slice(0, 16);
}

function findUnique(
  role: string,
  candidates: readonly AssetCandidate[],
  markers: readonly string[],
): AssetCandidate {
  const matches = candidates.filter(({ source }) =>
    markers.every((marker) => source.includes(marker)),
  );

  if (matches.length !== 1) {
    throw new ConnectorError(
      "RUNTIME_DRIFT",
      `${role} assetを一意に検出できませんでした。`,
      { count: matches.length },
    );
  }

  return matches[0]!;
}

export async function listLoadedAssetUrls(client: CdpClient): Promise<readonly string[]> {
  const expression = String.raw`(() => Array.from(new Set([
    ...Array.from(document.scripts, (element) => element.src),
    ...Array.from(document.head.children)
      .filter((element) => element.tagName === "LINK" && element.rel === "modulepreload")
      .map((element) => element.href),
    ...performance.getEntriesByType("resource").map((entry) => entry.name)
  ])).filter(Boolean))()`;

  const raw = await evaluateByValue<unknown>(client, expression);
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string")) {
    throw new ConnectorError("RUNTIME_DRIFT", "loaded asset URL一覧の形式が不正です。");
  }

  return [...new Set(raw.filter(allowedAssetUrl))];
}

export async function discoverRuntimeAssets(
  urls: readonly string[],
  fetchImplementation: typeof fetch = fetch,
): Promise<RuntimeAssets> {
  const candidates = await Promise.all(
    urls.map(async (url): Promise<AssetCandidate | null> => {
      let response: Response;
      try {
        response = await fetchImplementation(url);
      } catch {
        return null;
      }
      if (!response.ok) return null;
      return { url, source: await response.text() };
    }),
  );

  const fetched = candidates.filter((candidate) => candidate !== null);
  const core = findUnique("core", fetched, coreMarkers);
  const conversation = findUnique("conversation", fetched, conversationMarkers);

  return {
    coreUrl: core.url,
    conversationUrl: conversation.url,
    coreFingerprint: fingerprint(core.source),
    conversationFingerprint: fingerprint(conversation.source),
  };
}
