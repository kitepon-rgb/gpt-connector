import { randomUUID } from "node:crypto";

import { ConnectorError } from "./errors.js";

export interface SessionRecord {
  readonly id: string;
  readonly createdAt: number;
  lastUsedAt: number;
  busy: boolean;
}

export class SessionRegistry {
  readonly #sessions = new Map<string, SessionRecord>();

  create(now = Date.now()): SessionRecord {
    return this.register(randomUUID(), now);
  }

  register(id: string, now = Date.now()): SessionRecord {
    if (this.#sessions.has(id)) {
      throw new ConnectorError("SESSION_BUSY", "sessionはすでに登録されています。");
    }
    const record: SessionRecord = {
      id,
      createdAt: now,
      lastUsedAt: now,
      busy: false,
    };
    this.#sessions.set(record.id, record);
    return record;
  }

  get(id: string): SessionRecord {
    const record = this.#sessions.get(id);
    if (record === undefined) {
      throw new ConnectorError("SESSION_NOT_FOUND", "sessionが見つかりません。");
    }
    return record;
  }

  acquire(id: string, now = Date.now()): SessionRecord {
    const record = this.get(id);
    if (record.busy) {
      throw new ConnectorError("SESSION_BUSY", "sessionは別turnを処理中です。");
    }
    record.busy = true;
    record.lastUsedAt = now;
    return record;
  }

  release(id: string, now = Date.now()): void {
    const record = this.get(id);
    record.busy = false;
    record.lastUsedAt = now;
  }

  delete(id: string): void {
    if (!this.#sessions.delete(id)) {
      throw new ConnectorError("SESSION_NOT_FOUND", "sessionが見つかりません。");
    }
  }

  has(id: string): boolean {
    return this.#sessions.has(id);
  }

  get size(): number {
    return this.#sessions.size;
  }

  ids(): readonly string[] {
    return [...this.#sessions.keys()];
  }
}
