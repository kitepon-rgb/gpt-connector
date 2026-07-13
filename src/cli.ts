#!/usr/bin/env node

import { GptConnector } from "./connector.js";
import { ConnectorError } from "./errors.js";

interface ParsedArgs {
  readonly command: string | undefined;
  readonly values: ReadonlyMap<string, string | true>;
}

function parseArgs(args: readonly string[]): ParsedArgs {
  const [command, ...rest] = args;
  const values = new Map<string, string | true>();
  for (let index = 0; index < rest.length; index += 1) {
    const current = rest[index]!;
    if (!current.startsWith("--")) throw new Error(`不明な引数: ${current}`);
    const key = current.slice(2);
    const next = rest[index + 1];
    if (next === undefined || next.startsWith("--")) values.set(key, true);
    else {
      values.set(key, next);
      index += 1;
    }
  }
  return { command, values };
}

function stringArg(values: ReadonlyMap<string, string | true>, name: string): string | undefined {
  const value = values.get(name);
  return typeof value === "string" ? value : undefined;
}

async function main(): Promise<void> {
  const { command, values } = parseArgs(process.argv.slice(2));
  const endpoint = stringArg(values, "endpoint") ?? "http://127.0.0.1:9223";
  const connector = await GptConnector.connect({ endpoint });

  try {
    if (command === "models") {
      process.stdout.write(`${JSON.stringify(await connector.models(), null, 2)}\n`);
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
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    throw new Error("usage: gpt-connector models | chat --prompt <text> [--model <id>] [--effort <id>]");
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
