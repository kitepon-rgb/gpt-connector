import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, parse, relative, resolve, sep } from "node:path";

import { ConnectorError } from "./errors.js";

const extensionsByMimeType = new Map<string, readonly string[]>([
  ["image/png", [".png"]],
  ["image/jpeg", [".jpg", ".jpeg"]],
  ["image/webp", [".webp"]],
]);

export interface GeneratedImageBytes {
  readonly content: Uint8Array;
  readonly mimeType: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly width: number | null;
  readonly height: number | null;
}

export interface WrittenGeneratedImage {
  readonly relativePath: string;
  readonly mimeType: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly width: number | null;
  readonly height: number | null;
}

export interface GeneratedImageOutputInput {
  readonly workspaceRoot: string;
  readonly output: string;
}

interface PreparedOutput {
  readonly root: string;
  readonly output: string;
}

function isWithinRoot(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function fail(code: "INVALID_INPUT" | "FILE_OUTSIDE_ROOT" | "IMAGE_OUTPUT_FAILED", message: string): never {
  throw new ConnectorError(code, message);
}

export async function prepareGeneratedImageOutput(
  input: GeneratedImageOutputInput,
): Promise<PreparedOutput> {
  if (!isAbsolute(input.workspaceRoot)) {
    fail("INVALID_INPUT", "workspaceRootはabsolute pathで指定してください。");
  }
  if (
    input.output.length === 0 ||
    input.output.includes("\0") ||
    isAbsolute(input.output)
  ) {
    fail("INVALID_INPUT", "outputはworkspaceRoot相対の画像pathで指定してください。");
  }
  const extension = extname(input.output).toLowerCase();
  if (![...extensionsByMimeType.values()].flat().includes(extension)) {
    fail("INVALID_INPUT", "outputの拡張子は.png、.jpg、.jpeg、.webpのいずれかにしてください。");
  }

  let root: string;
  try {
    root = await realpath(input.workspaceRoot);
    const rootStat = await stat(root);
    if (!rootStat.isDirectory()) fail("INVALID_INPUT", "workspaceRootはdirectoryで指定してください。");
  } catch (error) {
    if (error instanceof ConnectorError) throw error;
    fail("INVALID_INPUT", "workspaceRootを解決できませんでした。");
  }

  const destination = resolve(root, input.output);
  if (!isWithinRoot(root, destination)) {
    fail("FILE_OUTSIDE_ROOT", "outputがworkspaceRoot外を指しています。");
  }
  const canonicalParent = await existingParent(destination);
  if (!isWithinRoot(root, canonicalParent)) {
    fail("FILE_OUTSIDE_ROOT", "outputの親directoryがworkspaceRoot外を指しています。");
  }
  if (!(await stat(canonicalParent)).isDirectory()) {
    fail("IMAGE_OUTPUT_FAILED", "outputの親pathがdirectoryではありません。");
  }
  await assertDestinationAvailable(destination);
  return { root, output: input.output };
}

function numberedOutput(output: string, index: number): string {
  if (index === 0) return output;
  const extension = extname(output);
  return `${output.slice(0, -extension.length)}-${index + 1}${extension}`;
}

async function assertDestinationAvailable(path: string): Promise<void> {
  try {
    await access(path, constants.F_OK);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    fail("IMAGE_OUTPUT_FAILED", "生成画像の保存先を検査できませんでした。");
  }
  fail("IMAGE_OUTPUT_FAILED", "生成画像の保存先が既に存在します。");
}

async function existingParent(path: string): Promise<string> {
  let candidate = dirname(path);
  const root = parse(candidate).root;
  while (true) {
    try {
      return await realpath(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        fail("IMAGE_OUTPUT_FAILED", "outputの親directoryを解決できませんでした。");
      }
      if (candidate === root) fail("IMAGE_OUTPUT_FAILED", "outputの親directoryを解決できませんでした。");
      candidate = dirname(candidate);
    }
  }
}

export async function writeGeneratedImageFiles(
  input: GeneratedImageOutputInput & { readonly images: readonly GeneratedImageBytes[] },
): Promise<readonly WrittenGeneratedImage[]> {
  if (input.images.length === 0) {
    fail("IMAGE_OUTPUT_FAILED", "保存する生成画像がありません。");
  }
  const prepared = await prepareGeneratedImageOutput(input);
  const relativePaths = input.images.map((_, index) => numberedOutput(prepared.output, index));
  const destinations = relativePaths.map((path) => resolve(prepared.root, path));

  for (let index = 0; index < input.images.length; index += 1) {
    const image = input.images[index]!;
    if (
      image.bytes <= 0 ||
      image.content.byteLength !== image.bytes ||
      createHash("sha256").update(image.content).digest("hex") !== image.sha256
    ) {
      fail("IMAGE_OUTPUT_FAILED", "生成画像のbyte数またはdigestが一致しません。");
    }
    const extension = extname(relativePaths[index]!).toLowerCase();
    if (!extensionsByMimeType.get(image.mimeType)?.includes(extension)) {
      fail("IMAGE_OUTPUT_FAILED", "生成画像のMIMEと保存先拡張子が一致しません。");
    }
  }

  for (const destination of destinations) {
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    const canonicalParent = await realpath(dirname(destination));
    if (!isWithinRoot(prepared.root, canonicalParent)) {
      fail("FILE_OUTSIDE_ROOT", "outputの親directoryがworkspaceRoot外を指しています。");
    }
    await assertDestinationAvailable(destination);
  }

  const written: string[] = [];
  try {
    for (let index = 0; index < destinations.length; index += 1) {
      const destination = destinations[index]!;
      await writeFile(destination, input.images[index]!.content, { flag: "wx", mode: 0o600 });
      written.push(destination);
    }
  } catch (error) {
    for (const path of written) await rm(path, { force: true });
    if (error instanceof ConnectorError) throw error;
    fail("IMAGE_OUTPUT_FAILED", "生成画像を保存できませんでした。");
  }

  return input.images.map((image, index) => ({
    relativePath: relativePaths[index]!.split(sep).join("/"),
    mimeType: image.mimeType,
    bytes: image.bytes,
    sha256: image.sha256,
    width: image.width,
    height: image.height,
  }));
}
