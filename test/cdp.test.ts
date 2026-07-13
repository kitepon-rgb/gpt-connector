import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  CdpClient,
  discoverChatGptTarget,
  validateCdpEndpoint,
  type CdpSocket,
} from "../src/cdp.js";
import { ConnectorError } from "../src/errors.js";

class FakeSocket extends EventEmitter implements CdpSocket {
  readonly sent: string[] = [];

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.emit("close");
  }

  respond(index: number, result: unknown): void {
    const request = JSON.parse(this.sent[index]!) as { id: number };
    this.emit("message", Buffer.from(JSON.stringify({ id: request.id, result })));
  }
}

test("CDP endpointをloopbackへ限定する", () => {
  assert.equal(validateCdpEndpoint("http://127.0.0.1:9223").port, "9223");
  assert.throws(
    () => validateCdpEndpoint("http://example.com:9223"),
    (error) => error instanceof ConnectorError && error.code === "INVALID_INPUT",
  );
});

test("ChatGPT公式page targetを一意に選ぶ", async () => {
  const target = await discoverChatGptTarget(
    "http://127.0.0.1:9223",
    async () =>
      new Response(
        JSON.stringify([
          {
            id: "page-1",
            type: "page",
            url: "https://chatgpt.com/",
            webSocketDebuggerUrl: "ws://127.0.0.1:9223/devtools/page/page-1",
          },
          {
            id: "page-2",
            type: "page",
            url: "https://example.com/",
            webSocketDebuggerUrl: "ws://127.0.0.1:9223/devtools/page/page-2",
          },
        ]),
        { status: 200 },
      ),
  );

  assert.equal(target.id, "page-1");
});

test("CDP JSON-RPC responseをcallへ対応付ける", async () => {
  const socket = new FakeSocket();
  const client = new CdpClient(socket);
  const resultPromise = client.call<{ value: number }>("Runtime.evaluate", {
    expression: "1 + 1",
  });

  socket.respond(0, { value: 2 });
  assert.deepEqual(await resultPromise, { value: 2 });
  client.close();
});

test("CDP eventを購読解除できる", () => {
  const socket = new FakeSocket();
  const client = new CdpClient(socket);
  const methods: string[] = [];
  const unsubscribe = client.onEvent((event) => methods.push(event.method));

  socket.emit("message", Buffer.from(JSON.stringify({ method: "Network.loadingFinished" })));
  unsubscribe();
  socket.emit("message", Buffer.from(JSON.stringify({ method: "Network.responseReceived" })));

  assert.deepEqual(methods, ["Network.loadingFinished"]);
  client.close();
});

test("CDP timeoutを明示エラーにする", async () => {
  const socket = new FakeSocket();
  const client = new CdpClient(socket, 5);

  await assert.rejects(
    client.call("Runtime.evaluate"),
    (error) => error instanceof ConnectorError && error.code === "CDP_UNAVAILABLE",
  );
  client.close();
});
