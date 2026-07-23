import JSZip from "jszip";
import { isSafeAssetPath } from "./domain";
import { formatBytes } from "./format";
import { DropHereError, type BrowserFileInput, type DeployFile, type DeployLimits, type DeployMode, type PreparedDeployment } from "./types";
import { GUEST_LIMITS, USER_LIMITS } from "./constants";

type InternalFile = {
  file: File;
  path: string;
};

export async function prepareFiles(input: BrowserFileInput[], options: { mode?: DeployMode; sourceLabel?: string } = {}): Promise<PreparedDeployment> {
  if (input.length === 1 && fileName(input[0]).toLowerCase().endsWith(".zip")) {
    return prepareZip(fileObject(input[0]), options);
  }

  const files = input.map(inputToInternal);
  if (files.length === 1 && isHtmlPath(files[0]!.path)) {
    return prepareInternalFiles(
      [{ ...files[0]!, path: "index.html" }],
      options.sourceLabel ?? files[0]!.path,
      limitsForMode(options.mode ?? "guest")
    );
  }

  const normalized = normalizeRootFolder(files);
  return prepareInternalFiles(normalized, options.sourceLabel ?? sourceLabelForFiles(normalized), limitsForMode(options.mode ?? "guest"));
}

export async function prepareHtml(html: string, options: { title?: string; mode?: DeployMode } = {}): Promise<PreparedDeployment> {
  const trimmed = html.trim();
  if (!trimmed) throw new DropHereError("先粘贴 HTML 再发布。", "empty_html");
  const fullHtml = trimmed.toLowerCase().includes("<!doctype") || trimmed.toLowerCase().includes("<html")
    ? trimmed
    : `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(options.title ?? "DropHere 页面")}</title>
</head>
<body>
${trimmed}
</body>
</html>`;
  const file = new File([fullHtml], "index.html", { type: "text/html; charset=utf-8" });
  return prepareInternalFiles([{ file, path: "index.html" }], "粘贴的 HTML", limitsForMode(options.mode ?? "guest"));
}

export async function filesFromDataTransfer(dataTransfer: DataTransfer): Promise<BrowserFileInput[]> {
  const items = [...dataTransfer.items];
  const entryItems = items
    .map((item) => {
      const webkitGetAsEntry = (item as unknown as { webkitGetAsEntry?: () => unknown }).webkitGetAsEntry;
      return typeof webkitGetAsEntry === "function" ? webkitGetAsEntry.call(item) : null;
    })
    .filter(Boolean);

  if (entryItems.length > 0) {
    const collected: BrowserFileInput[] = [];
    for (const entry of entryItems) collected.push(...await filesFromEntry(entry, ""));
    return collected;
  }

  return [...dataTransfer.files];
}

export function contentTypeFor(filePath: string): string {
  const ext = extension(filePath);
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
    ".xml": "application/xml; charset=utf-8",
    ".wasm": "application/wasm",
    ".pdf": "application/pdf",
  };
  return types[ext] ?? "application/octet-stream";
}

export function shouldIgnorePath(assetPath: string): boolean {
  return assetPath.split("/").some((part) =>
    part === ".DS_Store" ||
    part === "node_modules" ||
    part === ".git" ||
    part === ".drophere.local.json" ||
    part === "dist.zip"
  );
}

export function totalBytes(files: Array<{ size: number }>): number {
  return files.reduce((total, file) => total + file.size, 0);
}

async function prepareZip(file: File, options: { mode?: DeployMode; sourceLabel?: string }): Promise<PreparedDeployment> {
  const zip = await JSZip.loadAsync(await readBlobBuffer(file));
  const files: InternalFile[] = [];
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || shouldIgnorePath(name)) continue;
    const blob = await entry.async("blob");
    files.push({
      file: new File([blob], name.split("/").pop() ?? "file", { type: contentTypeFor(name) }),
      path: normalizePath(name),
    });
  }
  return prepareInternalFiles(normalizeRootFolder(files), options.sourceLabel ?? file.name, limitsForMode(options.mode ?? "guest"));
}

