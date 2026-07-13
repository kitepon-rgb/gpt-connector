import { z } from "zod";

import { isAbsolute } from "node:path";

import type { ConnectorErrorCode } from "./errors.js";

export const consultSlugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{2,63}$/u);

export const consultInputSchema = z
  .object({
    prompt: z.string().min(1),
    files: z.array(z.string()).min(1).max(20).optional(),
    workspaceRoot: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    effort: z.string().min(1).optional(),
    slug: consultSlugSchema,
    keepOpen: z.boolean().default(false),
    dryRun: z.boolean().default(false),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.files !== undefined && input.workspaceRoot === undefined) {
      context.addIssue({
        code: "custom",
        message: "files指定時はworkspaceRootが必要です。",
        path: ["workspaceRoot"],
      });
    }
    if (input.workspaceRoot !== undefined && !isAbsolute(input.workspaceRoot)) {
      context.addIssue({
        code: "custom",
        message: "workspaceRootはabsolute pathで指定してください。",
        path: ["workspaceRoot"],
      });
    }
    if (input.effort !== undefined && input.model === undefined) {
      context.addIssue({
        code: "custom",
        message: "effort指定時はmodelが必要です。",
        path: ["model"],
      });
    }
  });

export type ConsultInput = z.input<typeof consultInputSchema>;

export const sessionsInputSchema = z
  .object({ slug: consultSlugSchema })
  .strict();

export type SessionsInput = z.input<typeof sessionsInputSchema>;

export interface ConsultDryRunFile {
  readonly relativePath: string;
  readonly name: string;
  readonly bytes: number;
  readonly mimeType: string;
  readonly sha256: string;
}

export interface ConsultDryRunResult {
  readonly dryRun: true;
  readonly slug: string;
  readonly files: readonly ConsultDryRunFile[];
  readonly totalBytes: number;
  readonly requestedModel: string | null;
  readonly requestedEffort: string | null;
  readonly limits: {
    readonly maxFiles: 20;
    readonly maxFileBytes: number;
    readonly maxTotalBytes: number;
  };
  readonly uploadWouldRun: false;
  readonly conversationWouldRun: false;
}

export const chatInputSchema = z
  .object({
    prompt: z.string().min(1),
    model: z.string().min(1).optional(),
    effort: z.string().min(1).optional(),
    sessionId: z.string().uuid().optional(),
    keepOpen: z.boolean().default(false),
  })
  .strict();

export type ChatInput = z.input<typeof chatInputSchema>;

export const closeInputSchema = z
  .object({
    sessionId: z.string().uuid(),
  })
  .strict();

export type CloseInput = z.input<typeof closeInputSchema>;

export interface ModelChoice {
  readonly id: string;
  readonly title: string;
  readonly reasoningType: string | null;
  readonly efforts: readonly string[];
  readonly configurableEffort: boolean;
  readonly maxTokens: number | null;
}

export interface ModelCatalog {
  readonly defaultModel: string | null;
  readonly models: readonly ModelChoice[];
}

export interface ChatResult {
  readonly text: string;
  readonly status: string;
  readonly endTurn: true;
  readonly resolvedModel: string | null;
  readonly resolvedEffort: string | null;
  readonly sessionId?: string;
}

export interface CloseResult {
  readonly archived: true;
}

export interface ConnectorDiagnostics {
  readonly schema: "gpt-connector.diagnostics.v1";
  readonly packageVersion: string;
  readonly overall: "ready" | "not_ready";
  readonly reasonCode:
    | "ready"
    | "auth_required"
    | "cdp_unavailable"
    | "runtime_drift"
    | "state_unavailable"
    | "connector_error";
  readonly cdpConnected: boolean;
  readonly officialOrigin: boolean | null;
  readonly authenticated: boolean | null;
  readonly bridgeBuildId: string;
  readonly sessionCount: number | null;
  readonly operationCount: number | null;
  readonly uploadCount: number | null;
  readonly bufferedUploadBytes: number | null;
  readonly jobCount: number | null;
  readonly activeJobCount: number | null;
  readonly terminalJobCount: number | null;
}

export type ConsultJobState =
  | "queued"
  | "uploading"
  | "submitted"
  | "running"
  | "succeeded"
  | "failed";

export interface ConsultAttachmentSummary {
  readonly count: number;
  readonly names: readonly string[];
  readonly mimeTypes: readonly (string | null)[];
  readonly readBack: "confirmed";
  readonly retention: "unknown";
  readonly cleanup: "not_supported" | "failed" | "deleted";
}

export interface ConsultSuccessResult extends ChatResult {
  readonly attachments: ConsultAttachmentSummary;
  readonly archived: boolean;
}

export interface ConsultFailure {
  readonly code: ConnectorErrorCode;
  readonly message: string;
  readonly retry:
    | "never"
    | "after_input_change"
    | "after_auth"
    | "after_runtime_update"
    | "status_first";
  readonly partialUpload?: {
    readonly count: number;
    readonly cleanup: "not_supported" | "failed";
  };
}

export interface ConsultSnapshot {
  readonly slug: string;
  readonly state: ConsultJobState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly result: ConsultSuccessResult | null;
  readonly error: ConsultFailure | null;
}
