import { z } from "zod";

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
