import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { z } from "zod";

import {
  attachmentLimits,
  prepareAttachmentFiles,
  type PreparedAttachmentFile,
} from "./attachment-files.js";
import { discoverRuntimeAssets, listLoadedAssetUrls } from "./asset-discovery.js";
import { CdpClient, discoverChatGptTarget } from "./cdp.js";
import {
  chatInputSchema,
  closeInputSchema,
  consultInputSchema,
  sessionsInputSchema,
  type ChatInput,
  type ChatResult,
  type CloseInput,
  type CloseResult,
  type ConnectorDiagnostics,
  type ConsultDryRunResult,
  type ConsultInput,
  type ConsultSnapshot,
  type ModelCatalog,
  type SessionsInput,
} from "./contract.js";
import { ConsultJobStore } from "./consult-job-store.js";
import {
  ConnectorError,
  connectorErrorCodes,
  type ConnectorErrorCode,
} from "./errors.js";
import { validateModelSelection } from "./model-catalog.js";
import {
  bridgeBuildId,
  createBridgeBootstrapExpression,
  createBridgeCallExpression,
} from "./page-bridge.js";
import { evaluateByValue } from "./runtime-evaluate.js";
import { SessionRegistry } from "./session-registry.js";
import { packageVersion } from "./version.js";

const operationStartSchema = z.object({ operationId: z.string().uuid() });

const operationErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});

const operationEnvelopeSchema = z.object({
  state: z.enum(["pending", "succeeded", "failed"]),
  result: z.unknown().nullable().optional(),
  error: operationErrorSchema.nullable().optional(),
});

const modelCatalogSchema = z.object({
  defaultModel: z.string().nullable(),
  models: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      reasoningType: z.string().nullable(),
      efforts: z.array(z.string()),
      configurableEffort: z.boolean(),
      maxTokens: z.number().nullable(),
    }),
  ),
});

const chatResultSchema = z.object({
  text: z.string().min(1),
  status: z.string(),
  endTurn: z.literal(true),
  resolvedModel: z.string().nullable(),
  resolvedEffort: z.string().nullable(),
  sessionId: z.string().uuid().optional(),
});

const attachmentSummarySchema = z.object({
  count: z.number().int().nonnegative(),
  names: z.array(z.string()),
  mimeTypes: z.array(z.string().nullable()),
  readBack: z.literal("confirmed"),
  retention: z.literal("unknown"),
  cleanup: z.enum(["not_supported", "failed", "deleted"]),
});

const bridgeChatResultSchema = chatResultSchema.extend({
  attachments: attachmentSummarySchema,
});

type BridgeChatResult = z.output<typeof bridgeChatResultSchema>;

const uploadHandleSchema = z.object({ uploadHandle: z.string().uuid() });
const uploadChunkResultSchema = z.object({ receivedBytes: z.number().int().nonnegative() });
const uploadResultSchema = z.object({
  uploadHandle: z.string().uuid(),
  name: z.string(),
  size: z.number().int().positive(),
  mimeType: z.string(),
});

const uploadChunkBytes = 256 * 1024;

const closeResultSchema = z.object({ archived: z.literal(true) });

const pageDiagnosticsSchema = z.object({
  sessionCount: z.number().int().nonnegative(),
  operationCount: z.number().int().nonnegative(),
  uploadCount: z.number().int().nonnegative(),
  bufferedUploadBytes: z.number().int().nonnegative(),
});

export interface ConnectorOptions {
  readonly endpoint?: string;
  /** 有界なread-only readiness probeだけが差し替える内部transport。 */
  readonly fetch?: typeof globalThis.fetch;
  /** CDP handshake/callのtimeout。省略時は通常connectorの既定値を維持する。 */
  readonly cdpTimeoutMs?: number;
  readonly operationTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly stateDirectory?: string;
  /** Read-only diagnostics may inspect an existing job store but must never create or recover it. */
  readonly readOnlyJobs?: boolean;
}

interface AuthProbe {
  readonly status: number;
  readonly authenticated: boolean;
  readonly officialOrigin: boolean;
}

