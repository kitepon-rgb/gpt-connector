import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { GptConnector } from "./connector.js";
import {
  consultInputSchema,
  sessionsInputSchema,
  type ChatInput,
  type CloseInput,
  type ConsultInput,
  type SessionsInput,
} from "./contract.js";
import { ConsultJobStore } from "./consult-job-store.js";
import { ConnectorError } from "./errors.js";
import { packageVersion } from "./version.js";

interface ConnectorPort {
  models(): ReturnType<GptConnector["models"]>;
  diagnostics(): ReturnType<GptConnector["diagnostics"]>;
  chat(input: ChatInput): ReturnType<GptConnector["chat"]>;
  consult(input: ConsultInput): ReturnType<GptConnector["consult"]>;
  sessions(input: SessionsInput): ReturnType<GptConnector["sessions"]>;
  closeSession(input: CloseInput): ReturnType<GptConnector["closeSession"]>;
  close(): void;
  shutdown(): Promise<void>;
}

export class LazyConnectorHost {
  readonly #endpoint: string;
  readonly #stateDirectory: string | undefined;
  #connectorPromise: Promise<ConnectorPort> | null = null;

  constructor(endpoint = "http://127.0.0.1:9223", stateDirectory?: string) {
    this.#endpoint = endpoint;
    this.#stateDirectory = stateDirectory;
  }

  get(): Promise<ConnectorPort> {
    this.#connectorPromise ??= GptConnector.connect({
      endpoint: this.#endpoint,
      stateDirectory: this.#stateDirectory,
    }).catch((error) => {
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

  async sessions(input: SessionsInput): Promise<ReturnType<GptConnector["sessions"]>> {
    if (this.#connectorPromise !== null) {
      return (await this.#connectorPromise).sessions(input);
    }
    const store = new ConsultJobStore({
      stateDirectory: this.#stateDirectory,
      readOnly: true,
    });
    await store.initialize();
    try {
      return store.get(sessionsInputSchema.parse(input).slug);
    } finally {
      store.close();
    }
  }
}

export const mcpToolNames = [
  "chatgpt_models",
  "chatgpt_chat",
  "chatgpt_close",
  "consult",
  "sessions",
  "diagnostics",
] as const;

export const mcpServerVersion = packageVersion;

export function createGptConnectorMcpServer(host: LazyConnectorHost): McpServer {
  const server = new McpServer(
    { name: "gpt-connector", version: mcpServerVersion },
    {
      instructions:
        "second opinionはconsultへcaller既知slugと必要ならworkspaceRoot/filesを渡す。caller timeout後は再送せずsessionsで同じslugを確認する。live model/effortはchatgpt_models、既存互換chatはchatgpt_chat、終了はchatgpt_closeを使う。",
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
    "consult",
    {
      title: "通常Chatへ相談",
      description:
        "ChatGPT公式Web runtimeへ相談する。filesはworkspaceRoot相対で正規添付し、slugで冪等化する。",
      inputSchema: consultInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (input) => toolResult(async () => (await host.get()).consult(input)),
  );

  server.registerTool(
    "sessions",
    {
      title: "相談状態を回収",
      description: "既知slug 1件の状態・terminal result・errorを返し、再送は行わない。",
      inputSchema: sessionsInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (input) => toolResult(async () => host.sessions(input)),
  );

  server.registerTool(
    "diagnostics",
    {
      title: "connector診断",
      description: "会話やuploadを作らず、接続・bridge・job/session件数だけを返す。",
      inputSchema: z.object({}).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async () => toolResult(async () => (await host.get()).diagnostics()),
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