async function prepareInternalFiles(input: InternalFile[], sourceLabel: string, limits: DeployLimits): Promise<PreparedDeployment> {
  const safe = input
    .map((item) => ({ ...item, path: normalizePath(item.path) }))
    .filter((item) => !shouldIgnorePath(item.path))
    .sort((left, right) => left.path.localeCompare(right.path));

  if (safe.length === 0) throw new DropHereError("请选择至少一个可以发布的文件。", "empty_deployment");
  if (!safe.some((item) => item.path === "index.html")) {
    throw new DropHereError("文件夹或 zip 里需要有顶层 index.html。单个 HTML 文件可以直接上传。", "entrypoint_missing");
  }
  if (safe.length > limits.maxFiles) {
    throw new DropHereError(`这次上传有 ${safe.length} 个文件，请控制在 ${limits.maxFiles} 个以内。`, "too_many_files");
  }

  const files: DeployFile[] = [];
  for (const item of safe) {
    if (!isSafeAssetPath(item.path)) throw new DropHereError(`文件路径不安全：${item.path}`, "unsafe_path");
    const bytes = await readBlobBuffer(item.file);
    if (bytes.byteLength > limits.maxFileBytes) {
      throw new DropHereError(`${item.path} 是 ${formatBytes(bytes.byteLength)}，单个文件请控制在 ${formatBytes(limits.maxFileBytes)} 以内。`, "file_too_large");
    }
    files.push({
      path: item.path,
      contentBase64: arrayBufferToBase64(bytes),
      contentType: contentTypeFor(item.path),
      size: bytes.byteLength,
      sha256: await sha256Hex(bytes),
    });
  }

  const size = totalBytes(files);
  if (size > limits.maxDeployBytes) {
    throw new DropHereError(`这个网站总大小是 ${formatBytes(size)}，请控制在 ${formatBytes(limits.maxDeployBytes)} 以内。`, "deployment_too_large");
  }

  return {
    entrypoint: "index.html",
    files,
    fileCount: files.length,
    totalBytes: size,
    sourceLabel,
  };
}

function normalizeRootFolder(files: InternalFile[]): InternalFile[] {
  const normalized = files.map((item) => ({ ...item, path: normalizePath(item.path) }));
  if (normalized.some((item) => item.path === "index.html")) return normalized;
  const firstSegments = new Set(normalized.map((item) => item.path.split("/")[0]).filter(Boolean));
  if (firstSegments.size !== 1) return normalized;
  const [root] = [...firstSegments];
  if (!root || !normalized.some((item) => item.path === `${root}/index.html`)) return normalized;
  return normalized.map((item) => ({ ...item, path: item.path.slice(root.length + 1) }));
}

function inputToInternal(input: BrowserFileInput): InternalFile {
  const file = fileObject(input);
  const explicitPath = typeof input === "object" && "file" in input ? input.path : undefined;
  const webkitPath = (file as unknown as { webkitRelativePath?: string }).webkitRelativePath;
  return {
    file,
    path: explicitPath || webkitPath || file.name,
  };
}

function fileObject(input: BrowserFileInput): File {
  return input instanceof File ? input : input.file;
}

function fileName(input: BrowserFileInput): string {
  return fileObject(input).name;
}

function sourceLabelForFiles(files: InternalFile[]): string {
  if (files.length === 1) return files[0]?.path ?? "已选择文件";
  return `${files.length} 个文件`;
}

function limitsForMode(mode: DeployMode): DeployLimits {
  return mode === "user" ? USER_LIMITS : GUEST_LIMITS;
}

function normalizePath(value: string): string {
  return value.replace(/^\/+/, "").replace(/\\/g, "/").replace(/\/+/g, "/");
}

function extension(filePath: string): string {
  const match = /\.[^./]+$/.exec(filePath.toLowerCase());
  return match?.[0] ?? "";
}

function isHtmlPath(filePath: string): boolean {
  const ext = extension(filePath);
  return ext === ".html" || ext === ".htm";
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readBlobBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("无法读取文件。"));
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
        return;
      }
      reject(new Error("无法读取文件内容。"));
    };
    reader.readAsArrayBuffer(blob);
  });
}

async function filesFromEntry(entry: any, parentPath: string): Promise<BrowserFileInput[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject));
    return [{ file, path: `${parentPath}${file.name}` }];
  }
  if (!entry.isDirectory) return [];

  const reader = entry.createReader();
  const children: any[] = [];
  while (true) {
    const batch = await new Promise<any[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) break;
    children.push(...batch);
  }

  const files: BrowserFileInput[] = [];
  for (const child of children) files.push(...await filesFromEntry(child, `${parentPath}${entry.name}/`));
  return files;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[char] ?? char));
}