export class GptConnector {
  readonly #client: CdpClient;
  readonly #sessions = new SessionRegistry();
  readonly #jobs: ConsultJobStore;
  readonly #operationTimeoutMs: number;
  readonly #pollIntervalMs: number;

  private constructor(client: CdpClient, options: ConnectorOptions) {
    this.#client = client;
    this.#jobs = new ConsultJobStore({ stateDirectory: options.stateDirectory, readOnly: options.readOnlyJobs });
    this.#operationTimeoutMs = options.operationTimeoutMs ?? 180_000;
    this.#pollIntervalMs = options.pollIntervalMs ?? 250;
  }

  static async connect(options: ConnectorOptions = {}): Promise<GptConnector> {
    const endpoint = options.endpoint ?? "http://127.0.0.1:9223";
    const target = await discoverChatGptTarget(endpoint, options.fetch);
    const client = await CdpClient.connect(target.webSocketDebuggerUrl, options.cdpTimeoutMs);
    const connector = new GptConnector(client, options);

    try {
      await client.call("Runtime.enable");
      await connector.#jobs.initialize();
      await connector.#bootstrap();
      return connector;
    } catch (error) {
      try {
        connector.#jobs.close();
      } finally {
        client.close();
      }
      throw error;
    }
  }

  static async doctor(options: ConnectorOptions = {}): Promise<ConnectorDiagnostics> {
    let connector: GptConnector | null = null;
    try {
      connector = await GptConnector.connect(options);
      return await connector.diagnostics();
    } catch (error) {
      const code = error instanceof ConnectorError ? error.code : null;
      return {
        schema: "gpt-connector.diagnostics.v1",
        packageVersion,
        overall: "not_ready",
        reasonCode: diagnosticReason(code),
        cdpConnected: false,
        officialOrigin: null,
        authenticated: code === "AUTH_REQUIRED" ? false : null,
        bridgeBuildId,
        sessionCount: null,
        operationCount: null,
        uploadCount: null,
        bufferedUploadBytes: null,
        jobCount: null,
        activeJobCount: null,
        terminalJobCount: null,
      };
    } finally {
      connector?.close();
    }
  }

  async models(): Promise<ModelCatalog> {
    const result = await this.#runOperation("startModels", []);
    return modelCatalogSchema.parse(result);
  }

  async diagnostics(): Promise<ConnectorDiagnostics> {
    const page = pageDiagnosticsSchema.parse(
      await evaluateByValue<unknown>(
        this.#client,
        createBridgeCallExpression("diagnostics", []),
        false,
      ),
    );
    const jobs = this.#jobs.diagnostics();
    return {
      schema: "gpt-connector.diagnostics.v1",
      packageVersion,
      overall: "ready",
      reasonCode: "ready",
      cdpConnected: true,
      officialOrigin: true,
      authenticated: true,
      bridgeBuildId,
      ...page,
      ...jobs,
    };
  }

  async chat(input: ChatInput): Promise<ChatResult> {
    const parsed = chatInputSchema.parse(input);
    const result = await this.#chatParsed(parsed, []);
    return chatResultSchema.parse(result);
  }

  async consult(input: ConsultInput): Promise<ConsultSnapshot | ConsultDryRunResult> {
    let parsed: z.output<typeof consultInputSchema>;
    try {
      parsed = consultInputSchema.parse(input);
    } catch {
      throw new ConnectorError("INVALID_INPUT", "consult inputが公開schemaに一致しません。");
    }

    const catalog = await this.models();
    validateModelSelection(catalog, parsed.model, parsed.effort);

    const prepared = parsed.files === undefined
      ? { files: [] as readonly PreparedAttachmentFile[], totalBytes: 0 }
      : await prepareAttachmentFiles({
        workspaceRoot: parsed.workspaceRoot!,
        specs: parsed.files,
      });
    const fileMetadata = prepared.files.map((file) => ({
      relativePath: file.relativePath,
      name: file.name,
      bytes: file.bytes,
      mimeType: file.mimeType,
      sha256: file.sha256,
    }));

    if (parsed.dryRun) {
      for (const file of prepared.files) file.content.fill(0);
      return {
        dryRun: true,
        slug: parsed.slug,
        files: fileMetadata,
        totalBytes: prepared.totalBytes,
        requestedModel: parsed.model ?? null,
        requestedEffort: parsed.effort ?? null,
        limits: attachmentLimits,
        uploadWouldRun: false,
        conversationWouldRun: false,
      };
    }

    const fingerprint = consultFingerprint({
      prompt: parsed.prompt,
      files: fileMetadata,
      model: parsed.model ?? null,
      effort: parsed.effort ?? null,
      keepOpen: parsed.keepOpen,
    });
    const reservation = await this.#jobs.reserve(parsed.slug, fingerprint);
    if (!reservation.created) {
      for (const file of prepared.files) file.content.fill(0);
      return reservation.snapshot;
    }
    return this.#runConsultJob(parsed, prepared.files);
  }

