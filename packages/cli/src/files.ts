import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { CliError } from "./errors";
import { isSafeAssetPath } from "./domain";

export type DeployFile = {
  path: string;
  contentBase64: string;
  contentType: string;
  size: number;
  sha256: string;
};

export async function collectFiles(root: string): Promise<DeployFile[]> {
  const files: DeployFile[] = [];
  await walk(root, root, files);
  files.sort((left, right) => left.path.localeCompare(right.path));
  return files;
}

async function walk(root: string, current: string, files: DeployFile[]): Promise<void> {
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (shouldIgnore(entry.name)) continue;
    const fullPath = path.join(current, entry.name);
    const relative = path.relative(root, fullPath).split(path.sep).join("/");
    if (isSensitivePath(relative, entry.isDirectory())) {
      throw new CliError(`Refusing to deploy sensitive path: ${relative}`);
    }
    if (entry.isDirectory()) {
      await walk(root, fullPath, files);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!isSafeAssetPath(relative)) throw new CliError(`Unsafe file path: ${relative}`);
    const content = await fs.readFile(fullPath);
    files.push({
      path: relative,
      contentBase64: content.toString("base64"),
      contentType: contentTypeFor(relative),
      size: content.byteLength,
      sha256: createHash("sha256").update(content).digest("hex")
    });
  }
}

export function shouldIgnore(name: string): boolean {
  return name === ".DS_Store" || name === "node_modules" || name === ".git" || name === ".drophere.local.json";
}

export function isSensitivePath(filePath: string, isDirectory = false): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  const name = path.posix.basename(normalized).toLowerCase();

  if (isDirectory && [".ssh", ".aws", ".gnupg"].includes(name)) return true;
  if (name === ".env.example" || name === ".env.sample" || name === ".env.template") return false;
  if (name === ".env" || name.startsWith(".env.")) return true;
  if ([".npmrc", ".pypirc", ".netrc", "credentials", "credentials.json", "service-account.json"].includes(name)) return true;
  if (["id_rsa", "id_dsa", "id_ecdsa", "id_ed25519"].includes(name)) return true;
  if ([".pem", ".key", ".p12", ".pfx"].includes(path.posix.extname(name))) return true;
  return false;
}

export function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
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
    ".pdf": "application/pdf"
  };
  return types[ext] ?? "application/octet-stream";
}

export function sumBytes(files: Array<{ size: number }>): number {
  return files.reduce((total, file) => total + file.size, 0);
}
