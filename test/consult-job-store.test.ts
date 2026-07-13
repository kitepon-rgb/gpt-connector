import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ConsultJobStore } from "../src/consult-job-store.js";
import { ConnectorError } from "../src/errors.js";

type JobState = "queued" | "uploading" | "submitted" | "running" | "succeeded" | "failed";

interface AttachmentSummary {
  readonly count: number;
  readonly names: readonly string[];
  readonly mimeTypes: readonly (string | null)[];
  readonly readBack: "confirmed";
  readonly retention: "unknown";
  readonly cleanup: "not_supported" | "failed" | "deleted";
}

interface ConsultSnapshot {
  readonly slug: string;
  readonly state: JobState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly result: null | {
    readonly text: string;
    readonly status: string;
    readonly endTurn: true;
    readonly resolvedModel: string | null;
    readonly resolvedEffort: string | null;
    readonly attachments: AttachmentSummary;
    readonly archived: boolean;
  };
  readonly error: null | {
    readonly code: string;
    readonly message: string;
    readonly retry: string;
  };
}

interface ConsultJobStoreContract {
  initialize(): Promise<void>;
  close(): void;
  reserve(slug: string, fingerprint: string): Promise<{
    readonly created: boolean;
    readonly snapshot: ConsultSnapshot;
  }>;
  transition(
    slug: string,
    state: JobState,
    update: {
      readonly result?: ConsultSnapshot["result"];
      readonly error?: ConsultSnapshot["error"];
    },
  ): Promise<ConsultSnapshot>;
  get(slug: string): ConsultSnapshot;
}

const slug = "durable-job-001";
const fingerprint = "5de33c50f002c4d54e191a00e1d4f6b8";

const succeededResult: NonNullable<ConsultSnapshot["result"]> = {
  text: "fixture response",
  status: "finished_successfully",
  endTurn: true,
  resolvedModel: "gpt-fixture",
  resolvedEffort: "extended",
  attachments: {
    count: 1,
    names: ["fixture.md"],
    mimeTypes: ["text/markdown"],
    readBack: "confirmed",
    retention: "unknown",
    cleanup: "not_supported",
  },
  archived: true,
};

async function withStateDirectory(
  run: (stateDirectory: string) => Promise<void>,
): Promise<void> {
  const stateDirectory = await mkdtemp(join(tmpdir(), "gpt-connector-consult-jobs-"));
  try {
    await run(stateDirectory);
  } finally {
    await rm(stateDirectory, { recursive: true, force: true });
  }
}

function createStore(stateDirectory: string, readOnly = false): ConsultJobStoreContract {
  return new ConsultJobStore({ stateDirectory, readOnly });
}

async function persistedJsonPath(stateDirectory: string, expectedText: string): Promise<string> {
  const entries = await readdir(stateDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const path = join(stateDirectory, entry.name);
    if ((await readFile(path, "utf8")).includes(expectedText)) return path;
  }
  throw new Error("persisted JSON was not found");
}

test("初回reserveはqueued、同fingerprintは再利用、異fingerprintはJOB_CONFLICTにする", async () => {
  await withStateDirectory(async (stateDirectory) => {
    const store = createStore(stateDirectory);
    await store.initialize();

    const initial = await store.reserve(slug, fingerprint);
    assert.equal(initial.created, true);
    assert.equal(initial.snapshot.slug, slug);
    assert.equal(initial.snapshot.state, "queued");
    assert.equal(initial.snapshot.result, null);
    assert.equal(initial.snapshot.error, null);

    const reused = await store.reserve(slug, fingerprint);
    assert.equal(reused.created, false);
    assert.deepEqual(reused.snapshot, initial.snapshot);
    await assert.rejects(
      store.reserve(slug, "different-fingerprint"),
      (error) => error instanceof ConnectorError && error.code === "JOB_CONFLICT",
    );
    assert.throws(
      () => store.get("missing-job-001"),
      (error) => error instanceof ConnectorError && error.code === "JOB_NOT_FOUND",
    );
    store.close();
  });
});

