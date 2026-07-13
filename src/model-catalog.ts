import { ConnectorError } from "./errors.js";
import type { ModelCatalog, ModelChoice } from "./contract.js";

export interface RawThinkingEffort {
  readonly thinking_effort?: unknown;
}

export interface RawModel {
  readonly slug?: unknown;
  readonly title?: unknown;
  readonly reasoning_type?: unknown;
  readonly thinking_efforts?: unknown;
  readonly configurable_thinking_effort?: unknown;
  readonly is_work_mode_model?: unknown;
  readonly max_tokens?: unknown;
}

export interface RawModelCatalog {
  readonly default_model_slug?: unknown;
  readonly models?: unknown;
}

function toEfforts(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const effort = (item as RawThinkingEffort).thinking_effort;
    return typeof effort === "string" && effort.length > 0 ? [effort] : [];
  });
}

function toModel(value: unknown): ModelChoice | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as RawModel;
  if (raw.is_work_mode_model === true || typeof raw.slug !== "string") return null;

  return {
    id: raw.slug,
    title: typeof raw.title === "string" ? raw.title : raw.slug,
    reasoningType: typeof raw.reasoning_type === "string" ? raw.reasoning_type : null,
    efforts: toEfforts(raw.thinking_efforts),
    configurableEffort: raw.configurable_thinking_effort === true,
    maxTokens:
      typeof raw.max_tokens === "number" && Number.isFinite(raw.max_tokens)
        ? raw.max_tokens
        : null,
  };
}

export function normalizeModelCatalog(raw: RawModelCatalog): ModelCatalog {
  const models = Array.isArray(raw.models)
    ? raw.models.flatMap((model) => {
        const normalized = toModel(model);
        return normalized === null ? [] : [normalized];
      })
    : [];

  const defaultModel =
    typeof raw.default_model_slug === "string" &&
    models.some((model) => model.id === raw.default_model_slug)
      ? raw.default_model_slug
      : null;

  return { defaultModel, models };
}

export interface ValidatedModelSelection {
  readonly requestedModel?: string;
  readonly requestedEffort?: string;
}

export function validateModelSelection(
  catalog: ModelCatalog,
  model: string | undefined,
  effort: string | undefined,
): ValidatedModelSelection {
  if (model === undefined) {
    if (effort !== undefined) {
      throw new ConnectorError(
        "EFFORT_NOT_SUPPORTED",
        "effortを指定する場合はmodelも指定してください。",
      );
    }
    return {};
  }

  const selected = catalog.models.find((candidate) => candidate.id === model);
  if (selected === undefined) {
    throw new ConnectorError(
      "MODEL_NOT_AVAILABLE",
      "指定modelは現在の通常Chat catalogで利用できません。",
      { model },
    );
  }

  if (effort !== undefined && !selected.efforts.includes(effort)) {
    throw new ConnectorError(
      "EFFORT_NOT_SUPPORTED",
      "指定effortは選択modelで利用できません。",
      { model, effort },
    );
  }

  return {
    requestedModel: model,
    ...(effort === undefined ? {} : { requestedEffort: effort }),
  };
}
