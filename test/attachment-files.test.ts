import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";

import {
  attachmentLimits,
  prepareAttachmentFiles,
  resolveAttachmentFiles,
} from "../src/attachment-files.js";
import { ConnectorError } from "../src/errors.js";

interface AttachmentFile {
  readonly relativePath: string;
  readonly name: string;
  readonly bytes: number;
  readonly mimeType: string;
  readonly sha256: string;
}

interface AttachmentResolution {
  readonly files: readonly AttachmentFile[];
  readonly totalBytes: number;
}

async function withWorkspace(
  run: (workspaceRoot: string) => Promise<void>,
): Promise<void> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "gpt-connector-attachment-files-"));
  try {
    await run(await realpath(workspaceRoot));
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function expectConnectorError(
  operation: Promise<unknown>,
  code: string,
): Promise<void> {
  await assert.rejects(
    operation,
    (error) => error instanceof ConnectorError && error.code === code,
  );
}

test("attachment resolverの初回release上限を固定する", () => {
  assert.deepEqual(attachmentLimits, {
    maxFiles: 20,
    maxFileBytes: 20 * 1024 * 1024,
    maxTotalBytes: 64 * 1024 * 1024,
  });
});

test("spec順、glob内POSIX相対path順、realpath first occurrenceで解決する", async () => {
  await withWorkspace(async (workspaceRoot) => {
    await mkdir(join(workspaceRoot, "alpha"));
    await mkdir(join(workspaceRoot, "beta"));
    await writeFile(join(workspaceRoot, "alpha", "z.md"), "z");
    await writeFile(join(workspaceRoot, "alpha", "a.md"), "a");
    await writeFile(join(workspaceRoot, "beta", "note.txt"), "note");
    await symlink(join(workspaceRoot, "alpha", "a.md"), join(workspaceRoot, "beta", "alias.md"));

    const result: AttachmentResolution = await resolveAttachmentFiles({
      workspaceRoot,
      specs: ["beta/*.txt", "alpha/*.md", "beta/alias.md"],
    });

    assert.deepEqual(
      result.files.map((file) => file.relativePath),
      ["beta/note.txt", "alpha/a.md", "alpha/z.md"],
    );
    assert.deepEqual(
      result.files.map((file) => file.name),
      ["note.txt", "a.md", "z.md"],
    );
    assert.deepEqual(
      result.files.map((file) => file.mimeType),
      ["text/plain", "text/markdown", "text/markdown"],
    );
    assert.deepEqual(
      result.files.map((file) => file.bytes),
      [4, 1, 1],
    );
    assert.deepEqual(
      result.files.map((file) => file.sha256),
      [sha256("note"), sha256("a"), sha256("z")],
    );
    assert.equal(result.totalBytes, 6);
  });
});

test("globが0件ならFILE_NOT_FOUNDで拒否する", async () => {
  await withWorkspace(async (workspaceRoot) => {
    await expectConnectorError(
      resolveAttachmentFiles({ workspaceRoot, specs: ["missing/*.md"] }),
      "FILE_NOT_FOUND",
    );
  });
});

test("absolute pathと親directory traversalをINVALID_INPUTで拒否する", async () => {
  await withWorkspace(async (workspaceRoot) => {
    await writeFile(join(workspaceRoot, "safe.md"), "safe");

    await expectConnectorError(
      resolveAttachmentFiles({ workspaceRoot, specs: [join(workspaceRoot, "safe.md")] }),
      "INVALID_INPUT",
    );
    await expectConnectorError(
      resolveAttachmentFiles({ workspaceRoot, specs: ["../safe.md"] }),
      "INVALID_INPUT",
    );
  });
});

test("root外を指すsymlinkはFILE_OUTSIDE_ROOTで拒否する", async () => {
  const outsideRoot = await mkdtemp(join(tmpdir(), "gpt-connector-attachment-outside-"));
  try {
    const outsideFile = join(outsideRoot, "outside.md");
    await writeFile(outsideFile, "outside");
    await withWorkspace(async (workspaceRoot) => {
      await symlink(outsideFile, join(workspaceRoot, "outside.md"));
      await expectConnectorError(
        resolveAttachmentFiles({ workspaceRoot, specs: ["outside.md"] }),
        "FILE_OUTSIDE_ROOT",
      );
    });
  } finally {
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test("directoryとempty fileを計画codeで拒否する", async () => {
  await withWorkspace(async (workspaceRoot) => {
    await mkdir(join(workspaceRoot, "directory.md"));
    await writeFile(join(workspaceRoot, "empty.md"), "");

    await expectConnectorError(
      resolveAttachmentFiles({ workspaceRoot, specs: ["directory.md"] }),
      "FILE_TYPE_NOT_SUPPORTED",
    );
    await expectConnectorError(
      resolveAttachmentFiles({ workspaceRoot, specs: ["empty.md"] }),
      "FILE_EMPTY",
    );
  });
});

test("一般的なbinary形式へ標準MIMEを割り当て、未知形式と不正UTF-8もpass-throughする", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const cases = [
      ["photo.jpg", "image/jpeg"],
      ["animation.gif", "image/gif"],
      ["picture.webp", "image/webp"],
      ["document.pdf", "application/pdf"],
      ["document.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      ["sheet.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
      ["slides.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
      ["archive.zip", "application/zip"],
      ["unknown.bin", "application/octet-stream"],
      ["invalid-utf8.txt", "text/plain"],
    ] as const;
    const content = new Uint8Array([0xff, 0x00, 0xfe, 0x7f]);
    for (const [name] of cases) await writeFile(join(workspaceRoot, name), content);

    const result = await resolveAttachmentFiles({
      workspaceRoot,
      specs: cases.map(([name]) => name),
    });

    assert.deepEqual(
      result.files.map((file) => [file.name, file.mimeType]),
      cases,
    );
    assert.deepEqual(result.files.map((file) => file.sha256), cases.map(() => sha256(content)));
    assert.deepEqual(result.files.map((file) => file.bytes), cases.map(() => content.byteLength));
  });
});

test("PNGをbinaryのまま解決し、MIME・bytes・digestを返す", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const fixture = new Uint8Array(await readFile(new URL(
      "fixtures/native-attachment/image/visual-marker.png",
      import.meta.url,
    )));
    await writeFile(join(workspaceRoot, "visual-marker.png"), fixture);

    const result = await resolveAttachmentFiles({
      workspaceRoot,
      specs: ["visual-marker.png"],
    });
    assert.deepEqual(result.files, [{
      relativePath: "visual-marker.png",
      name: "visual-marker.png",
      bytes: 22_427,
      mimeType: "image/png",
      sha256: sha256(fixture),
    }]);

    const prepared = await prepareAttachmentFiles({
      workspaceRoot,
      specs: ["visual-marker.png"],
    });
    assert.deepEqual(prepared.files[0]?.content, fixture);
    prepared.files[0]?.content.fill(0);
  });
});

