import { createHash } from "node:crypto";

export const bridgeGlobalName = "__gptConnectorBridgeV1";

const bridgeBootstrapSource = String.raw`async function(coreUrl, conversationUrl, expectedBuildId) {
  const globalName = "__gptConnectorBridgeV1";
  if (globalThis[globalName]?.version === 1 && globalThis[globalName]?.buildId === expectedBuildId) {
    return globalThis[globalName].summary();
  }

  const [core, conversationModule] = await Promise.all([
    import(coreUrl),
    import(conversationUrl)
  ]);

  const entries = (module) => Object.entries(module);
  const functionSource = (value) => Function.prototype.toString.call(value);
  const unique = (role, candidates) => {
    if (candidates.length !== 1) {
      throw new Error("RUNTIME_DRIFT:" + role + ":" + candidates.length);
    }
    return candidates[0][1];
  };

  const sender = unique("sender", entries(core).filter(([, value]) => {
    if (typeof value !== "function") return false;
    const source = functionSource(value);
    return source.includes("completion.submit.request.tpp_model_resolution") &&
      source.includes("sendRequest({conduitToken") &&
      source.includes("requestedModelId");
  }));

  const builder = unique("builder", entries(conversationModule).filter(([, value]) => {
    if (typeof value !== "function") return false;
    const source = functionSource(value);
    return source.includes("contentToSend") &&
      source.includes("allSystemHints") &&
      source.includes("selectedSkillIds") &&
      source.includes("build_request_params.prompt_message");
  }));

  const threadStore = unique("threadStore", entries(core).filter(([, value]) =>
    value && typeof value === "object" &&
    typeof value.initThread === "function" &&
    typeof value.setServerIdForNewThread === "function" &&
    typeof value.deleteThread === "function" &&
    typeof value.retainThread === "function"
  ));

  const treeApi = unique("treeApi", entries(core).filter(([, value]) =>
    value && typeof value === "object" &&
    typeof value.getLastAssistantMessage === "function" &&
    typeof value.getCurrentMessage === "function" &&
    typeof value.getConversationTurns === "function"
  ));

  const apiClientCandidates = entries(core).filter(([, value]) =>
    value && typeof value === "object" &&
    typeof value.safeGet === "function" &&
    typeof value.safePost === "function" &&
    typeof value.safePatch === "function" &&
    typeof value.safeDelete === "function"
  );
  const apiClientProbeResults = await Promise.all(apiClientCandidates.map(async ([, value]) => {
    try {
      const catalog = await value.safeGet("/models", {
        parameters: { query: { supports_model_picker_upgrade_presets: true } }
      });
      return Array.isArray(catalog?.models) && typeof catalog?.default_model_slug === "string";
    } catch {
      return false;
    }
  }));
  const apiClient = unique("apiClient", apiClientCandidates.filter((_, index) => apiClientProbeResults[index]));

  const threadGetter = unique("threadGetter", entries(core).filter(([, value]) => {
    if (typeof value !== "function" || value.length !== 1) return false;
    const source = functionSource(value);
    return /return [\w$]+\.threads\[[\w$]+\]\}$/.test(source);
  }));

  const factoryCandidates = entries(core).filter(([, value]) => {
    if (typeof value !== "function") return false;
    const source = functionSource(value);
    return /^function [^(]+\([A-Za-z_$][\w$]*\)\{return [\w$]+\([\w$]+\(\),[\w$]+\(\),[A-Za-z_$][\w$]*\)\}$/.test(source);
  });
  const conversationFactory = unique("conversationFactory", factoryCandidates);

  const sessions = new Map();
  const operations = new Map();
  const terminal = new Set(["succeeded", "failed"]);

  const safeError = (error, fallbackCode) => ({
    code: typeof error?.message === "string" && error.message.startsWith("RUNTIME_DRIFT:")
      ? "RUNTIME_DRIFT"
      : fallbackCode,
    message: String(error?.message ?? error ?? "unknown error")
      .slice(0, 240)
      .replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]")
  });

  const serverIdOf = (conversation) => {
    const signal = conversation?.serverId$;
    if (typeof signal === "function") return signal();
    if (signal && typeof signal.get === "function") return signal.get();
    return null;
  };

  const getCatalog = async () => {
    const raw = await apiClient.safeGet("/models", {
      parameters: { query: { supports_model_picker_upgrade_presets: true } }
    });
    const models = (raw.models ?? [])
      .filter((model) => model?.is_work_mode_model !== true && typeof model?.slug === "string")
      .map((model) => ({
        id: model.slug,
        title: typeof model.title === "string" ? model.title : model.slug,
        reasoningType: typeof model.reasoning_type === "string" ? model.reasoning_type : null,
        efforts: Array.isArray(model.thinking_efforts)
          ? model.thinking_efforts.map((item) => item?.thinking_effort).filter((item) => typeof item === "string")
          : [],
        configurableEffort: model.configurable_thinking_effort === true,
        maxTokens: typeof model.max_tokens === "number" ? model.max_tokens : null
      }));
    return {
      defaultModel: models.some((model) => model.id === raw.default_model_slug)
        ? raw.default_model_slug
        : null,
      models
    };
  };

  const validateSelection = async (modelId, effort) => {
    const catalog = await getCatalog();
    if (modelId == null) {
      if (effort != null) throw new Error("EFFORT_NOT_SUPPORTED:model_required");
      return;
    }
    const model = catalog.models.find((candidate) => candidate.id === modelId);
    if (!model) throw new Error("MODEL_NOT_AVAILABLE");
    if (effort != null && !model.efforts.includes(effort)) {
      throw new Error("EFFORT_NOT_SUPPORTED");
    }
  };

  const extractResult = (conversation) => {
    const thread = threadGetter(conversation.id);
    const message = treeApi.getLastAssistantMessage(thread);
    const text = Array.isArray(message?.content?.parts)
      ? message.content.parts.filter((part) => typeof part === "string").join("")
      : "";
    if (!message || message.status !== "finished_successfully" || message.end_turn !== true || text.length === 0) {
      throw new Error("STREAM_INCOMPLETE");
    }
    const metadata = message.metadata ?? {};
    return {
      text,
      status: message.status,
      endTurn: true,
      resolvedModel: typeof metadata.resolved_model_slug === "string"
        ? metadata.resolved_model_slug
        : typeof metadata.model_slug === "string" ? metadata.model_slug : null,
      resolvedEffort: typeof metadata.thinking_effort === "string"
        ? metadata.thinking_effort
        : null
    };
  };

  const archive = async (conversation) => {
    const serverId = serverIdOf(conversation);
    if (!serverId) throw new Error("ARCHIVE_FAILED:no_server_id");
    await apiClient.safePatch("/conversation/{conversation_id}", {
      parameters: { path: { conversation_id: serverId } },
      requestBody: { is_archived: true }
    });
    const data = await apiClient.safeGet("/conversation/{conversation_id}", {
      parameters: { path: { conversation_id: serverId } }
    });
    if (data?.is_archived !== true) throw new Error("ARCHIVE_FAILED:not_confirmed");
  };

  const startOperation = (kind) => {
    const id = crypto.randomUUID();
    operations.set(id, { kind, state: "pending", result: null, error: null });
    return id;
  };

  const finishFailure = (operation, error, fallbackCode) => {
    operation.state = "failed";
    operation.error = safeError(error, fallbackCode);
  };

  const bridge = {
    version: 1,
    buildId: expectedBuildId,
    summary: () => ({ version: 1, buildId: expectedBuildId, ready: true }),
    diagnostics: () => ({
      sessionCount: sessions.size,
      operationCount: operations.size
    }),
    startModels: () => {
      const operationId = startOperation("models");
      const operation = operations.get(operationId);
      void getCatalog().then((catalog) => {
        operation.state = "succeeded";
        operation.result = catalog;
      }, (error) => finishFailure(operation, error, "CHAT_FAILED"));
      return { operationId };
    },
    startChat: (input) => {
      const operationId = startOperation("chat");
      const operation = operations.get(operationId);
      const sessionId = input.sessionId ?? crypto.randomUUID();
      let session = sessions.get(sessionId);
      const createdSession = input.sessionId == null;
      if (input.sessionId != null && !session) {
        finishFailure(operation, new Error("SESSION_NOT_FOUND"), "SESSION_NOT_FOUND");
        return { operationId };
      }
      if (session?.busy) {
        finishFailure(operation, new Error("SESSION_BUSY"), "SESSION_BUSY");
        return { operationId };
      }
      if (session) session.busy = true;

      void (async () => {
        try {
          await validateSelection(input.model, input.effort);
          if (!session) {
            const conversation = conversationFactory();
            if (!conversation || typeof conversation.id !== "string" || !conversation.id.startsWith("WEB:")) {
              throw new Error("RUNTIME_DRIFT:factory_output");
            }
            threadStore.initThread({
              clientThreadId: conversation.id,
              conversationMode: { kind: "primary_assistant" },
              conversationOrigin: null
            });
            session = { conversation, busy: true };
            sessions.set(sessionId, session);
          }
          const prompt = String(input.prompt);
          const params = await builder({
            conversation: session.conversation,
            attachments: [],
            content: prompt,
            contentToSend: { content: prompt, metadata: null },
            conversationMode: { kind: "primary_assistant" },
            hasSelectedApps: false,
            desktopOrigin: null,
            shouldCollectSidebarContext: false,
            selectedApps: [],
            selectedSources: undefined,
            selectedMCPConnectors: undefined,
            selectedConnectorIds: undefined,
            searchConnectorIds: undefined,
            startedWithByoMcp: false,
            sourceEvent: undefined,
            allSystemHints: [],
            systemHints: [],
            firstInputTimestampMs: performance.now(),
            isN7jupdActive: false,
            isForceAllowCustomMcpModeEnabled: false,
            selectedSkillIds: [],
            thinkingEffort: input.effort,
            serviceTier: undefined
          });
          await sender({
            ...params,
            conversation: session.conversation,
            requestedModelId: input.model,
            thinkingEffort: input.effort,
            serviceTier: undefined,
            callsiteId: "request_completion.gpt_connector.1",
            eventSource: "url"
          });
          const result = extractResult(session.conversation);
          if (input.keepOpen === true) {
            operation.result = { ...result, sessionId };
          } else {
            await archive(session.conversation);
            sessions.delete(sessionId);
            operation.result = result;
          }
          operation.state = "succeeded";
        } catch (error) {
          let cleanupError = null;
          if (session && (createdSession || input.keepOpen !== true)) {
            if (serverIdOf(session.conversation)) {
              try {
                await archive(session.conversation);
              } catch (archiveError) {
                cleanupError = archiveError;
              }
            }
            sessions.delete(sessionId);
          }
          if (cleanupError) {
            finishFailure(operation, cleanupError, "ARCHIVE_FAILED");
            return;
          }
          const message = String(error?.message ?? error);
          const code = message.startsWith("MODEL_NOT_AVAILABLE") ? "MODEL_NOT_AVAILABLE"
            : message.startsWith("EFFORT_NOT_SUPPORTED") ? "EFFORT_NOT_SUPPORTED"
            : message.startsWith("STREAM_INCOMPLETE") ? "STREAM_INCOMPLETE"
            : message.startsWith("ARCHIVE_FAILED") ? "ARCHIVE_FAILED"
            : message.startsWith("RUNTIME_DRIFT") ? "RUNTIME_DRIFT"
            : "CHAT_FAILED";
          finishFailure(operation, error, code);
        } finally {
          const current = sessions.get(sessionId);
          if (current) current.busy = false;
        }
      })();
      return { operationId };
    },
    startClose: (input) => {
      const operationId = startOperation("close");
      const operation = operations.get(operationId);
      const session = sessions.get(input.sessionId);
      if (!session) {
        finishFailure(operation, new Error("SESSION_NOT_FOUND"), "SESSION_NOT_FOUND");
        return { operationId };
      }
      if (session.busy) {
        finishFailure(operation, new Error("SESSION_BUSY"), "SESSION_BUSY");
        return { operationId };
      }
      session.busy = true;
      void archive(session.conversation).then(() => {
        sessions.delete(input.sessionId);
        operation.state = "succeeded";
        operation.result = { archived: true };
      }, (error) => {
        session.busy = false;
        finishFailure(operation, error, "ARCHIVE_FAILED");
      });
      return { operationId };
    },
    poll: (operationId, consume) => {
      const operation = operations.get(operationId);
      if (!operation) return { state: "failed", error: { code: "CHAT_FAILED", message: "operation_not_found" } };
      const result = {
        state: operation.state,
        result: operation.result,
        error: operation.error
      };
      if (consume === true && terminal.has(operation.state)) operations.delete(operationId);
      return result;
    }
  };

  globalThis[globalName] = bridge;
  return bridge.summary();
}`;

export const bridgeBuildId = createHash("sha256")
  .update(bridgeBootstrapSource)
  .digest("hex")
  .slice(0, 16);

export function createBridgeBootstrapExpression(
  coreUrl: string,
  conversationUrl: string,
): string {
  return `(${bridgeBootstrapSource})(${JSON.stringify(coreUrl)}, ${JSON.stringify(conversationUrl)}, ${JSON.stringify(bridgeBuildId)})`;
}

export function createBridgeCallExpression(
  method: "startModels" | "startChat" | "startClose" | "poll",
  args: readonly unknown[],
): string {
  return `globalThis[${JSON.stringify(bridgeGlobalName)}].${method}(...${JSON.stringify(args)})`;
}
