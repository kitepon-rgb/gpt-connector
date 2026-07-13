#!/usr/bin/env node

import process from "node:process";

import { CdpClient, discoverChatGptTarget } from "../../dist/src/cdp.js";
import {
  bridgeBuildId,
  bridgeGlobalName,
  createBridgeBootstrapExpression,
  createBridgeCallExpression,
} from "../../dist/src/page-bridge.js";

const endpoint = process.env.GPT_CONNECTOR_CDP_ENDPOINT ?? "http://127.0.0.1:9223";
const model = process.env.GPT_CONNECTOR_PROBE_MODEL ?? "gpt-5-6-thinking";
const effort = process.env.GPT_CONNECTOR_PROBE_EFFORT ?? "extended";
const expectedName = process.env.GPT_CONNECTOR_PROBE_EXPECTED_NAME ?? "visual-marker.png";
const expectedMimeType = process.env.GPT_CONNECTOR_PROBE_EXPECTED_MIME ?? "image/png";
const expectedMarker = process.env.GPT_CONNECTOR_PROBE_EXPECTED_MARKER ?? "MARKER 7Q4M";
const prompt =
  process.env.GPT_CONNECTOR_PROBE_PROMPT ??
  "添付画像の中央に黄色で書かれた英数字を、空白も含めてそのまま回答してください。説明は不要です。";
const researchUploadHandle = "research-existing-native-upload";
const target = await discoverChatGptTarget(endpoint);
const client = await CdpClient.connect(target.webSocketDebuggerUrl);

async function evaluate(expression, awaitPromise = true, timeoutMs = 30_000) {
  const response = await client.call(
    "Runtime.evaluate",
    { expression, awaitPromise, returnByValue: true },
    timeoutMs,
  );
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  }
  return response.result?.value;
}