  sessions(input: SessionsInput): ConsultSnapshot {
    let parsed: z.output<typeof sessionsInputSchema>;
    try {
      parsed = sessionsInputSchema.parse(input);
    } catch {
      throw new ConnectorError("INVALID_INPUT", "sessions inputが公開schemaに一致しません。");
    }
    return this.#jobs.get(parsed.slug);
  }

  async #runConsultJob(
    parsed: z.output<typeof consultInputSchema>,
    files: readonly PreparedAttachmentFile[],
  ): Promise<ConsultSnapshot> {
    let uploadHandles: readonly string[] = [];
    try {
      await this.#jobs.transition(parsed.slug, "uploading");
      uploadHandles = await this.#uploadAttachments(files);
      await this.#jobs.transition(parsed.slug, "submitted");
      await this.#jobs.transition(parsed.slug, "running");
      const result = await this.#chatParsed(
        {
          prompt: parsed.prompt,
          model: parsed.model,
          effort: parsed.effort,
          keepOpen: parsed.keepOpen,
        },
        uploadHandles,
        true,
      );
      return this.#jobs.transition(parsed.slug, "succeeded", {
        result: {
          text: result.text,
          status: result.status,
          endTurn: true,
          resolvedModel: result.resolvedModel,
          resolvedEffort: result.resolvedEffort,
          ...(result.sessionId === undefined ? {} : { sessionId: result.sessionId }),
          attachments: result.attachments,
          archived: parsed.keepOpen !== true,
        },
        error: null,
      });
    } catch (error) {
      let jobError = error;
      let cleanup: "not_supported" | "failed" = "not_supported";
      for (const uploadHandle of uploadHandles) {
        try {
          await this.#discardUpload(uploadHandle);
        } catch {
          // job errorをcleanup failureへ昇格し、成功や元errorの握り潰しを防ぐ。
          jobError = new ConnectorError(
            "UPLOAD_FAILED",
            "consult失敗後にpage側upload handleを完全破棄できませんでした。",
          );
          cleanup = "failed";
          break;
        }
      }
      const connectorError = jobError instanceof ConnectorError
        ? jobError
        : new ConnectorError("CHAT_FAILED", "consult jobが失敗しました。");
      const partialCount = typeof connectorError.details?.uploadedCount === "number"
        ? connectorError.details.uploadedCount
        : uploadHandles.length;
      const partialCleanup = connectorError.details?.cleanup === "failed"
        ? "failed"
        : cleanup;
      return this.#jobs.transition(parsed.slug, "failed", {
        result: null,
        error: {
          code: connectorError.code,
          message: connectorError.message,
          retry: retryFor(connectorError.code),
          ...(partialCount > 0 ? {
            partialUpload: { count: partialCount, cleanup: partialCleanup },
          } : {}),
        },
      });
    }
  }

  async #chatParsed(
    parsed: z.output<typeof chatInputSchema>,
    attachmentHandles: readonly string[],
    selectionValidated = false,
  ): Promise<BridgeChatResult> {
    if (!selectionValidated) {
      const catalog = await this.models();
      validateModelSelection(catalog, parsed.model, parsed.effort);
    }

    const existingSession = parsed.sessionId;
    if (existingSession !== undefined) this.#sessions.acquire(existingSession);

    try {
      const raw = await this.#runOperation("startChat", [
        { ...parsed, attachmentHandles },
      ]);
      const result = bridgeChatResultSchema.parse(raw);

      if (existingSession !== undefined) {
        if (parsed.keepOpen) this.#sessions.release(existingSession);
        else this.#sessions.delete(existingSession);
      } else if (result.sessionId !== undefined) {
        this.#sessions.register(result.sessionId);
      }

      return result;
    } catch (error) {
      if (existingSession !== undefined && this.#sessions.has(existingSession)) {
        if (
          parsed.keepOpen ||
          (error instanceof ConnectorError && error.code === "ARCHIVE_FAILED")
        ) {
          this.#sessions.release(existingSession);
        } else {
          this.#sessions.delete(existingSession);
        }
      }
      throw error;
    }
  }

  async #uploadAttachments(
    files: readonly PreparedAttachmentFile[],
  ): Promise<readonly string[]> {
    const uploadHandles: string[] = [];
    try {
      for (const file of files) {
        uploadHandles.push(await this.#transferAttachment(file));
      }
      return uploadHandles;
    } catch (error) {
      const cleanupFailures: string[] = [];
      for (const uploadHandle of uploadHandles) {
        try {
          await this.#discardUpload(uploadHandle);
        } catch (cleanupError) {
          cleanupFailures.push(
            cleanupError instanceof ConnectorError ? cleanupError.code : "RUNTIME_DRIFT",
          );
        }
      }
      if (cleanupFailures.length > 0) {
        throw new ConnectorError(
          "UPLOAD_FAILED",
          "添付upload失敗後にpage側handleを完全破棄できませんでした。",
          {
            cleanupFailureCount: cleanupFailures.length,
            uploadedCount: uploadHandles.length,
            cleanup: "failed",
            originalCode: error instanceof ConnectorError ? error.code : "UPLOAD_FAILED",
          },
        );
      }
      if (uploadHandles.length > 0) {
        const original = error instanceof ConnectorError
          ? error
          : new ConnectorError("UPLOAD_FAILED", "添付uploadが途中で失敗しました。");
        throw new ConnectorError(original.code, original.message, {
          uploadedCount: uploadHandles.length,
          cleanup: "not_supported",
        });
      }
      throw error;
    } finally {
      for (const file of files) file.content.fill(0);
    }
  }

  async #transferAttachment(file: PreparedAttachmentFile): Promise<string> {
    const created = uploadHandleSchema.parse(
      await evaluateByValue<unknown>(
        this.#client,
        createBridgeCallExpression("createUpload", [{
          name: file.name,
          mimeType: file.mimeType,
          size: file.bytes,
          sha256: file.sha256,
        }]),
        false,
      ),
    );

    try {
      for (let offset = 0; offset < file.content.byteLength; offset += uploadChunkBytes) {
        const length = Math.min(uploadChunkBytes, file.content.byteLength - offset);
        const base64Chunk = Buffer.from(
          file.content.buffer,
          file.content.byteOffset + offset,
          length,
        ).toString("base64");
        const appended = uploadChunkResultSchema.parse(
          await evaluateByValue<unknown>(
            this.#client,
            createBridgeCallExpression("appendUploadChunk", [
              created.uploadHandle,
              base64Chunk,
            ]),
            false,
          ),
        );
        if (appended.receivedBytes !== offset + length) {
          throw new ConnectorError(
            "UPLOAD_FAILED",
            "page側の添付byte受信数が一致しませんでした。",
          );
        }
      }

      const result = uploadResultSchema.parse(
        await this.#runOperation("startUpload", [{
          uploadHandle: created.uploadHandle,
          timeoutMs: Math.min(this.#operationTimeoutMs, 120_000),
        }]),
      );
      if (
        result.uploadHandle !== created.uploadHandle ||
        result.name !== file.name ||
        result.size !== file.bytes ||
        result.mimeType !== file.mimeType
      ) {
        throw new ConnectorError(
          "RUNTIME_DRIFT",
          "upload完了metadataが送信fileと一致しませんでした。",
        );
      }
      return created.uploadHandle;
    } catch (error) {
      await this.#discardUpload(created.uploadHandle);
      throw error;
    }
  }

  async #discardUpload(uploadHandle: string): Promise<void> {
    await evaluateByValue<unknown>(
      this.#client,
      createBridgeCallExpression("discardUpload", [uploadHandle]),
      false,
    );
  }

  async closeSession(input: CloseInput): Promise<CloseResult> {
    const parsed = closeInputSchema.parse(input);
    this.#sessions.acquire(parsed.sessionId);

    try {
      const raw = await this.#runOperation("startClose", [parsed]);
      const result = closeResultSchema.parse(raw);
      this.#sessions.delete(parsed.sessionId);
      return result;
    } catch (error) {
      if (this.#sessions.has(parsed.sessionId)) this.#sessions.release(parsed.sessionId);
      throw error;
    }
  }

  close(): void {
    try {
      this.#jobs.close();
    } finally {
      this.#client.close();
    }
  }

  async shutdown(): Promise<void> {
    const failures: string[] = [];
    for (const sessionId of this.#sessions.ids()) {
      try {
        await this.closeSession({ sessionId });
      } catch (error) {
        failures.push(error instanceof ConnectorError ? error.code : "CHAT_FAILED");
      }
    }
    try {
      this.#jobs.close();
    } finally {
      this.#client.close();
    }
    if (failures.length > 0) {
      throw new ConnectorError(
        "ARCHIVE_FAILED",
        "shutdown時に一部sessionをarchiveできませんでした。",
        { failureCount: failures.length },
      );
    }
  }

  async #bootstrap(): Promise<void> {
    const auth = await evaluateByValue<AuthProbe>(
      this.#client,
      String.raw`(async () => {
        const response = await fetch("/api/auth/session", { credentials: "include" });
        let authenticated = false;
        if (response.ok) {
          const data = await response.json();
          authenticated = Boolean(data?.user);
        }
        return {
          status: response.status,
          authenticated,
          officialOrigin: location.origin === "https://chatgpt.com"
        };
      })()`,
    );

    if (!auth.officialOrigin) {
      throw new ConnectorError("RUNTIME_DRIFT", "page targetがChatGPT公式originではありません。");
    }
    if (!auth.authenticated) {
      throw new ConnectorError("AUTH_REQUIRED", "専用ChromeでChatGPTへログインしてください。", {
        status: auth.status,
      });
    }

    const existingBridge = await evaluateByValue<unknown>(
      this.#client,
      `(() => {
        const bridge = globalThis.__gptConnectorBridgeV1;
        return bridge?.version === 1 &&
          bridge?.buildId === ${JSON.stringify(bridgeBuildId)} &&
          typeof bridge.summary === "function"
          ? bridge.summary()
          : null;
      })()`,
    );
    const existingBridgeResult = z
      .object({
        version: z.literal(1),
        buildId: z.literal(bridgeBuildId),
        ready: z.literal(true),
      })
      .safeParse(existingBridge);
    if (existingBridgeResult.success) return;

    const urls = await listLoadedAssetUrls(this.#client);
    const assets = await discoverRuntimeAssets(urls);
    const summary = await evaluateByValue<unknown>(
      this.#client,
      createBridgeBootstrapExpression(
        assets.coreUrl,
        assets.conversationUrl,
        assets.uploadUrl,
      ),
    );
    const parsed = z
      .object({
        version: z.literal(1),
        buildId: z.literal(bridgeBuildId),
        ready: z.literal(true),
      })
      .safeParse(summary);
    if (!parsed.success) {
      throw new ConnectorError("RUNTIME_DRIFT", "page bridgeを初期化できませんでした。", {
        coreFingerprint: assets.coreFingerprint,
        conversationFingerprint: assets.conversationFingerprint,
        uploadFingerprint: assets.uploadFingerprint,
      });
    }
  }

  async #runOperation(
    method: "startModels" | "startUpload" | "startChat" | "startClose",
    args: readonly unknown[],
  ): Promise<unknown> {
    const started = operationStartSchema.parse(
      await evaluateByValue<unknown>(
        this.#client,
        createBridgeCallExpression(method, args),
        false,
      ),
    );

    const deadline = Date.now() + this.#operationTimeoutMs;
    while (Date.now() < deadline) {
      const envelope = operationEnvelopeSchema.parse(
        await evaluateByValue<unknown>(
          this.#client,
          createBridgeCallExpression("poll", [started.operationId, false]),
          false,
        ),
      );

      if (envelope.state === "succeeded") {
        await this.#consumeOperation(started.operationId);
        return envelope.result;
      }
      if (envelope.state === "failed") {
        await this.#consumeOperation(started.operationId);
        const error = envelope.error;
        throw new ConnectorError(
          toConnectorErrorCode(error?.code),
          error?.message ?? "ChatGPT runtime operationが失敗しました。",
        );
      }

      await delay(this.#pollIntervalMs);
    }

    throw new ConnectorError(
      method === "startUpload" ? "UPLOAD_TIMEOUT" : "CHAT_FAILED",
      "ChatGPT runtime operationがtimeoutしました。",
      { method },
    );
  }

  async #consumeOperation(operationId: string): Promise<void> {
    await evaluateByValue(
      this.#client,
      createBridgeCallExpression("poll", [operationId, true]),
      false,
    );
  }
}

