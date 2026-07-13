import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { GptConnector } from "./connector.js";
import type { ChatInput, CloseInput } from "./contract.js";
import { ConnectorError } from "./errors.js";

interface ConnectorPort {
  models(): ReturnType<GptConnector["models"]>;
  chat(input: ChatInput): ReturnType<GptConnector["chat"]>;
  closeSession(input: CloseInput): ReturnType<GptConnector["closeSession"]>;
  close(): void;
  shutdown(): Promise<void>;
}

export class LazyConnectorHost {
  readonly #endpoint: string;
  #connectorPromise: Promise<ConnectorPort> | null = null;

  constructor(endpoint = "http://127.0.0.1:9223") {
    this.#endpoint = endpoint;
  }

  get(): Promise<ConnectorPort> {
    this.#connectorPromise ??= GptConnector.connect({ endpoint: this.#endpoint }).catch((error) => {
      this.#connectorPromise = null;
      throw error;
    });
    return this.#connectorPromise;
  }

  async shutdown(): Promise<void> {
    if (this.#connectorPromise === null) return;
    try {
      await (await this.#connectorPromise).shutdown();
    } catch (error) {
      if (error instanceof ConnectorError && error.code === "ARCHIVE_FAILED") throw error;
    } finally {
      this.#connectorPromise = null;
    }
  }
}

export const mcpToolNames = ["chatgpt_models", "chatgpt_chat", "chatgpt_close"] as const;

export function createGptConnectorMcpServer(host: LazyConnectorHost): McpServer {
  const server = new McpServer(
    { name: "gpt-connector", version: "0.1.0" },
    {
      instructions:
        "通常Chatを呼ぶ前に必要ならchatgpt_modelsでlive model/effortを確認する。継続時はchatgpt_chatが返すsessionIdを渡し、終了時はchatgpt_closeでarchiveする。",
    },
  );

  server.registerTool(
    "chatgpt_models",
    {
      title: "通常Chatモデル一覧",
      description: "ログイン中accountで利用可能な通常Chat modelとthinking effortを返す。",
      inputSchema: z.object({}).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async () => toolResult(async () => (await host.get()).models()),
  );

  server.registerTool(
    "chatgpt_chat",
    {
      title: "通常Chatへ送信",
      description:
        "ChatGPT公式Web runtimeの通常ChatへUIなしで送信する。keepOpen=falseなら応答後archiveする。",
      inputSchema: z
        .object({
          prompt: z.string().min(1),
          model: z.string().min(1).optional(),
          effort: z.string().min(1).optional(),
          sessionId: z.string().uuid().optional(),
          keepOpen: z.boolean().default(false),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (input) => toolResult(async () => (await host.get()).chat(input)),
  );

  server.registerTool(
    "chatgpt_close",
    {
      title: "通常Chat sessionを閉じる",
      description: "process内sessionをserver archiveし、opaque handleを破棄する。deleteは行わない。",
      inputSchema: z.object({ sessionId: z.string().uuid() }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (input) => toolResult(async () => (await host.get()).closeSession(input)),
  );

  return server;
}

async function toolResult(action: () => Promise<unknown>) {
  try {
    const result = await action();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      structuredContent:
        typeof result === "object" && result !== null ? { ...result } : { value: result },
    };
  } catch (error) {
    const body =
      error instanceof ConnectorError
        ? { code: error.code, message: error.message }
        : { code: "CHAT_FAILED", message: "connector operationが失敗しました。" };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(body) }],
      isError: true,
    };
  }
}