let completed = false;
try {
  const uploadState = await evaluate(`(() => {
    const proof = globalThis.__gptNativeUploadProofV1;
    const uploaded = proof?.result;
    const spec = uploaded?.fileSpec;
    return {
      ready: uploaded?.status === "ready",
      hasRuntimeAssets:
        typeof proof?.assets?.coreUrl === "string" &&
        typeof proof?.assets?.conversationUrl === "string" &&
        typeof proof?.assets?.uploadUrl === "string",
      fileName: spec?.name ?? null,
      fileSize: spec?.size ?? null,
      mimeType: spec?.mimeType ?? uploaded?.file?.type ?? null,
      width: spec?.width ?? null,
      height: spec?.height ?? null,
    };
  })()`);
  if (
    !uploadState?.ready ||
    !uploadState.hasRuntimeAssets ||
    uploadState.fileName !== expectedName ||
    uploadState.mimeType !== expectedMimeType
  ) {
    throw new Error("UI-independent upload proof is not ready or metadata differs");
  }

  const assets = await evaluate("globalThis.__gptNativeUploadProofV1.assets");
  let bootstrap = createBridgeBootstrapExpression(
    assets.coreUrl,
    assets.conversationUrl,
    assets.uploadUrl,
  );

  const researchUploadSeed = `
  const researchUploaded = globalThis.__gptNativeUploadProofV1?.result;
  const researchSpec = researchUploaded?.fileSpec;
  const researchMimeType = researchSpec?.mimeType ?? researchUploaded?.file?.type ?? null;
  if (
    researchUploaded?.status !== "ready" ||
    researchSpec?.name !== ${JSON.stringify(expectedName)} ||
    researchMimeType !== ${JSON.stringify(expectedMimeType)}
  ) {
    throw new Error("RUNTIME_DRIFT:research_upload_metadata");
  }
  uploads.set(${JSON.stringify(researchUploadHandle)}, {
    state: "ready",
    name: researchSpec.name,
    size: researchSpec.size,
    mimeType: researchMimeType,
    attachment: normalizeUploadedAttachment({
      name: researchSpec.name,
      size: researchSpec.size,
      mimeType: researchMimeType
    }, researchUploaded)
  });

  const readBackAttachments = async`;
  const readBackAnchor = "  const readBackAttachments = async";
  if (!bootstrap.includes(readBackAnchor)) {
    throw new Error("research upload seed anchor drifted");
  }
  bootstrap = bootstrap.replace(readBackAnchor, researchUploadSeed);

  const proofAnchor = `          const attachmentSummary = await readBackAttachments(
            session.conversation,
            attachments
          );`;
  const proofReplacement = `${proofAnchor}
          globalThis.__gptAttachmentConversationProofV1 = {
            serverId: serverIdOf(session.conversation)
          };`;
  if (!bootstrap.includes(proofAnchor)) {
    throw new Error("conversation proof anchor drifted");
  }
  bootstrap = bootstrap.replace(proofAnchor, proofReplacement);

  await evaluate(`delete globalThis[${JSON.stringify(bridgeGlobalName)}]`);
  const summary = await evaluate(bootstrap, true, 120_000);
  if (
    summary?.ready !== true ||
    summary?.version !== 1 ||
    summary?.buildId !== bridgeBuildId
  ) {
    throw new Error("research bridge bootstrap failed");
  }

  const started = await evaluate(
    createBridgeCallExpression("startChat", [{
      prompt,
      model,
      effort,
      keepOpen: false,
      attachmentHandles: [researchUploadHandle],
    }]),
    false,
  );
  if (typeof started?.operationId !== "string") {
    throw new Error("chat operation was not started");
  }

  const deadline = Date.now() + 180_000;
  let envelope;
  while (Date.now() < deadline) {
    envelope = await evaluate(
      createBridgeCallExpression("poll", [started.operationId, false]),
      false,
    );
    if (envelope?.state === "succeeded" || envelope?.state === "failed") break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (envelope?.state !== "succeeded") {
    throw new Error(
      `chat operation failed: ${envelope?.error?.code ?? "timeout"}:` +
      `${envelope?.error?.message ?? "no terminal result"}`,
    );
  }
  await evaluate(createBridgeCallExpression("poll", [started.operationId, true]), false);

  const diagnostics = await evaluate(
    `globalThis[${JSON.stringify(bridgeGlobalName)}].diagnostics()`,
  );
  const result = envelope.result;
  const attachmentReadback = result?.attachments ?? null;
  if (
    attachmentReadback?.count !== 1 ||
    attachmentReadback?.names?.[0] !== expectedName ||
    attachmentReadback?.mimeTypes?.[0] !== expectedMimeType
  ) {
    throw new Error("ATTACHMENT_READBACK_FAILED:metadata_mismatch");
  }
  if (result?.text?.trim() !== expectedMarker) {
    throw new Error("VISUAL_MARKER_MISMATCH");
  }

  const serverId = await evaluate(
    "globalThis.__gptAttachmentConversationProofV1?.serverId ?? null",
  );
  if (typeof serverId !== "string" || serverId.length < 32) {
    throw new Error("archived conversation server ID was not observed");
  }
  completed = true;

  process.stdout.write(`${JSON.stringify({
    upload: {
      nameMatched: uploadState.fileName === expectedName,
      mimeMatched: uploadState.mimeType === expectedMimeType,
      size: uploadState.fileSize,
      width: uploadState.width,
      height: uploadState.height,
      status: "ready",
    },
    conversationArchived: true,
    markerMatched: result?.text?.trim() === expectedMarker,
    response: result?.text?.trim() ?? null,
    status: result?.status ?? null,
    endTurn: result?.endTurn ?? null,
    resolvedModel: result?.resolvedModel ?? null,
    resolvedEffort: result?.resolvedEffort ?? null,
    attachmentReadback,
    diagnostics,
  }, null, 2)}\n`);
} finally {
  if (completed) {
    await evaluate(`delete globalThis[${JSON.stringify(bridgeGlobalName)}]`).catch(() => {});
    await evaluate("delete globalThis.__gptNativeUploadProofV1").catch(() => {});
    await evaluate("delete globalThis.__gptAttachmentConversationProofV1").catch(() => {});
  }
  client.close();
}
