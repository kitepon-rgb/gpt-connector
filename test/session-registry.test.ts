import assert from "node:assert/strict";
import test from "node:test";

import { ConnectorError } from "../src/errors.js";
import { SessionRegistry } from "../src/session-registry.js";

test("opaque sessionを作成・取得・破棄できる", () => {
  const registry = new SessionRegistry();
  const session = registry.create(100);

  assert.match(session.id, /^[0-9a-f-]{36}$/u);
  assert.equal(registry.get(session.id), session);
  assert.equal(registry.size, 1);

  registry.delete(session.id);
  assert.equal(registry.size, 0);
});

test("同一sessionの並行turnを拒否する", () => {
  const registry = new SessionRegistry();
  const session = registry.create(100);
  registry.acquire(session.id, 200);

  assert.throws(
    () => registry.acquire(session.id, 300),
    (error) => error instanceof ConnectorError && error.code === "SESSION_BUSY",
  );

  registry.release(session.id, 400);
  assert.equal(registry.acquire(session.id, 500).busy, true);
});

test("未知sessionを明示エラーにする", () => {
  const registry = new SessionRegistry();
  assert.throws(
    () => registry.get("00000000-0000-0000-0000-000000000000"),
    (error) =>
      error instanceof ConnectorError && error.code === "SESSION_NOT_FOUND",
  );
});

test("page側で生成したopaque session IDを登録できる", () => {
  const registry = new SessionRegistry();
  const id = "11111111-1111-4111-8111-111111111111";
  assert.equal(registry.register(id, 100).id, id);
  assert.equal(registry.has(id), true);
});

test("shutdown対象session IDを列挙できる", () => {
  const registry = new SessionRegistry();
  const first = registry.create();
  const second = registry.create();
  assert.deepEqual(new Set(registry.ids()), new Set([first.id, second.id]));
});
