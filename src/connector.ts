import { setTimeout as delay } from "node:timers/promises";

import { z } from "zod";

import { discoverRuntimeAssets, listLoadedAssetUrls } from "./asset-discovery.js";
import { CdpClient, discoverChatGptTarget } from "./cdp.js";
import {
  chatInputSchema,
  closeInputSchema,
  type ChatInput,
  type ChatResult,
  type CloseInput,
  type CloseResult,
  type ModelCatalog,
} from "./contract.js";
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

const closeResultSchema = z.object({ archived: z.literal(true) });

export interface ConnectorOptions {
  readonly endpoint?: string;
  readonly operationTimeoutMs?: number;
  readonly pollIntervalMs?: number;
}

interface AuthProbe {
  readonly status: number;
  readonly authenticated: boolean;
  readonly officialOrigin: boolean;
}

export class GptConnector {
  readonly #client: CdpClient;
  readonly #sessions = new SessionRegistry();
  readonly #operationTimeoutMs: number;
  readonly #pollIntervalMs: number;

  private constructor(client: CdpClient, options: ConnectorOptions) {
    this.#client = client;
    this.#operationTimeoutMs = options.operationTimeoutMs ?? 180_000;
    this.#pollIntervalMs = options.pollIntervalMs ?? 250;
  }

  static async connect(options: ConnectorOptions = {}): Promise<GptConnector> {
    const endpoint = options.endpoint ?? "http://127.0.0.1:9223";
    const target = await discoverChatGptTarget(endpoint);
    const client = await CdpClient.connect(target.webSocketDebuggerUrl);
    const connector = new GptConnector(client, options);

    try {
      await client.call("Runtime.enable");
      await connector.#bootstrap();
      return connector;
    } catch (error) {
      client.close();
      throw error;
    }
  }

  async models(): Promise<ModelCatalog> {
    const result = await this.#runOperation("startModels", []);
    return modelCatalogSchema.parse(result);
  }

  async chat(input: ChatInput): Promise<ChatResult> {
    const parsed = chatInputSchema.parse(input);
    const catalog = await this.models();
    validateModelSelection(catalog, parsed.model, parsed.effort);

    const existingSession = parsed.sessionId;
    if (existingSession !== undefined) this.#sessions.acquire(existingSession);

    try {
      const raw = await this.#runOperation("startChat", [parsed]);
      const result = chatResultSchema.parse(raw);

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
    this.#client.close();
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
    this.#client.close();
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
      createBridgeBootstrapExpression(assets.coreUrl, assets.conversationUrl),
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
      });
    }
  }

  async #runOperation(
    method: "startModels" | "startChat" | "startClose",
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

    throw new ConnectorError("CHAT_FAILED", "ChatGPT runtime operationがtimeoutしました。", {
      method,
    });
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