test("terminal resultをstate transitionと再initialize後にも保持する", async () => {
  await withStateDirectory(async (stateDirectory) => {
    const first = createStore(stateDirectory);
    await first.initialize();
    await first.reserve(slug, fingerprint);
    await first.transition(slug, "uploading", {});
    await first.transition(slug, "submitted", {});
    await first.transition(slug, "running", {});
    const terminal = await first.transition(slug, "succeeded", { result: succeededResult });
    assert.equal(terminal.state, "succeeded");
    assert.deepEqual(terminal.result, succeededResult);
    first.close();

    const second = createStore(stateDirectory);
    await second.initialize();
    assert.deepEqual(second.get(slug), terminal);
    second.close();
  });
});

test("再起動時の非terminal jobをJOB_RECOVERY_UNAVAILABLEでfailedへ固定し自動再送しない", async () => {
  await withStateDirectory(async (stateDirectory) => {
    const first = createStore(stateDirectory);
    await first.initialize();
    await first.reserve(slug, fingerprint);
    await first.transition(slug, "uploading", {});
    first.close();

    const second = createStore(stateDirectory);
    await second.initialize();
    const recovered = second.get(slug);
    assert.equal(recovered.state, "failed");
    assert.equal(recovered.error?.code, "JOB_RECOVERY_UNAVAILABLE");

    const reserved = await second.reserve(slug, fingerprint);
    assert.equal(reserved.created, false);
    assert.deepEqual(reserved.snapshot, recovered);
    second.close();
  });
});

test("不正transitionはRUNTIME_DRIFTで拒否する", async () => {
  await withStateDirectory(async (stateDirectory) => {
    const store = createStore(stateDirectory);
    await store.initialize();
    await store.reserve(slug, fingerprint);

    await assert.rejects(
      store.transition(slug, "succeeded", { result: succeededResult }),
      (error) => error instanceof ConnectorError && error.code === "RUNTIME_DRIFT",
    );
    store.close();
  });
});

test("破損JSONはfail-closedし、元ファイルを上書きしない", async () => {
  await withStateDirectory(async (stateDirectory) => {
    const first = createStore(stateDirectory);
    await first.initialize();
    await first.reserve(slug, fingerprint);
    const path = await persistedJsonPath(stateDirectory, fingerprint);
    first.close();
    const corrupt = "{ not valid JSON";
    await writeFile(path, corrupt);

    const second = createStore(stateDirectory);
    await assert.rejects(
      second.initialize(),
      (error) => error instanceof ConnectorError && error.code === "JOB_RECOVERY_UNAVAILABLE",
    );
    assert.equal(await readFile(path, "utf8"), corrupt);
  });
});

test("保存するのはfingerprintとsnapshotだけで、JSONはowner-only modeにする", async () => {
  await withStateDirectory(async (stateDirectory) => {
    const store = createStore(stateDirectory);
    await store.initialize();
    await store.reserve(slug, fingerprint);
    const path = await persistedJsonPath(stateDirectory, fingerprint);
    const persisted = await readFile(path, "utf8");

    assert.match(persisted, new RegExp(fingerprint, "u"));
    assert.doesNotMatch(persisted, /prompt body|\/absolute\/path|file body/u);
    if (process.platform !== "win32") {
      assert.equal((await stat(path)).mode & 0o777, 0o600);
    }
    store.close();
  });
});

test("writerのlock中でもreadOnly readerは非terminal snapshotをそのまま読み、台帳を書き換えない", async () => {
  await withStateDirectory(async (stateDirectory) => {
    const writer = createStore(stateDirectory);
    await writer.initialize();
    await writer.reserve(slug, fingerprint);
    await writer.transition(slug, "uploading", {});
    const before = await readFile(await persistedJsonPath(stateDirectory, fingerprint), "utf8");

    const reader = createStore(stateDirectory, true);
    await reader.initialize();
    assert.equal(reader.get(slug).state, "uploading");
    assert.equal(await readFile(await persistedJsonPath(stateDirectory, fingerprint), "utf8"), before);
    reader.close();
    writer.close();

    const recoveredWriter = createStore(stateDirectory);
    await recoveredWriter.initialize();
    const recovered = recoveredWriter.get(slug);
    assert.equal(recovered.state, "failed");
    assert.equal(recovered.error?.code, "JOB_RECOVERY_UNAVAILABLE");
    recoveredWriter.close();
  });
});

