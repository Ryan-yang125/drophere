#!/usr/bin/env node

// src/main.ts
import { realpathSync } from "node:fs";
import path5 from "node:path";
import { fileURLToPath } from "node:url";

// src/constants.ts
import os from "node:os";
import path from "node:path";
var VERSION = "1.0.1";
var DEFAULT_API = "https://api.drophere.page";
var DEFAULT_BASE_DOMAIN = "drophere.page";
var USER_CONFIG_PATH = path.join(os.homedir(), ".config", "drophere", "config.json");
var MANAGEMENT_COMMANDS = /* @__PURE__ */ new Set([
  "list",
  "files",
  "teardown",
  "rename",
  "guest",
  "claim",
  "verify-email",
  "login",
  "logout",
  "whoami",
  "doctor",
  "token",
  "quota",
  "usage",
  "contact"
]);

// src/help.ts
function printHelp() {
  process.stdout.write(`
DropHere ${VERSION}

Agent quick path:
  drophere guest <path>
      Deploy a folder without login. DropHere assigns a random temporary domain.

  drophere login --email <email>
      Log in or create an account with a masked password prompt.

  drophere claim <domain>
      Keep the last guest deployment after login. Requires this machine's guest token.

Authenticated deploy:
  drophere <path> <domain>
      Deploy a folder to a chosen drophere.page subdomain.

Project commands:
  drophere list
      List projects for the current user or guest session.

  drophere list <domain>
      List retained deployments for one project.

  drophere files <domain>
      List files in the latest deployment.

  drophere rename <current-domain> <new-domain>
      Rename a claimed or account-owned project to another drophere.page subdomain.

  drophere teardown <domain>
      Remove a project and its deployed files.

Account commands:
  drophere whoami
      Show endpoint, token mode, account or guest status, and API health.

  drophere doctor [path]
      Check API health, local auth, and whether a folder is ready to deploy.

  drophere quota [domain]
      Show remaining quota only.

  drophere usage
      Show account status, verification status, and remaining quota.

  drophere verify-email
      Send a verification email for the current account.

  drophere contact
      Show DropHere contact info.

  drophere logout
      Revoke the user token and keep guest claim data.

  drophere token
      Print the current user token for automation.

Options:
  --endpoint <url>    Override API endpoint. Default: https://api.drophere.page
  --token <token>     Use a bearer token for this command.
  --password-stdin    Read the login password from standard input.
  --version           Print version.
  --help              Print this help.

Guest rules:
  Guest deploys expire automatically and cannot choose a domain.
  To choose a domain, run login first and use: drophere <path> <domain>
`);
}

// src/commands.ts
import { promises as fs3 } from "node:fs";
import path4 from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

// src/errors.ts
var CliError = class extends Error {
};

// src/args.ts
function parsePublishArgs(args) {
  const common = parseCommonArgs(args);
  const positionals = [...common.positionals];
  return {
    ...common,
    project: common.project ?? positionals.shift(),
    domain: common.domain ?? positionals.shift(),
    entrypoint: "index.html"
  };
}
function parseCommonArgs(args) {
  const options = {
    api: void 0,
    email: void 0,
    password: void 0,
    passwordStdin: false,
    project: void 0,
    domain: void 0,
    token: void 0,
    positionals: []
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "--endpoint" || arg === "-e") {
      options.api = readValue(args, index, arg);
      index += 1;
    } else if (arg === "--email") {
      options.email = readValue(args, index, arg);
      index += 1;
    } else if (arg === "--password") {
      options.password = readValue(args, index, arg);
      index += 1;
    } else if (arg === "--password-stdin") {
      options.passwordStdin = true;
    } else if (arg === "--token") {
      options.token = readValue(args, index, arg);
      index += 1;
    } else if (arg === "--project" || arg === "-p") {
      options.project = readValue(args, index, arg);
      index += 1;
    } else if (arg === "--domain" || arg === "-d") {
      options.domain = readValue(args, index, arg);
      index += 1;
    } else if (arg === "--preview") {
      if (args[index + 1] && !args[index + 1].startsWith("-")) index += 1;
    } else if (arg === "-s" || arg === "--stage" || arg === "-m" || arg === "--message" || arg === "-a" || arg === "--add" || arg === "-r" || arg === "--remove") {
      if (args[index + 1] && !args[index + 1].startsWith("-")) index += 1;
    } else if (arg.startsWith("--")) {
      throw new CliError(`Unknown option: ${arg}`);
    } else {
      options.positionals.push(arg);
    }
  }
  return options;
}
function readValue(args, index, option) {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new CliError(`${option} requires a value`);
  }
  return value;
}

