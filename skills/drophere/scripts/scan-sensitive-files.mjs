#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";

const MAX_FILES = 200;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const CLI_IGNORED_NAMES = new Set([".git", ".DS_Store", "node_modules"]);
const TEXT_EXTENSIONS = new Set([
  ".astro", ".conf", ".css", ".csv", ".env", ".graphql", ".htm", ".html", ".ini", ".js", ".json",
  ".jsx", ".map", ".md", ".mjs", ".properties", ".svelte", ".svg", ".toml", ".ts", ".tsx", ".txt",
  ".vue", ".xml", ".yaml", ".yml",
]);
const SOURCE_EXTENSIONS = new Set([".astro", ".c", ".cc", ".cpp", ".go", ".java", ".jsx", ".php", ".py", ".rb", ".rs", ".svelte", ".ts", ".tsx", ".vue"]);
const BLOCKED_EXTENSIONS = new Map([
  [".db", "database-file"],
  [".jks", "keystore-file"],
  [".key", "private-key-file"],
  [".keystore", "keystore-file"],
  [".mdb", "database-file"],
  [".p12", "certificate-bundle"],
  [".pem", "private-key-or-certificate"],
  [".pfx", "certificate-bundle"],
  [".sql", "database-dump"],
  [".sqlite", "database-file"],
  [".sqlite3", "database-file"],
]);
const BLOCKED_BASENAMES = new Map([
  [".drophere.local.json", "drophere-local-credentials"],
  [".netrc", "network-credentials"],
  [".npmrc", "package-registry-credentials"],
  [".pypirc", "package-registry-credentials"],
  [".yarnrc", "package-registry-credentials"],
  [".yarnrc.yml", "package-registry-credentials"],
  ["credentials", "credentials-file"],
  ["credentials.json", "credentials-file"],
  ["id_dsa", "ssh-private-key"],
  ["id_ecdsa", "ssh-private-key"],
  ["id_ed25519", "ssh-private-key"],
  ["id_rsa", "ssh-private-key"],
]);
const REVIEW_BASENAMES = new Set([
  "dockerfile", "package-lock.json", "package.json", "pnpm-lock.yaml", "wrangler.json", "wrangler.jsonc", "yarn.lock",
]);
const SECRET_PATTERNS = [
  ["private-key-content", /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/],
  ["aws-access-key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["github-token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ["openai-key", /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/],
  ["anthropic-key", /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
  ["slack-token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ["stripe-live-secret", /\bsk_live_[A-Za-z0-9]{20,}\b/],
  ["google-api-key", /\bAIza[A-Za-z0-9_-]{30,}\b/],
  ["named-api-token", /\b(?:CLOUDFLARE_API_TOKEN|CF_API_TOKEN|DROPHERE_API_TOKEN)\s*[:=]\s*["']?[A-Za-z0-9_-]{20,}/i],
];
const POSSIBLE_SECRET_ASSIGNMENT = /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|secret)\s*[:=]\s*["'][^"'\r\n]{12,}["']/i;

function printHelp() {
  process.stdout.write(`Usage: node scan-sensitive-files.mjs <build-output> [options]

Scan the exact DropHere guest upload directory without printing file contents.

Options:
  --allow-source-maps  Accept source-map exposure after explicit user approval
  --human              Print a concise human-readable result instead of JSON
  --help               Show this help

Exit codes:
  0  Clear for upload
  2  Review required before upload
  3  Upload blocked
  1  Invalid arguments or a scan failure
`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  let target;
  let human = false;
  let allowSourceMaps = false;
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--human") {
      human = true;
      continue;
    }
    if (arg === "--allow-source-maps") {
      allowSourceMaps = true;
      continue;
    }
    if (arg.startsWith("-")) fail(`Unknown option: ${arg}`);
    if (target) fail(`Unexpected positional argument: ${arg}`);
    target = arg;
  }
  if (!target) fail("A build-output directory is required");
  return { target, human, allowSourceMaps };
}

function normalizeRelative(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join("/") || ".";
}

function addFinding(findings, severity, filePath, rule) {
  if (findings.some((finding) => finding.severity === severity && finding.path === filePath && finding.rule === rule)) return;
  findings.push({ severity, path: filePath, rule });
}

function filenameChecks(relativePath, findings, allowSourceMaps) {
  const basename = path.posix.basename(relativePath);
  const lower = basename.toLowerCase();
  const lowerPath = relativePath.toLowerCase();
  const extension = path.posix.extname(lower);

  if (lower === ".env" || lower.startsWith(".env.")) addFinding(findings, "blocked", relativePath, "environment-file");
  if (BLOCKED_BASENAMES.has(lower)) addFinding(findings, "blocked", relativePath, BLOCKED_BASENAMES.get(lower));
  if (BLOCKED_EXTENSIONS.has(extension)) addFinding(findings, "blocked", relativePath, BLOCKED_EXTENSIONS.get(extension));
  if (/^(?:service[-_.]?account|firebase[-_.]?admin).+\.json$/i.test(lower)) addFinding(findings, "blocked", relativePath, "service-account-file");
  if (/(?:^|\/)\.aws\/credentials$/.test(lowerPath)) addFinding(findings, "blocked", relativePath, "cloud-credentials");
  if (/(?:^|\/)\.docker\/config\.json$/.test(lowerPath)) addFinding(findings, "blocked", relativePath, "container-registry-credentials");
  if (/(?:^|\/)application_default_credentials\.json$/.test(lowerPath)) addFinding(findings, "blocked", relativePath, "cloud-credentials");
  if (extension === ".map" && !allowSourceMaps) addFinding(findings, "review", relativePath, "source-map-exposes-source");
  if (SOURCE_EXTENSIONS.has(extension)) addFinding(findings, "review", relativePath, "source-file-in-build-output");
  if (REVIEW_BASENAMES.has(lower)) addFinding(findings, "review", relativePath, "project-or-deployment-config");
  if (/\.(?:bak|backup|old|orig)$/i.test(lower)) addFinding(findings, "review", relativePath, "backup-file");
}

function looksTextual(buffer, extension) {
  if (TEXT_EXTENSIONS.has(extension)) return true;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  return !sample.includes(0);
}

async function contentChecks(file, findings) {
  const extension = path.extname(file.relativePath).toLowerCase();
  const buffer = await fs.readFile(file.absolutePath);
  if (!looksTextual(buffer, extension)) return;
  const content = buffer.toString("utf8");

  for (const [rule, pattern] of SECRET_PATTERNS) {
    if (pattern.test(content)) addFinding(findings, "blocked", file.relativePath, rule);
  }
  if (POSSIBLE_SECRET_ASSIGNMENT.test(content)) {
    addFinding(findings, "review", file.relativePath, "possible-secret-assignment");
  }
}

function printHuman(result) {
  process.stdout.write(`status: ${result.status}\n`);
  process.stdout.write(`directory: ${result.directory}\n`);
  process.stdout.write(`upload: ${result.summary.fileCount} files, ${result.summary.totalBytes} bytes\n`);
  for (const finding of result.findings) {
    process.stdout.write(`${finding.severity}: ${finding.path} (${finding.rule})\n`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const requestedRoot = path.resolve(options.target);
  const rootStat = await fs.stat(requestedRoot).catch(() => null);
  if (!rootStat?.isDirectory()) fail(`Build-output directory does not exist: ${requestedRoot}`);
  const root = await fs.realpath(requestedRoot);
  const files = [];
  const findings = [];
  const ignored = [];

  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      const relativePath = normalizeRelative(root, absolutePath);

      if (entry.name === ".drophere.local.json") {
        addFinding(findings, "blocked", relativePath, "drophere-local-credentials");
        continue;
      }
      if (CLI_IGNORED_NAMES.has(entry.name)) {
        ignored.push({ path: relativePath, rule: "ignored-by-drophere-cli" });
        continue;
      }
      if (entry.isSymbolicLink()) {
        addFinding(findings, "review", relativePath, "symbolic-link-skipped-by-cli");
        continue;
      }
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        addFinding(findings, "review", relativePath, "special-file-skipped-by-cli");
        continue;
      }

      const stat = await fs.stat(absolutePath);
      files.push({ absolutePath, relativePath, size: stat.size });
      filenameChecks(relativePath, findings, options.allowSourceMaps);
      if (stat.size > MAX_FILE_BYTES) addFinding(findings, "blocked", relativePath, "guest-file-limit-exceeded");
    }
  }

  await walk(root);
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const totalBytes = files.reduce((total, file) => total + file.size, 0);

  if (!files.some((file) => file.relativePath === "index.html")) {
    addFinding(findings, "blocked", "index.html", "missing-entrypoint");
  }
  if (files.length > MAX_FILES) addFinding(findings, "blocked", ".", "guest-file-count-limit-exceeded");
  if (totalBytes > MAX_TOTAL_BYTES) addFinding(findings, "blocked", ".", "guest-total-size-limit-exceeded");

  let contentFilesScanned = 0;
  if (totalBytes <= MAX_TOTAL_BYTES && files.length <= MAX_FILES) {
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) continue;
      await contentChecks(file, findings);
      contentFilesScanned += 1;
    }
  }

  findings.sort((left, right) => {
    const weight = { blocked: 0, review: 1 };
    return weight[left.severity] - weight[right.severity] || left.path.localeCompare(right.path) || left.rule.localeCompare(right.rule);
  });
  ignored.sort((left, right) => left.path.localeCompare(right.path));

  const blockedCount = findings.filter((finding) => finding.severity === "blocked").length;
  const reviewCount = findings.filter((finding) => finding.severity === "review").length;
  const status = blockedCount > 0 ? "blocked" : reviewCount > 0 ? "review" : "clear";
  const result = {
    tool: "drophere-sensitive-file-scanner",
    status,
    directory: root,
    publicUpload: true,
    limits: {
      maxFiles: MAX_FILES,
      maxFileBytes: MAX_FILE_BYTES,
      maxTotalBytes: MAX_TOTAL_BYTES,
    },
    summary: {
      fileCount: files.length,
      totalBytes,
      blockedCount,
      reviewCount,
      ignoredCount: ignored.length,
      contentFilesScanned,
    },
    findings,
    ignored,
    note: "Findings contain paths and rule names only; file contents and matched values are never returned.",
  };

  if (options.human) printHuman(result);
  else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(status === "clear" ? 0 : status === "review" ? 2 : 3);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
