import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  prepareGeneratedImageOutput,
  writeGeneratedImageFiles,
} from "../src/generated-image-files.js";
import { ConnectorError } from "../src/errors.js";

function image(content: string) {
  const bytes = Buffer.from(content);
  return {
    content: bytes,
    mimeType: "image/png",
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    width: 100,
    height: 200,
  } as const;
}

test("生成画像をroot相対へno-clobberで保存し、複数画像へsuffixを付ける", async () => {
  const root = await mkdtemp(join(tmpdir(), "gpt-connector-image-"));
  const result = await writeGeneratedImageFiles({
    workspaceRoot: root,
    output: "assets/ad.png",
    images: [image("one"), image("two")],
  });

  assert.deepEqual(result.map((item) => item.relativePath), ["assets/ad.png", "assets/ad-2.png"]);
  assert.equal(await readFile(join(root, "assets/ad.png"), "utf8"), "one");
  assert.equal(await readFile(join(root, "assets/ad-2.png"), "utf8"), "two");

  await assert.rejects(
    writeGeneratedImageFiles({ workspaceRoot: root, output: "assets/ad.png", images: [image("x")] }),
    (error: unknown) => error instanceof ConnectorError && error.code === "IMAGE_OUTPUT_FAILED",
  );
});

test("absolute・traversal・root外symlink・MIME不一致を拒否する", async () => {
  const root = await mkdtemp(join(tmpdir(), "gpt-connector-image-root-"));
  const outside = await mkdtemp(join(tmpdir(), "gpt-connector-image-outside-"));
  await mkdir(join(root, "assets"));
  await symlink(outside, join(root, "escape"));

  await assert.rejects(
    prepareGeneratedImageOutput({ workspaceRoot: root, output: "/tmp/ad.png" }),
    (error: unknown) => error instanceof ConnectorError && error.code === "INVALID_INPUT",
  );
  await assert.rejects(
    prepareGeneratedImageOutput({ workspaceRoot: root, output: "../ad.png" }),
    (error: unknown) => error instanceof ConnectorError && error.code === "FILE_OUTSIDE_ROOT",
  );
  await assert.rejects(
    writeGeneratedImageFiles({ workspaceRoot: root, output: "escape/ad.png", images: [image("x")] }),
    (error: unknown) => error instanceof ConnectorError && error.code === "FILE_OUTSIDE_ROOT",
  );
  await assert.rejects(
    writeGeneratedImageFiles({ workspaceRoot: root, output: "assets/ad.webp", images: [image("x")] }),
    (error: unknown) => error instanceof ConnectorError && error.code === "IMAGE_OUTPUT_FAILED",
  );
});

test("digest不一致時は書き込まず失敗する", async () => {
  const root = await mkdtemp(join(tmpdir(), "gpt-connector-image-digest-"));
  await assert.rejects(
    writeGeneratedImageFiles({
      workspaceRoot: root,
      output: "ad.png",
      images: [{ ...image("x"), sha256: "0".repeat(64) }],
    }),
    (error: unknown) => error instanceof ConnectorError && error.code === "IMAGE_OUTPUT_FAILED",
  );
  await assert.rejects(readFile(join(root, "ad.png")));
});