// src/config.ts
import { promises as fs } from "node:fs";
import path2 from "node:path";
async function resolveRuntime(options, settings = {}) {
  return resolveRuntimeConfig(options, await loadUserConfig(), settings, process.env);
}
function resolveRuntimeConfig(options, config, settings = {}, environment = process.env) {
  const storedApi = normalizeApiEndpoint(config.api ?? DEFAULT_API);
  const api = normalizeApiEndpoint(options.api ?? environment.DROPHERE_API ?? storedApi);
  const explicitToken = options.token ?? environment.DROPHERE_API_TOKEN;
  const userTokenApi = normalizeApiEndpoint(config.tokenApi ?? config.api ?? DEFAULT_API);
  const anonymousTokenApi = normalizeApiEndpoint(config.anonymousTokenApi ?? config.api ?? DEFAULT_API);
  const userToken = explicitToken ?? (api === userTokenApi ? config.token : void 0);
  const anonymousToken = settings.allowAnonymousToken && api === anonymousTokenApi ? config.anonymousToken : void 0;
  const token = userToken ?? anonymousToken;
  const email = api === userTokenApi ? config.email : void 0;
  if (!token && !settings.allowMissingToken) {
    throw new CliError("Not Authenticated. Run `drophere login --email <email>` or use `drophere guest <path>` for a temporary deploy.");
  }
  return { api, token, email, tokenKind: token ? userToken ? "user" : "anonymous" : void 0 };
}
async function loadConfig() {
  return loadUserConfig();
}
function normalizeApiEndpoint(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new CliError(`Invalid API endpoint: ${value}`);
  }
  const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalhost)) {
    throw new CliError("API endpoint must use HTTPS. Plain HTTP is allowed only for localhost.");
  }
  if (url.username || url.password || url.pathname !== "/" && url.pathname !== "" || url.search || url.hash) {
    throw new CliError("API endpoint must be an origin without credentials, a path, query, or fragment.");
  }
  return url.origin;
}
async function loadUserConfig() {
  return readConfig(USER_CONFIG_PATH);
}
async function readConfig(configPath) {
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      api: typeof parsed.api === "string" ? parsed.api : void 0,
      token: typeof parsed.token === "string" ? parsed.token : void 0,
      tokenApi: typeof parsed.tokenApi === "string" ? parsed.tokenApi : void 0,
      email: typeof parsed.email === "string" ? parsed.email : void 0,
      anonymousToken: typeof parsed.anonymousToken === "string" ? parsed.anonymousToken : void 0,
      anonymousTokenApi: typeof parsed.anonymousTokenApi === "string" ? parsed.anonymousTokenApi : void 0,
      anonymousSessionExpiresAt: typeof parsed.anonymousSessionExpiresAt === "string" ? parsed.anonymousSessionExpiresAt : void 0,
      lastAnonymousSite: typeof parsed.lastAnonymousSite === "string" ? parsed.lastAnonymousSite : void 0
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return {};
    throw error;
  }
}
async function writeUserConfig(config) {
  await fs.mkdir(path2.dirname(USER_CONFIG_PATH), { recursive: true });
  await fs.writeFile(USER_CONFIG_PATH, `${JSON.stringify(config, null, 2)}
`, { mode: 384 });
  await fs.chmod(USER_CONFIG_PATH, 384);
}

// src/format.ts
function formatBytes(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB"];
  let amount = value / 1024;
  for (const unit of units) {
    if (amount < 1024 || unit === "GB") {
      return `${amount.toFixed(amount >= 10 ? 1 : 2)} ${unit}`;
    }
    amount /= 1024;
  }
  return `${value} B`;
}
function humanQuotaKey(key) {
  const labels = {
    projectsRemaining: "projects",
    deploysThisMinuteRemaining: "deploys this minute",
    deploysTodayRemaining: "deploys today",
    projectDeploysTodayRemaining: "project deploys today",
    storageBytesRemaining: "storage",
    deployBytesRemaining: "deployment size",
    fileBytesRemaining: "file size",
    filesRemaining: "files",
    anonymousDeploysThisHourRemaining: "guest deploys this hour",
    anonymousDeploysTodayRemaining: "guest deploys today",
    anonymousActiveProjectsRemaining: "guest active projects"
  };
  return labels[key] ?? key;
}
function formatApiError(prefix, status, body) {
  const lines = [`${prefix} (${status}): ${body?.error ?? "unknown_error"}`];
  if (body?.message) lines.push(body.message);
  if (body?.quota && typeof body.quota === "object") {
    const entries = Object.entries(body.quota).filter(([, value]) => value !== void 0 && value !== null).map(([key, value]) => `  ${humanQuotaKey(key)}: ${key.toLowerCase().includes("bytes") ? formatBytes(value) : value}`);
    if (entries.length) {
      lines.push("remaining quota:");
      lines.push(...entries);
    }
  }
  if (body?.contact?.xiaohongshu) lines.push(`contact: Xiaohongshu ${body.contact.xiaohongshu}`);
  if (Array.isArray(body?.nextActions) && body.nextActions.length) {
    lines.push("next actions:");
    for (const action of body.nextActions.slice(0, 4)) lines.push(`  - ${action}`);
  }
  const guidance = body?.guidance ?? body?.upgrade;
  if (guidance?.usageUrl) lines.push(`usage: ${guidance.usageUrl}`);
  if (body?.retryAfterSeconds) lines.push(`retry after: ${body.retryAfterSeconds}s`);
  return lines.join("\n");
}
function formatRows(rows, columns) {
  if (rows.length === 0) return "Empty\n";
  const matrix = rows.map((row) => columns.map((column) => {
    const formatter = column[2];
    const value = row[column[1]];
    return formatter ? formatter(value) : String(value ?? "");
  }));
  const widths = columns.map((column, index) => Math.max(
    column[0].length,
    ...matrix.map((row) => row[index].length)
  ));
  const output2 = [`${columns.map((column, index) => column[0].padEnd(widths[index])).join("  ")}
`];
  for (const row of matrix) {
    output2.push(`${row.map((value, index) => value.padEnd(widths[index])).join("  ")}
`);
  }
  return output2.join("");
}