test("sensitive denylistをSENSITIVE_FILE_BLOCKEDで拒否する", async () => {
  await withWorkspace(async (workspaceRoot) => {
    for (const name of [".env", ".env.local", ".npmrc", ".netrc", "private.pem", "id_rsa.pub", "credentials.json", "secrets.yaml"]) {
      await writeFile(join(workspaceRoot, name), "secret-looking");
      await expectConnectorError(
        resolveAttachmentFiles({ workspaceRoot, specs: [name] }),
        "SENSITIVE_FILE_BLOCKED",
      );
    }
  });
});

test("safeな名前のsymlinkでもcanonical targetが.envならSENSITIVE_FILE_BLOCKEDで拒否する", async () => {
  await withWorkspace(async (workspaceRoot) => {
    await writeFile(join(workspaceRoot, ".env"), "secret-looking");
    await symlink(join(workspaceRoot, ".env"), join(workspaceRoot, "safe.md"));

    await expectConnectorError(
      resolveAttachmentFiles({ workspaceRoot, specs: ["safe.md"] }),
      "SENSITIVE_FILE_BLOCKED",
    );
  });
});

test("root内の通常symlinkは許可し、canonical target単位でfirst occurrenceを残す", async () => {
  await withWorkspace(async (workspaceRoot) => {
    await writeFile(join(workspaceRoot, "regular.md"), "ordinary content");
    await symlink(join(workspaceRoot, "regular.md"), join(workspaceRoot, "alias.md"));

    const result: AttachmentResolution = await resolveAttachmentFiles({
      workspaceRoot,
      specs: ["alias.md", "regular.md"],
    });
    assert.deepEqual(result.files, [{
      relativePath: "alias.md",
      name: "alias.md",
      bytes: 16,
      mimeType: "text/markdown",
      sha256: sha256("ordinary content"),
    }]);
  });
});