function toConnectorErrorCode(value: string | undefined): ConnectorErrorCode {
  return connectorErrorCodes.includes(value as ConnectorErrorCode)
    ? (value as ConnectorErrorCode)
    : "CHAT_FAILED";
}

function diagnosticReason(code: ConnectorErrorCode | null): ConnectorDiagnostics["reasonCode"] {
  if (code === "AUTH_REQUIRED") return "auth_required";
  if (code === "CDP_UNAVAILABLE") return "cdp_unavailable";
  if (code === "RUNTIME_DRIFT") return "runtime_drift";
  if (code === "JOB_RECOVERY_UNAVAILABLE") return "state_unavailable";
  return "connector_error";
}

function consultFingerprint(input: {
  readonly prompt: string;
  readonly files: readonly {
    readonly relativePath: string;
    readonly bytes: number;
    readonly sha256: string;
  }[];
  readonly model: string | null;
  readonly effort: string | null;
  readonly keepOpen: boolean;
}): string {
  return createHash("sha256")
    .update(JSON.stringify({
      promptSha256: createHash("sha256").update(input.prompt).digest("hex"),
      files: input.files.map((file) => ({
        relativePath: file.relativePath,
        bytes: file.bytes,
        sha256: file.sha256,
      })),
      model: input.model,
      effort: input.effort,
      keepOpen: input.keepOpen,
    }))
    .digest("hex");
}

function retryFor(code: ConnectorErrorCode): ConsultSnapshot["error"] extends infer T
  ? T extends { retry: infer R } ? R : never
  : never {
  if (code === "AUTH_REQUIRED") return "after_auth";
  if (code === "RUNTIME_DRIFT") return "after_runtime_update";
  if (
    code === "INVALID_INPUT" ||
    code === "FILE_NOT_FOUND" ||
    code === "FILE_OUTSIDE_ROOT" ||
    code === "SENSITIVE_FILE_BLOCKED" ||
    code === "FILE_TYPE_NOT_SUPPORTED" ||
    code === "FILE_EMPTY" ||
    code === "FILE_LIMIT_EXCEEDED" ||
    code === "MODEL_NOT_AVAILABLE" ||
    code === "EFFORT_NOT_SUPPORTED"
  ) return "after_input_change";
  if (
    code === "UPLOAD_TIMEOUT" ||
    code === "UPLOAD_FAILED" ||
    code === "CHAT_FAILED" ||
    code === "STREAM_INCOMPLETE" ||
    code === "ATTACHMENT_READBACK_FAILED" ||
    code === "JOB_RECOVERY_UNAVAILABLE"
  ) return "status_first";
  return "never";
}
