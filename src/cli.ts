#!/usr/bin/env node

import { GptConnector } from "./connector.js";
import { ConsultJobStore } from "./consult-job-store.js";
import { ConnectorError } from "./errors.js";
import { packageVersion } from "./version.js";

interface ParsedArgs {
  readonly command: string | undefined;
  readonly values: ReadonlyMap<string, readonly string[] | true>;
}

function parseArgs(args: readonly string[]): ParsedArgs {
  const [command, ...rest] = args;
  const values = new Map<string, string[] | true>();
  for (let index = 0; index < rest.length; index += 1) {
    const current = rest[index]!;
    if (!current.startsWith("--")) throw new Error(`不明な引数: ${current}`);
    const key = current.slice(2);
    const next = rest[index + 1];
    const existing = values.get(key);
    if (next === undefined || next.startsWith("--")) {
      if (existing !== undefined) throw new Error(`重複したflag: --${key}`);
      values.set(key, true);
    } else {
      if (existing === true) throw new Error(`値とflagを混在できません: --${key}`);
      values.set(key, [...(existing ?? []), next]);
      index += 1;
    }
  }
  return { command, values };
}

function stringArg(
  values: ReadonlyMap<string, readonly string[] | true>,
  name: string,
): string | undefined {
  const value = values.get(name);
  if (value === undefined) return undefined;
  if (value === true || value.length !== 1) throw new Error(`--${name}は1つの値が必要です。`);
  return value[0];
}

function stringArgs(
  values: ReadonlyMap<string, readonly string[] | true>,
  name: string,
): string[] | undefined {
  const value = values.get(name);
  if (value === undefined) return undefined;
  if (value === true) throw new Error(`--${name}には値が必要です。`);
  return [...value];
}

function flagArg(
  values: ReadonlyMap<string, readonly string[] | true>,
  name: string,
): boolean {
  const value = values.get(name);
  if (value === undefined) return false;
  if (value !== true) throw new Error(`--${name}は値なしflagです。`);
  return true;
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(): Promise<void> {
  const { command, values } = parseArgs(process.argv.slice(2));
  if (command === "--version" || command === "version") {
    process.stdout.write(`${packageVersion}\n`);
    return;
  }

  const endpoint = stringArg(values, "endpoint") ?? "http://127.0.0.1:9223";
  const stateDirectory = stringArg(values, "state-directory") ??
    process.env.GPT_CONNECTOR_STATE_DIR;
  if (command === "sessions") {
    const slug = stringArg(values, "slug");
    if (slug === undefined) throw new Error("sessionsには--slugが必要です。");
    const store = new ConsultJobStore({ stateDirectory, readOnly: true });
    await store.initialize();
    try {
      writeJson(store.get(slug));
    } finally {
      store.close();
    }
    return;
  }
  if (command === "doctor" || command === "diagnostics") {
    const diagnostics = await GptConnector.doctor({ endpoint, stateDirectory });
    writeJson(diagnostics);
    if (diagnostics.overall !== "ready") process.exitCode = 1;
    return;
  }
  const connector = await GptConnector.connect({ endpoint, stateDirectory });

  try {
    if (command === "models") {
      writeJson(await connector.models());
      return;
    }

    if (command === "chat") {
      const prompt = stringArg(values, "prompt");
      if (prompt === undefined) throw new Error("chatには--promptが必要です。");
      const result = await connector.chat({
        prompt,
        model: stringArg(values, "model"),
        effort: stringArg(values, "effort"),
        keepOpen: false,
      });
      writeJson(result);
      return;
    }

    if (command === "consult") {
      const prompt = stringArg(values, "prompt");
      const slug = stringArg(values, "slug");
      if (prompt === undefined || slug === undefined) {
        throw new Error("consultには--promptと--slugが必要です。");
      }
      writeJson(await connector.consult({
        prompt,
        slug,
        files: stringArgs(values, "file"),
        workspaceRoot: stringArg(values, "workspace-root"),
        model: stringArg(values, "model"),
        effort: stringArg(values, "effort"),
        keepOpen: flagArg(values, "keep-open"),
        dryRun: flagArg(values, "dry-run"),
      }));
      return;
    }

    if (command === "close") {
      const sessionId = stringArg(values, "session-id");
      if (sessionId === undefined) throw new Error("closeには--session-idが必要です。");
      writeJson(await connector.closeSession({ sessionId }));
      return;
    }

    throw new Error(
      "usage: gpt-connector --version | models | doctor | chat --prompt <text> | consult --prompt <text> --slug <id> [--workspace-root <abs> --file <spec> ...] [--model <id> --effort <id>] [--dry-run] | sessions --slug <id> | close --session-id <uuid>",
    );
  } finally {
    connector.close();
  }
}

main().catch((error: unknown) => {
  if (error instanceof ConnectorError) {
    process.stderr.write(`${JSON.stringify({ code: error.code, message: error.message })}\n`);
  } else {
    process.stderr.write(`${JSON.stringify({ code: "INVALID_INPUT", message: String(error) })}\n`);
  }
  process.exitCode = 1;
});