test("writer lock保持中でもsecond writerは既存snapshotを読めるが別slugの新規reserveはJOB_RECOVERY_UNAVAILABLEにする", async () => {
  await withStateDirectory(async (stateDirectory) => {
    const first = createStore(stateDirectory);
    await first.initialize();
    await first.reserve(slug, fingerprint);
    await first.transition(slug, "uploading", {});

    const second = createStore(stateDirectory);
    await second.initialize();
    assert.equal(second.get(slug).state, "uploading");
    const reused = await second.reserve(slug, fingerprint);
    assert.equal(reused.created, false);
    assert.equal(reused.snapshot.state, "uploading");
    await assert.rejects(
      second.reserve("another-job-001", "another-fingerprint"),
      (error) => error instanceof ConnectorError && error.code === "JOB_RECOVERY_UNAVAILABLE",
    );
    second.close();
    first.close();
  });
});

test("status readerはlive writerのterminal更新を台帳から再読込する", async () => {
  await withStateDirectory(async (stateDirectory) => {
    const writer = createStore(stateDirectory);
    await writer.initialize();
    await writer.reserve(slug, fingerprint);
    await writer.transition(slug, "uploading", {});

    const reader = createStore(stateDirectory, true);
    await reader.initialize();
    assert.equal(reader.get(slug).state, "uploading");
    const observer = createStore(stateDirectory);
    await observer.initialize();
    assert.equal(observer.get(slug).state, "uploading");

    await writer.transition(slug, "submitted", {});
    await writer.transition(slug, "running", {});
    await writer.transition(slug, "succeeded", { result: succeededResult });
    assert.equal(reader.get(slug).state, "succeeded");
    assert.deepEqual(reader.get(slug).result, succeededResult);
    const reused = await observer.reserve(slug, fingerprint);
    assert.equal(reused.created, false);
    assert.equal(reused.snapshot.state, "succeeded");

    observer.close();
    reader.close();
    writer.close();
  });
});

test("同一writerの複数active jobは最後のterminalまでleaseを保持する", async () => {
  await withStateDirectory(async (stateDirectory) => {
    const store = createStore(stateDirectory);
    await store.initialize();
    const secondSlug = "durable-job-002";
    const secondFingerprint = "second-fingerprint";
    await store.reserve(slug, fingerprint);
    await store.reserve(secondSlug, secondFingerprint);
    await store.transition(slug, "uploading", {});
    await store.transition(secondSlug, "uploading", {});
    await store.transition(slug, "submitted", {});
    await store.transition(slug, "running", {});
    await store.transition(slug, "succeeded", { result: succeededResult });

    await store.transition(secondSlug, "submitted", {});
    await store.transition(secondSlug, "running", {});
    const secondTerminal = await store.transition(secondSlug, "succeeded", {
      result: succeededResult,
    });
    assert.equal(secondTerminal.state, "succeeded");

    const next = await store.reserve("durable-job-003", "third-fingerprint");
    assert.equal(next.created, true);
    store.close();
  });
});

test("readOnly storeのreserveとtransitionはJOB_RECOVERY_UNAVAILABLEで拒否する", async () => {
  await withStateDirectory(async (stateDirectory) => {
    const writer = createStore(stateDirectory);
    await writer.initialize();
    await writer.reserve(slug, fingerprint);

    const reader = createStore(stateDirectory, true);
    await reader.initialize();
    await assert.rejects(
      reader.reserve("read-only-job-001", fingerprint),
      (error) => error instanceof ConnectorError && error.code === "JOB_RECOVERY_UNAVAILABLE",
    );
    await assert.rejects(
      reader.transition(slug, "uploading", {}),
      (error) => error instanceof ConnectorError && error.code === "JOB_RECOVERY_UNAVAILABLE",
    );
    reader.close();
    writer.close();
  });
});
