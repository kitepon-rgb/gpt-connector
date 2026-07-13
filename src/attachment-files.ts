import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { glob, open, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";

import { ConnectorError } from "./errors.js";

export const attachmentLimits = {
  maxFiles: 20,
  maxFileBytes: 20 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
} as const;

export interface AttachmentFile {
  readonly relativePath: string;
  readonly name: string;
  readonly bytes: number;
  readonly mimeType: string;
  readonly sha256: string;
}

export interface PreparedAttachmentFile extends AttachmentFile {
  readonly content: Uint8Array;
}

export interface AttachmentFileResolution<TFile extends AttachmentFile = AttachmentFile> {
  readonly files: readonly TFile[];
  readonly totalBytes: number;
}

export interface ResolveAttachmentFilesInput {
  readonly workspaceRoot: string;
  readonly specs: readonly string[];
}

const mimeTypes = new Map<string, string>([
  [".md", "text/markdown"],
  [".csv", "text/csv"],
  [".tsv", "text/tab-separated-values"],
  [".json", "application/json"],
  [".xml", "application/xml"],
  [".html", "text/html"],
  [".css", "text/css"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".bmp", "image/bmp"],
  [".tif", "image/tiff"],
  [".tiff", "image/tiff"],
  [".heic", "image/heic"],
  [".heif", "image/heif"],
  [".pdf", "application/pdf"],
  [".rtf", "application/rtf"],
  [".doc", "application/msword"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".odt", "application/vnd.oasis.opendocument.text"],
  [".xls", "application/vnd.ms-excel"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".ods", "application/vnd.oasis.opendocument.spreadsheet"],
  [".ppt", "application/vnd.ms-powerpoint"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  [".odp", "application/vnd.oasis.opendocument.presentation"],
  [".zip", "application/zip"],
  [".tar", "application/x-tar"],
  [".gz", "application/gzip"],
  [".tgz", "application/gzip"],
  [".bz2", "application/x-bzip2"],
  [".7z", "application/x-7z-compressed"],
  [".rar", "application/vnd.rar"],
  [".epub", "application/epub+zip"],
  [".mp3", "audio/mpeg"],
  [".wav", "audio/wav"],
  [".m4a", "audio/mp4"],
  [".ogg", "audio/ogg"],
  [".flac", "audio/flac"],
  [".aac", "audio/aac"],
  [".mp4", "video/mp4"],
  [".mov", "video/quicktime"],
  [".webm", "video/webm"],
  [".mkv", "video/x-matroska"],
]);

const textExtensions = new Set([
  ".txt", ".md", ".rst", ".json", ".jsonl", ".yaml", ".yml", ".toml", ".ini",
  ".xml", ".csv", ".tsv", ".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".jsx",
  ".tsx", ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift", ".c", ".h", ".cpp",
  ".hpp", ".cs", ".php", ".sh", ".bash", ".zsh", ".fish", ".ps1", ".sql", ".css", ".scss",
  ".html", ".diff", ".patch",
]);

function fail(code: ConstructorParameters<typeof ConnectorError>[0], message: string): never {
  throw new ConnectorError(code, message);
}

function normalizedRelativePath(value: string): string {
  return value.split(sep).join("/");
}

function hasParentSegment(spec: string): boolean {
  return spec.split(/[\\/]/u).some((segment) => segment === "..");
}

function validateSpec(spec: string): void {
  if (spec.length === 0 || spec.includes("\0") || isAbsolute(spec) || hasParentSegment(spec)) {
    fail("INVALID_INPUT", "添付file specはworkspaceRoot相対pathまたはglobで指定してください。");
  }
}

function extensionOf(relativePath: string): string {
  const name = relativePath.slice(relativePath.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

function isSensitive(relativePath: string): boolean {
  const name = relativePath.slice(relativePath.lastIndexOf("/") + 1).toLowerCase();
  return name === ".env" || name.startsWith(".env.") || name === ".npmrc" || name === ".netrc" ||
    [".pem", ".key", ".p12", ".pfx", ".kdbx"].some((extension) => name.endsWith(extension)) ||
    name.startsWith("id_rsa") || name.startsWith("id_ed25519") ||
    (name.startsWith("credentials") && name.endsWith(".json")) ||
    (name.startsWith("service-account") && name.endsWith(".json")) || name.startsWith("secrets.");
}

function isInsideRoot(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== ".." && !isAbsolute(pathFromRoot));
}

function sameFileIdentity(
  left: Stats,
  right: Stats,
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function zeroPreparedContents(files: readonly PreparedAttachmentFile[]): void {
  for (const file of files) file.content.fill(0);
}

async function matchesForSpec(workspaceRoot: string, spec: string): Promise<readonly string[]> {
  try {
    const matches: string[] = [];
    for await (const match of glob(spec, { cwd: workspaceRoot, followSymlinks: false })) {
      matches.push(normalizedRelativePath(match));
    }
    return matches.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  } catch {
    fail("INVALID_INPUT", "添付file specを解決できませんでした。");
  }
}

function metadataOf(relativePath: string, content: Uint8Array): AttachmentFile {
  const extension = extensionOf(relativePath);
  const mimeType = mimeTypes.get(extension) ??
    (textExtensions.has(extension) ? "text/plain" : "application/octet-stream");
  return {
    relativePath,
    name: relativePath.slice(relativePath.lastIndexOf("/") + 1),
    bytes: content.byteLength,
    mimeType,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

export async function prepareAttachmentFiles(
  input: ResolveAttachmentFilesInput,
): Promise<AttachmentFileResolution<PreparedAttachmentFile>> {
  if (!isAbsolute(input.workspaceRoot)) {
    fail("INVALID_INPUT", "workspaceRootはabsolute directoryで指定してください。");
  }
  if (input.specs.length > attachmentLimits.maxFiles) {
    fail("FILE_LIMIT_EXCEEDED", "添付file specは20件以下にしてください。");
  }
  for (const spec of input.specs) validateSpec(spec);

  let workspaceRealPath: string;
  try {
    const workspaceStat = await stat(input.workspaceRoot);
    if (!workspaceStat.isDirectory()) {
      fail("INVALID_INPUT", "workspaceRootはdirectoryで指定してください。");
    }
    workspaceRealPath = await realpath(input.workspaceRoot);
  } catch (error) {
    if (error instanceof ConnectorError) throw error;
    fail("INVALID_INPUT", "workspaceRootは読み取り可能なdirectoryで指定してください。");
  }

  const files: PreparedAttachmentFile[] = [];
  const seenRealPaths = new Set<string>();
  let totalBytes = 0;
  let expandedCount = 0;

  try {
  for (const spec of input.specs) {
    const matches = await matchesForSpec(workspaceRealPath, spec);
    if (matches.length === 0) {
      fail("FILE_NOT_FOUND", "添付file specに一致するfileがありません。");
    }
    expandedCount += matches.length;
    if (expandedCount > attachmentLimits.maxFiles) {
      fail("FILE_LIMIT_EXCEEDED", "glob展開後の添付fileは20件以下にしてください。");
    }

    for (const relativePath of matches) {
      const absolutePath = `${workspaceRealPath}${sep}${relativePath.split("/").join(sep)}`;
      let candidateRealPath: string;
      try {
        candidateRealPath = await realpath(absolutePath);
      } catch {
        fail("FILE_NOT_FOUND", "添付fileを解決できませんでした。");
      }
      if (!isInsideRoot(workspaceRealPath, candidateRealPath)) {
        fail("FILE_OUTSIDE_ROOT", "添付fileはworkspaceRoot外を参照できません。");
      }
      if (seenRealPaths.has(candidateRealPath)) continue;

      let initialPathStat;
      try {
        initialPathStat = await stat(candidateRealPath);
      } catch (error) {
        if (error instanceof ConnectorError) throw error;
        fail("FILE_NOT_FOUND", "添付fileを読み取れませんでした。");
      }
      if (!initialPathStat.isFile()) {
        fail("FILE_TYPE_NOT_SUPPORTED", "添付対象はregular fileである必要があります。");
      }
      const canonicalRelativePath = normalizedRelativePath(relative(workspaceRealPath, candidateRealPath));
      if (isSensitive(relativePath) || isSensitive(canonicalRelativePath)) {
        fail("SENSITIVE_FILE_BLOCKED", "秘密情報を含む可能性があるfileは添付できません。");
      }
      if (initialPathStat.size === 0) {
        fail("FILE_EMPTY", "空のfileは添付できません。");
      }
      if (initialPathStat.size > attachmentLimits.maxFileBytes) {
        fail("FILE_LIMIT_EXCEEDED", "添付fileは20MiB以下にしてください。");
      }

      let content: Uint8Array;
      try {
        const handle = await open(candidateRealPath, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const descriptorStat = await handle.stat();
          const resolvedAfterOpen = await realpath(absolutePath);
          if (!isInsideRoot(workspaceRealPath, resolvedAfterOpen)) {
            fail("FILE_OUTSIDE_ROOT", "添付fileはworkspaceRoot外を参照できません。");
          }
          const finalPathStat = await stat(resolvedAfterOpen);
          if (!descriptorStat.isFile() || !sameFileIdentity(descriptorStat, finalPathStat) ||
            !sameFileIdentity(descriptorStat, initialPathStat)) {
            fail("FILE_OUTSIDE_ROOT", "添付fileの解決中にpathが変更されました。");
          }
          content = new Uint8Array(await handle.readFile());
        } finally {
          await handle.close();
        }
      } catch (error) {
        if (error instanceof ConnectorError) throw error;
        fail("FILE_NOT_FOUND", "添付fileを読み取れませんでした。");
      }
      try {
        if (content.byteLength === 0) {
          fail("FILE_EMPTY", "空のfileは添付できません。");
        }
        if (content.byteLength > attachmentLimits.maxFileBytes) {
          fail("FILE_LIMIT_EXCEEDED", "添付fileは20MiB以下にしてください。");
        }
        if (totalBytes + content.byteLength > attachmentLimits.maxTotalBytes) {
          fail("FILE_LIMIT_EXCEEDED", "添付file合計は64MiB以下にしてください。");
        }

        const metadata = metadataOf(relativePath, content);
        files.push({ ...metadata, content });
        totalBytes += content.byteLength;
        seenRealPaths.add(candidateRealPath);
      } catch (error) {
        content.fill(0);
        throw error;
      }
    }
  }

  return { files, totalBytes };
  } catch (error) {
    zeroPreparedContents(files);
    throw error;
  }
}

export async function resolveAttachmentFiles(
  input: ResolveAttachmentFilesInput,
): Promise<AttachmentFileResolution> {
  const prepared = await prepareAttachmentFiles(input);
  try {
    return {
      files: prepared.files.map((file) => ({
        relativePath: file.relativePath,
        name: file.name,
        bytes: file.bytes,
        mimeType: file.mimeType,
        sha256: file.sha256,
      })),
      totalBytes: prepared.totalBytes,
    };
  } finally {
    zeroPreparedContents(prepared.files);
  }
}
