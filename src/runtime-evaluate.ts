import { ConnectorError } from "./errors.js";
import type { CdpClient } from "./cdp.js";

interface RuntimeRemoteObject {
  readonly value?: unknown;
  readonly description?: string;
}

interface RuntimeEvaluateResponse {
  readonly result?: RuntimeRemoteObject;
  readonly exceptionDetails?: unknown;
}

export async function evaluateByValue<T>(
  client: CdpClient,
  expression: string,
  awaitPromise = true,
): Promise<T> {
  const response = await client.call<RuntimeEvaluateResponse>("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: false,
  });

  if (response.exceptionDetails !== undefined || response.result === undefined) {
    throw new ConnectorError(
      "RUNTIME_DRIFT",
      "ChatGPT page main worldで式を評価できませんでした。",
    );
  }

  return response.result.value as T;
}