test("glob展開後の21件をFILE_LIMIT_EXCEEDEDで拒否する", async () => {
  await withWorkspace(async (workspaceRoot) => {
    for (let index = 0; index < 21; index += 1) {
      await writeFile(join(workspaceRoot, `file-${String(index).padStart(2, "0")}.txt`), "x");
    }

    await expectConnectorError(
      resolveAttachmentFiles({ workspaceRoot, specs: ["*.txt"] }),
      "FILE_LIMIT_EXCEEDED",
    );
  });
});

test("明示specの21件をFILE_LIMIT_EXCEEDEDで拒否する", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const specs: string[] = [];
    for (let index = 0; index < 21; index += 1) {
      const name = `explicit-${String(index).padStart(2, "0")}.txt`;
      await writeFile(join(workspaceRoot, name), "x");
      specs.push(name);
    }

    await expectConnectorError(
      resolveAttachmentFiles({ workspaceRoot, specs }),
      "FILE_LIMIT_EXCEEDED",
    );
  });
});

test("single fileが20MiB超ならFILE_LIMIT_EXCEEDEDで拒否する", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const file = join(workspaceRoot, "large.txt");
    await writeFile(file, "x");
    await truncate(file, 20 * 1024 * 1024 + 1);

    await expectConnectorError(
      resolveAttachmentFiles({ workspaceRoot, specs: ["large.txt"] }),
      "FILE_LIMIT_EXCEEDED",
    );
  });
});

test("合計が64MiB超ならFILE_LIMIT_EXCEEDEDで拒否する", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const specs: string[] = [];
    for (const [index, size] of [17, 17, 17, 14].entries()) {
      const name = `total-${index}.txt`;
      const file = join(workspaceRoot, name);
      await writeFile(file, "x");
      await truncate(file, size * 1024 * 1024);
      specs.push(name);
    }

    await expectConnectorError(
      resolveAttachmentFiles({ workspaceRoot, specs }),
      "FILE_LIMIT_EXCEEDED",
    );
  });
});

test("空/NUL specと非absoluteまたは非directory workspaceRootをINVALID_INPUTで拒否する", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const workspaceFile = join(workspaceRoot, "not-a-directory.txt");
    await writeFile(workspaceFile, "file");

    await expectConnectorError(
      resolveAttachmentFiles({ workspaceRoot, specs: [""] }),
      "INVALID_INPUT",
    );
    await expectConnectorError(
      resolveAttachmentFiles({ workspaceRoot, specs: ["nul\0.txt"] }),
      "INVALID_INPUT",
    );
    await expectConnectorError(
      resolveAttachmentFiles({ workspaceRoot: "relative", specs: ["file.txt"] }),
      "INVALID_INPUT",
    );
    await expectConnectorError(
      resolveAttachmentFiles({ workspaceRoot: workspaceFile, specs: ["file.txt"] }),
      "INVALID_INPUT",
    );
  });
});

test("file要素はbasename・POSIX相対path・bytes・MIME・SHA-256だけを返す", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const content = "name and digest";
    const relativePath = "nested/probe.json";
    await mkdir(join(workspaceRoot, "nested"));
    await writeFile(join(workspaceRoot, "nested", "probe.json"), content);

    const { files, totalBytes }: AttachmentResolution = await resolveAttachmentFiles({
      workspaceRoot,
      specs: [relativePath],
    });
    assert.deepEqual(files, [{
      relativePath,
      name: basename(relativePath),
      bytes: Buffer.byteLength(content),
      mimeType: "application/json",
      sha256: sha256(content),
    }]);
    assert.equal(totalBytes, Buffer.byteLength(content));
  });
});

test("prepare成功時のcontentはupload callerが所有し、caller自身でzero-fillできる", async () => {
  await withWorkspace(async (workspaceRoot) => {
    await writeFile(join(workspaceRoot, "upload.txt"), "upload content");

    const prepared = await prepareAttachmentFiles({ workspaceRoot, specs: ["upload.txt"] });
    const content = prepared.files[0]!.content;
    assert.deepEqual(content, new TextEncoder().encode("upload content"));
    content.fill(0);
    assert.deepEqual(content, new Uint8Array(content.byteLength));
  });
});