// src/api.ts
async function apiRequest(runtime, pathname, options) {
  const headers = {
    ...runtime.token ? { authorization: `Bearer ${runtime.token}` } : {},
    "content-type": "application/json"
  };
  const response = await fetchWithRetry(`${normalizeApiEndpoint(runtime.api)}${pathname}`, {
    method: options.method,
    headers,
    body: options.body ? JSON.stringify(options.body) : void 0
  });
  const body = await parseResponseBody(response);
  if (!response.ok || body.ok === false) {
    throw new CliError(formatApiError("Request failed", response.status, body));
  }
  return body;
}
async function publicApiRequest(api, pathname, options) {
  const response = await fetchWithRetry(`${normalizeApiEndpoint(api)}${pathname}`, {
    method: options.method,
    headers: { "content-type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : void 0
  });
  return { response, body: await parseResponseBody(response) };
}
async function trackCliEvent(api, token, input2) {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return;
  try {
    await fetchWithRetry(`${normalizeApiEndpoint(api)}/v1/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...token ? { authorization: `Bearer ${token}` } : {}
      },
      body: JSON.stringify({
        event: input2.event,
        source: "cli",
        outcome: input2.outcome ?? "info",
        site: input2.site,
        error: input2.error,
        status: input2.status,
        metadata: input2.metadata
      })
    }, 1);
  } catch {
  }
}
async function parseResponseBody(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { ok: false, error: text || response.statusText };
  }
}
async function fetchWithRetry(url, options, attempts = 4) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (response.status < 500 || attempt === attempts - 1) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) throw error;
    }
    await sleep(600 * (attempt + 1));
  }
  throw lastError;
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// src/domain.ts
function siteFromDomain(value) {
  const cleaned = value.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
  const suffix = `.${DEFAULT_BASE_DOMAIN}`;
  const site = cleaned.endsWith(suffix) ? cleaned.slice(0, -suffix.length) : cleaned;
  if (site === DEFAULT_BASE_DOMAIN || site.includes(".")) {
    throw new CliError(`Use a ${DEFAULT_BASE_DOMAIN} subdomain, for example demo.${DEFAULT_BASE_DOMAIN}`);
  }
  if (!isValidSiteSlug(site)) {
    throw new CliError("Invalid domain. Use lowercase letters, numbers, and hyphens.");
  }
  return site;
}
function makeDefaultSiteSlug(name, now = Date.now()) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "site";
  const suffix = now.toString(36).slice(-6);
  return `${base}-${suffix}`;
}
function isValidSiteSlug(slug) {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug);
}
function isSafeAssetPath(assetPath) {
  if (!assetPath || assetPath.length > 512) return false;
  if (assetPath.startsWith("/") || assetPath.includes("\\") || assetPath.includes("\0")) return false;
  return !assetPath.split("/").some((part) => !part || part === "." || part === "..");
}

// src/files.ts
import { createHash } from "node:crypto";
import { promises as fs2 } from "node:fs";
import path3 from "node:path";
async function collectFiles(root) {
  const files2 = [];
  await walk(root, root, files2);
  files2.sort((left, right) => left.path.localeCompare(right.path));
  return files2;
}
async function walk(root, current, files2) {
  const entries = await fs2.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (shouldIgnore(entry.name)) continue;
    const fullPath = path3.join(current, entry.name);
    const relative = path3.relative(root, fullPath).split(path3.sep).join("/");
    if (isSensitivePath(relative, entry.isDirectory())) {
      throw new CliError(`Refusing to deploy sensitive path: ${relative}`);
    }
    if (entry.isDirectory()) {
      await walk(root, fullPath, files2);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!isSafeAssetPath(relative)) throw new CliError(`Unsafe file path: ${relative}`);
    const content = await fs2.readFile(fullPath);
    files2.push({
      path: relative,
      contentBase64: content.toString("base64"),
      contentType: contentTypeFor(relative),
      size: content.byteLength,
      sha256: createHash("sha256").update(content).digest("hex")
    });
  }
}
function shouldIgnore(name) {
  return name === ".DS_Store" || name === "node_modules" || name === ".git" || name === ".drophere.local.json";
}
function isSensitivePath(filePath, isDirectory = false) {
  const normalized = filePath.replace(/\\/g, "/");
  const name = path3.posix.basename(normalized).toLowerCase();
  if (isDirectory && [".ssh", ".aws", ".gnupg"].includes(name)) return true;
  if (name === ".env.example" || name === ".env.sample" || name === ".env.template") return false;
  if (name === ".env" || name.startsWith(".env.")) return true;
  if ([".npmrc", ".pypirc", ".netrc", "credentials", "credentials.json", "service-account.json"].includes(name)) return true;
  if (["id_rsa", "id_dsa", "id_ecdsa", "id_ed25519"].includes(name)) return true;
  if ([".pem", ".key", ".p12", ".pfx"].includes(path3.posix.extname(name))) return true;
  return false;
}
function contentTypeFor(filePath) {
  const ext = path3.extname(filePath).toLowerCase();
  const types = {
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
function sumBytes(files2) {
  return files2.reduce((total, file) => total + file.size, 0);
}

// src/commands.ts
async function publish(args) {
  const options = parsePublishArgs(args);
  const runtime = await resolveRuntime(options);
  let project = options.project;
  let domain = options.domain;
  if (!project && process.stdin.isTTY) {
    project = await prompt("project:", `${path4.resolve(".")}${path4.sep}`);
  }
  if (!project) throw new CliError("Usage: drophere <path> <domain>");
  const root = path4.resolve(project);
  const stat = await fs3.stat(root).catch(() => null);
  if (!stat?.isDirectory()) throw new CliError(`No such directory: ${root}`);
  if (!domain && process.stdin.isTTY) {
    domain = await prompt("domain:", `${makeDefaultSiteSlug(path4.basename(root))}.${DEFAULT_BASE_DOMAIN}`);
  }
  if (!domain) throw new CliError("Missing domain. Example: drophere ./dist demo.drophere.page");
  const site = siteFromDomain(domain);
  const files2 = await collectFiles(root);
  if (files2.length === 0) throw new CliError(`No deployable files found in ${root}`);
  process.stdout.write(`project: ${root}
`);
  process.stdout.write(`domain:  ${site}.${DEFAULT_BASE_DOMAIN}
`);
  process.stdout.write(`upload:  ${files2.length} files, ${formatBytes(sumBytes(files2))}
`);
  await trackCliEvent(runtime.api, runtime.token, {
    event: "publish_started",
    site,
    metadata: { mode: "user", fileCount: files2.length, totalBytes: sumBytes(files2) }
  });
  const body = await apiRequest(runtime, "/v1/deploy", {
    method: "POST",
    body: { source: "cli", site, entrypoint: options.entrypoint, files: files2 }
  });
  process.stdout.write(`Success! - Published to ${body.url}
`);
}
async function guest(args) {
  const options = parsePublishArgs(args);
  const api = normalizeApiEndpoint(options.api ?? process.env.DROPHERE_API ?? (await loadConfig()).api ?? DEFAULT_API);
  let project = options.project;
  if (options.domain) {
    throw new CliError("Guest deploys use random temporary domains. Run `drophere login --email <email>` to choose a custom domain.");
  }
  if (!project && process.stdin.isTTY) {
    project = await prompt("project:", `${path4.resolve(".")}${path4.sep}`);
  }
  if (!project) throw new CliError("Usage: drophere guest <path>");
  const root = path4.resolve(project);
  const stat = await fs3.stat(root).catch(() => null);
  if (!stat?.isDirectory()) throw new CliError(`No such directory: ${root}`);
  const anonymous = await resolveAnonymousSession(api);
  const files2 = await collectFiles(root);
  if (files2.length === 0) throw new CliError(`No deployable files found in ${root}`);
  process.stdout.write(`project: ${root}
`);
  process.stdout.write("mode:    guest temporary deploy\n");
  process.stdout.write(`upload:  ${files2.length} files, ${formatBytes(sumBytes(files2))}
`);
  await trackCliEvent(api, anonymous.token, {
    event: "publish_started",
    metadata: { mode: "guest", fileCount: files2.length, totalBytes: sumBytes(files2) }
  });
  const body = await apiRequest({ api, token: anonymous.token, tokenKind: "anonymous" }, "/v1/deploy", {
    method: "POST",
    body: { source: "cli", entrypoint: options.entrypoint, files: files2 }
  });
  const site = body.site ? String(body.site) : siteFromDomain(String(body.url ?? ""));
  const userConfig = await loadUserConfig();
  await writeUserConfig({
    ...userConfig,
    api: userConfig.api ?? api,
    anonymousToken: anonymous.token,
    anonymousTokenApi: api,
    anonymousSessionExpiresAt: anonymous.expiresAt,
    lastAnonymousSite: site
  });
  process.stdout.write(`domain:  ${site}.${DEFAULT_BASE_DOMAIN}
`);
  process.stdout.write(`expires: ${body.expiresAt ?? "unknown"}
`);
  process.stdout.write("claim:   drophere login --email <email>\n");
  process.stdout.write(`         drophere claim ${site}.${DEFAULT_BASE_DOMAIN}
`);
  process.stdout.write(`Success! - Published temporary site to ${body.url}
`);
}
async function claim(args) {
  const options = parseCommonArgs(args);
  const domain = options.positionals[0];
  if (!domain) throw new CliError("Usage: drophere claim <domain>");
  const site = siteFromDomain(domain);
  const runtime = await resolveRuntime(options);
  const config = await loadConfig();
  if (!config.anonymousToken) {
    throw new CliError("Missing guest token. Deploy with `drophere guest <path>` on this machine before claiming.");
  }
  const anonymousTokenApi = normalizeApiEndpoint(config.anonymousTokenApi ?? config.api ?? DEFAULT_API);
  if (anonymousTokenApi !== runtime.api) {
    throw new CliError(`The saved guest deployment belongs to ${anonymousTokenApi}. Log in to that endpoint before claiming it.`);
  }
  await trackCliEvent(runtime.api, runtime.token, { event: "claim_started", site });
  const body = await apiRequest(runtime, `/v1/projects/${encodeURIComponent(site)}/claim`, {
    method: "POST",
    body: { anonymousToken: config.anonymousToken }
  });
  const userConfig = await loadUserConfig();
  await writeUserConfig({ ...userConfig, api: runtime.api, lastAnonymousSite: site });
  process.stdout.write(`Success - Claimed ${site}.${DEFAULT_BASE_DOMAIN} for ${body.owner?.email ?? runtime.email ?? "your account"}.
`);
  process.stdout.write("This site is now permanent under your account.\n");
}
async function resolveAnonymousSession(api) {
  const userConfig = await loadUserConfig();
  const configuredApi = normalizeApiEndpoint(userConfig.anonymousTokenApi ?? userConfig.api ?? api);
  const expiresAt = userConfig.anonymousSessionExpiresAt;
  if (userConfig.anonymousToken && expiresAt && configuredApi === api && Date.parse(expiresAt) > Date.now() + 6e4) {
    return { token: userConfig.anonymousToken, expiresAt };
  }
  const { response, body } = await publicApiRequest(api, "/v1/auth/anonymous", {
    method: "POST",
    body: { source: "cli" }
  });
  if (!response.ok || body.ok === false || !body.token) {
    throw new CliError(formatApiError("Guest session failed", response.status, body));
  }
  const token = String(body.token);
  const sessionExpiresAt = String(body.session?.expiresAt ?? "");
  await writeUserConfig({
    ...userConfig,
    api: userConfig.api ?? api,
    anonymousToken: token,
    anonymousTokenApi: api,
    anonymousSessionExpiresAt: sessionExpiresAt
  });
  return { token, expiresAt: sessionExpiresAt };
}
async function list(args) {
  const options = parseCommonArgs(args);
  const domain = options.positionals[0];
  const runtime = await resolveRuntime(options, { allowAnonymousToken: true });
  if (domain) {
    const site = siteFromDomain(domain);
    const body2 = await apiRequest(runtime, `/v1/projects/${encodeURIComponent(site)}/deployments`, { method: "GET" });
    process.stdout.write(formatRows(body2.deployments ?? [], [
      ["version", "version"],
      ["deployment", "deploymentId"],
      ["files", "fileCount"],
      ["size", "totalBytes", formatBytes],
      ["created", "createdAt"]
    ]));
    return;
  }
  const body = await apiRequest(runtime, "/v1/projects", { method: "GET" });
  process.stdout.write(formatRows(body.projects ?? [], [
    ["domain", "domain"],
    ["version", "version"],
    ["files", "fileCount"],
    ["size", "totalBytes", formatBytes],
    ["created", "createdAt"]
  ]));
}
async function files(args) {
  const options = parseCommonArgs(args);
  const domain = options.positionals[0];
  if (!domain) throw new CliError("Usage: drophere files <domain>");
  const site = siteFromDomain(domain);
  const runtime = await resolveRuntime(options, { allowAnonymousToken: true });
  const body = await apiRequest(runtime, `/v1/projects/${encodeURIComponent(site)}/files`, { method: "GET" });
  process.stdout.write(formatRows(body.files ?? [], [
    ["path", "path"],
    ["type", "contentType"],
    ["size", "size", formatBytes],
    ["sha256", "sha256"]
  ]));
}
async function rename(args) {
  const options = parseCommonArgs(args);
  const currentDomain = options.positionals[0];
  const nextDomain = options.positionals[1];
  if (!currentDomain || !nextDomain) {
    throw new CliError("Usage: drophere rename <current-domain> <new-domain>");
  }
  const currentSite = siteFromDomain(currentDomain);
  const nextSite = siteFromDomain(nextDomain);
  if (currentSite === nextSite) {
    throw new CliError("The new domain is the same as the current domain.");
  }
  const runtime = await resolveRuntime(options);
  await trackCliEvent(runtime.api, runtime.token, { event: "rename_started", site: currentSite, metadata: { nextSite } });
  const body = await apiRequest(runtime, `/v1/projects/${encodeURIComponent(currentSite)}`, {
    method: "PATCH",
    body: { site: nextSite }
  });
  process.stdout.write(`old:     ${body.oldSite ?? currentSite}.${DEFAULT_BASE_DOMAIN}
`);
  process.stdout.write(`new:     ${body.site ?? nextSite}.${DEFAULT_BASE_DOMAIN}
`);
  process.stdout.write(`url:     ${body.url ?? `https://${nextSite}.${DEFAULT_BASE_DOMAIN}/`}
`);
  process.stdout.write("Success - Domain renamed.\n");
}
async function teardown(args) {
  const options = parseCommonArgs(args);
  const domain = options.positionals[0];
  if (!domain) throw new CliError("Usage: drophere teardown <domain>");
  const site = siteFromDomain(domain);
  const runtime = await resolveRuntime(options, { allowAnonymousToken: true });
  await trackCliEvent(runtime.api, runtime.token, { event: "teardown_started", site });
  const body = await apiRequest(runtime, `/v1/projects/${encodeURIComponent(site)}`, { method: "DELETE" });
  process.stdout.write(`Success - ${site}.${DEFAULT_BASE_DOMAIN} removed (${body.deletedDeployments} deployments, ${body.deletedObjects} objects).
`);
}
async function login(args) {
  const options = parseCommonArgs(args);
  const api = normalizeApiEndpoint(options.api ?? process.env.DROPHERE_API ?? DEFAULT_API);
  const token = options.token ?? process.env.DROPHERE_API_TOKEN;
  if (token) {
    const current2 = await loadUserConfig();
    await writeUserConfig({ ...current2, api, token, tokenApi: api });
    process.stdout.write(`Success - Logged in for ${api}.
`);
    return;
  }
  let email = options.email;
  let password = options.password;
  if (password && options.passwordStdin) throw new CliError("Use either --password or --password-stdin, not both.");
  if (options.passwordStdin) password = await readPasswordFromStdin();
  if (!email && process.stdin.isTTY) email = await prompt("email:", "");
  if (!password && process.stdin.isTTY) password = await promptSecret("password:");
  if (!email || !password) {
    throw new CliError("Missing credentials. Run `drophere login --email <email>` for a masked prompt or pass --password-stdin.");
  }
  const { response, body } = await publicApiRequest(api, "/v1/auth/login", {
    method: "POST",
    body: { email, password, source: "cli" }
  });
  if (!response.ok || body.ok === false || !body.token) {
    throw new CliError(formatApiError("Login failed", response.status, body));
  }
  const current = await loadUserConfig();
  await writeUserConfig({ ...current, api, token: body.token, tokenApi: api, email: body.user?.email ?? email });
  if (body.created) {
    process.stdout.write(`Success - Account created and logged in as ${body.user?.email ?? email}.
`);
  } else {
    process.stdout.write(`Success - Logged in as ${body.user?.email ?? email}.
`);
  }
}
async function logout() {
  const config = await loadUserConfig();
  if (!config.api && !config.token && !config.email) {
    process.stdout.write("Not Authenticated\n");
    return;
  }
  if (config.token) {
    const tokenApi = normalizeApiEndpoint(config.tokenApi ?? config.api ?? DEFAULT_API);
    await apiRequest({ api: tokenApi, token: config.token, tokenKind: "user", email: config.email }, "/v1/auth/logout", { method: "POST" }).catch(() => void 0);
  }
  await writeUserConfig({
    api: config.anonymousTokenApi ?? config.api ?? DEFAULT_API,
    anonymousToken: config.anonymousToken,
    anonymousTokenApi: config.anonymousTokenApi,
    anonymousSessionExpiresAt: config.anonymousSessionExpiresAt,
    lastAnonymousSite: config.lastAnonymousSite
  });
  process.stdout.write("Success - Logged out.\n");
}
async function verifyEmail(args) {
  const options = parseCommonArgs(args);
  const runtime = await resolveRuntime(options);
  const body = await apiRequest(runtime, "/v1/auth/email/request", { method: "POST" });
  if (body.alreadyVerified) {
    process.stdout.write(`email:   ${body.email ?? runtime.email ?? "unknown"}
`);
    process.stdout.write("status:  already verified\n");
    return;
  }
  process.stdout.write(`email:   ${body.email ?? runtime.email ?? "unknown"}
`);
  process.stdout.write("status:  verification email requested\n");
  process.stdout.write("next:    open your mailbox and click the DropHere verification link\n");
}
async function whoami(args) {
  const options = parseCommonArgs(args);
  const runtime = await resolveRuntime(options, { allowMissingToken: true, allowAnonymousToken: true });
  const hasToken = Boolean(runtime.token);
  let health = "unknown";
  let identity = runtime.tokenKind === "anonymous" ? "guest" : runtime.email ?? "unknown";
  let role = "unknown";
  let expiresAt;
  try {
    const response = await fetch(`${runtime.api.replace(/\/$/, "")}/health`);
    health = response.ok ? "ok" : `http ${response.status}`;
  } catch {
    health = "unreachable";
  }
  if (hasToken) {
    try {
      const body = await apiRequest(runtime, "/v1/me", { method: "GET" });
      identity = body.user?.email ?? identity;
      role = body.user?.role ?? role;
      expiresAt = body.user?.expiresAt;
    } catch {
      identity = runtime.email ?? "unknown";
    }
  }
  process.stdout.write(`endpoint: ${runtime.api}
`);
  process.stdout.write(`token:    ${hasToken ? runtime.tokenKind ?? "configured" : "missing"}
`);
  process.stdout.write(`email:    ${identity}
`);
  process.stdout.write(`role:     ${role}
`);
  if (expiresAt) process.stdout.write(`expires:  ${expiresAt}
`);
  process.stdout.write(`service:  ${health}
`);
}
async function doctor(args) {
  const options = parsePublishArgs(args);
  const runtime = await resolveRuntime(options, { allowMissingToken: true, allowAnonymousToken: true });
  const root = path4.resolve(options.project ?? ".");
  const entrypoint = options.entrypoint;
  const issues = [];
  let service = "unknown";
  let auth = "missing";
  let projectStatus = "unknown";
  let fileCount = 0;
  let totalBytes = 0;
  const health = await publicApiRequest(runtime.api, "/health", { method: "GET" }).catch((error) => {
    service = "unreachable";
    issues.push(`API unreachable: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  });
  if (health) {
    service = health.response.ok ? "ok" : `http ${health.response.status}`;
    if (!health.response.ok) issues.push(`API health returned HTTP ${health.response.status}`);
  }
  if (runtime.token) {
    try {
      const me = await apiRequest(runtime, "/v1/me", { method: "GET" });
      const email = me.user?.email ?? runtime.email ?? "guest";
      auth = runtime.tokenKind === "anonymous" ? `guest ${email}` : `user ${email}`;
      if (me.user?.expiresAt) auth += ` expires ${me.user.expiresAt}`;
    } catch (error) {
      auth = "configured but invalid";
      issues.push(error instanceof Error ? error.message : String(error));
    }
  }
  const stat = await fs3.stat(root).catch(() => null);
  if (!stat?.isDirectory()) {
    projectStatus = "missing";
    issues.push(`Project directory not found: ${root}`);
  } else {
    try {
      const files2 = await collectFiles(root);
      fileCount = files2.length;
      totalBytes = sumBytes(files2);
      projectStatus = files2.some((file) => file.path === entrypoint) ? "deployable" : `missing ${entrypoint}`;
      if (files2.length === 0) issues.push(`No deployable files found in ${root}`);
      if (!files2.some((file) => file.path === entrypoint)) issues.push(`Missing ${entrypoint}`);
    } catch (error) {
      projectStatus = "read failed";
      issues.push(error instanceof Error ? error.message : String(error));
    }
  }
  process.stdout.write("DropHere doctor\n");
  process.stdout.write(`version:  ${VERSION}
`);
  process.stdout.write(`endpoint: ${runtime.api}
`);
  process.stdout.write(`service:  ${service}
`);
  process.stdout.write(`auth:     ${auth}
`);
  process.stdout.write(`project:  ${root}
`);
  process.stdout.write(`status:   ${projectStatus}
`);
  process.stdout.write(`files:    ${fileCount}
`);
  process.stdout.write(`size:     ${formatBytes(totalBytes)}
`);
  if (auth === "missing") {
    process.stdout.write("next:     run `drophere guest <path>` for a temporary site or `drophere login --email <email>` for a permanent deploy\n");
  } else if (projectStatus === "deployable") {
    process.stdout.write("next:     ready to deploy\n");
  }
  if (issues.length > 0) {
    process.stdout.write("issues:\n");
    for (const issue of issues) process.stdout.write(`  - ${issue}
`);
    process.exitCode = 1;
  }
}
async function printToken(args) {
  const options = parseCommonArgs(args);
  const runtime = await resolveRuntime(options);
  process.stdout.write(`${runtime.token}
`);
}
async function quota(args) {
  const options = parseCommonArgs(args);
  const runtime = await resolveRuntime(options);
  const query = options.domain ? `?site=${encodeURIComponent(siteFromDomain(options.domain))}` : "";
  const body = await apiRequest(runtime, `/v1/quota${query}`, { method: "GET" });
  const rows = [
    ["projects", body.quota?.projectsRemaining],
    ["deploys this minute", body.quota?.deploysThisMinuteRemaining],
    ["deploys today", body.quota?.deploysTodayRemaining],
    ["project deploys today", body.quota?.projectDeploysTodayRemaining],
    ["storage", body.quota?.storageBytesRemaining == null ? void 0 : formatBytes(body.quota.storageBytesRemaining)]
  ].filter((row) => row[1] !== void 0);
  process.stdout.write(`account: ${body.user?.email ?? runtime.email ?? "unknown"}
`);
  process.stdout.write("remaining quota:\n");
  for (const [label, value] of rows) process.stdout.write(`  ${label}: ${value}
`);
  if (body.contact?.xiaohongshu) process.stdout.write(`contact: Xiaohongshu ${body.contact.xiaohongshu}
`);
}
async function usage(args) {
  const options = parseCommonArgs(args);
  const runtime = await resolveRuntime(options, { allowAnonymousToken: true });
  const body = await apiRequest(runtime, "/v1/usage", { method: "GET" });
  process.stdout.write(`account: ${body.user?.email ?? runtime.email ?? "guest"}
`);
  process.stdout.write(`service: ${body.plan?.name ?? body.plan?.key ?? "unknown"}
`);
  if (body.emailVerified === false) process.stdout.write("email:   not verified - run `drophere verify-email`\n");
  process.stdout.write("remaining quota:\n");
  const remaining = body.remaining ?? body.quota ?? {};
  for (const [key, value] of Object.entries(remaining)) {
    process.stdout.write(`  ${key}: ${key.toLowerCase().includes("bytes") ? formatBytes(value) : value}
`);
  }
  const guidance = body.guidance ?? body.upgrade;
  if (guidance?.message) process.stdout.write(`guidance: ${guidance.message}
`);
  if (body.contact?.xiaohongshu) process.stdout.write(`contact: Xiaohongshu ${body.contact.xiaohongshu}
`);
}
async function contact(args) {
  const options = parseCommonArgs(args);
  const api = normalizeApiEndpoint(options.api ?? process.env.DROPHERE_API ?? DEFAULT_API);
  const { response, body } = await publicApiRequest(api, "/v1/contact", { method: "GET" });
  if (!response.ok || body.ok === false) {
    throw new CliError(formatApiError("Contact lookup failed", response.status, body));
  }
  process.stdout.write(`Xiaohongshu: ${body.contact?.xiaohongshu ?? "krishimtech"}
`);
}
async function prompt(label, fallback) {
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(`${label} ${fallback ? `(${fallback}) ` : ""}`);
    return answer.trim() || fallback;
  } finally {
    rl.close();
  }
}
async function readPasswordFromStdin() {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > 16 * 1024) throw new CliError("Password input is too large.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}
function promptSecret(label) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new CliError("A masked password prompt requires a TTY. Use --password-stdin for automation.");
  }
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const wasRaw = Boolean(stdin.isRaw);
    const wasPaused = stdin.isPaused();
    let value = "";
    let settled = false;
    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(wasRaw);
      if (wasPaused) stdin.pause();
      process.stdout.write("\n");
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    const onData = (chunk) => {
      for (const character of String(chunk)) {
        if (character === "") {
          finish(new CliError("Password prompt cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish(value);
          return;
        }
        if (character === "\x7F" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (character >= " ") value += character;
      }
    };
    process.stdout.write(`${label} `);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

// src/main.ts
async function main(argv = process.argv.slice(2)) {
  const first = argv[0];
  if (first === "--help" || first === "-h" || first === "help") {
    printHelp();
    return;
  }
  if (first === "--version" || first === "-v") {
    process.stdout.write(`${VERSION}
`);
    return;
  }
  if (first === "publish") {
    await publish(argv.slice(1));
    return;
  }
  if (first && MANAGEMENT_COMMANDS.has(first)) {
    await runManagementCommand(first, argv.slice(1));
    return;
  }
  await publish(argv);
}
async function runManagementCommand(command, args) {
  if (command === "login") await login(args);
  else if (command === "guest") await guest(args);
  else if (command === "claim") await claim(args);
  else if (command === "verify-email") await verifyEmail(args);
  else if (command === "logout") await logout();
  else if (command === "whoami") await whoami(args);
  else if (command === "doctor") await doctor(args);
  else if (command === "token") await printToken(args);
  else if (command === "quota") await quota(args);
  else if (command === "usage") await usage(args);
  else if (command === "contact") await contact(args);
  else if (command === "list") await list(args);
  else if (command === "files") await files(args);
  else if (command === "rename") await rename(args);
  else if (command === "teardown") await teardown(args);
}
if (isEntrypoint()) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}
`);
    process.exitCode = 1;
  });
}
function isEntrypoint() {
  if (!process.argv[1]) return false;
  return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(path5.resolve(process.argv[1]));
}
export {
  main
};
