import { promises as fs } from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { DEFAULT_API, DEFAULT_BASE_DOMAIN, VERSION } from "./constants";
import { parseCommonArgs, parsePublishArgs } from "./args";
import { apiRequest, publicApiRequest, trackCliEvent } from "./api";
import { loadConfig, loadUserConfig, normalizeApiEndpoint, resolveRuntime, writeUserConfig } from "./config";
import { makeDefaultSiteSlug, siteFromDomain } from "./domain";
import { collectFiles, sumBytes } from "./files";
import { formatApiError, formatBytes, formatRows } from "./format";
import { CliError } from "./errors";

export async function publish(args: string[]): Promise<void> {
  const options = parsePublishArgs(args);
  const runtime = await resolveRuntime(options);
  let project = options.project;
  let domain = options.domain;

  if (!project && process.stdin.isTTY) {
    project = await prompt("project:", `${path.resolve(".")}${path.sep}`);
  }
  if (!project) throw new CliError("Usage: drophere <path> <domain>");

  const root = path.resolve(project);
  const stat = await fs.stat(root).catch(() => null);
  if (!stat?.isDirectory()) throw new CliError(`No such directory: ${root}`);

  if (!domain && process.stdin.isTTY) {
    domain = await prompt("domain:", `${makeDefaultSiteSlug(path.basename(root))}.${DEFAULT_BASE_DOMAIN}`);
  }
  if (!domain) throw new CliError("Missing domain. Example: drophere ./dist demo.drophere.page");

  const site = siteFromDomain(domain);
  const files = await collectFiles(root);
  if (files.length === 0) throw new CliError(`No deployable files found in ${root}`);

  process.stdout.write(`project: ${root}\n`);
  process.stdout.write(`domain:  ${site}.${DEFAULT_BASE_DOMAIN}\n`);
  process.stdout.write(`upload:  ${files.length} files, ${formatBytes(sumBytes(files))}\n`);
  await trackCliEvent(runtime.api, runtime.token, {
    event: "publish_started",
    site,
    metadata: { mode: "user", fileCount: files.length, totalBytes: sumBytes(files) }
  });

  const body = await apiRequest(runtime, "/v1/deploy", {
    method: "POST",
    body: { source: "cli", site, entrypoint: options.entrypoint, files }
  });

  process.stdout.write(`Success! - Published to ${body.url}\n`);
}

export async function guest(args: string[]): Promise<void> {
  const options = parsePublishArgs(args);
  const api = normalizeApiEndpoint(options.api ?? process.env.DROPHERE_API ?? (await loadConfig()).api ?? DEFAULT_API);
  let project = options.project;

  if (options.domain) {
    throw new CliError("Guest deploys use random temporary domains. Run `drophere login --email <email>` to choose a custom domain.");
  }

  if (!project && process.stdin.isTTY) {
    project = await prompt("project:", `${path.resolve(".")}${path.sep}`);
  }
  if (!project) throw new CliError("Usage: drophere guest <path>");

  const root = path.resolve(project);
  const stat = await fs.stat(root).catch(() => null);
  if (!stat?.isDirectory()) throw new CliError(`No such directory: ${root}`);

  const anonymous = await resolveAnonymousSession(api);
  const files = await collectFiles(root);
  if (files.length === 0) throw new CliError(`No deployable files found in ${root}`);

  process.stdout.write(`project: ${root}\n`);
  process.stdout.write("mode:    guest temporary deploy\n");
  process.stdout.write(`upload:  ${files.length} files, ${formatBytes(sumBytes(files))}\n`);
  await trackCliEvent(api, anonymous.token, {
    event: "publish_started",
    metadata: { mode: "guest", fileCount: files.length, totalBytes: sumBytes(files) }
  });

  const body = await apiRequest({ api, token: anonymous.token, tokenKind: "anonymous" }, "/v1/deploy", {
    method: "POST",
    body: { source: "cli", entrypoint: options.entrypoint, files }
  });

  const site = body.site ? String(body.site) : siteFromDomain(String(body.url ?? ""));
  const userConfig = await loadUserConfig();
  await writeUserConfig({
    ...userConfig,
    api: userConfig.api ?? api,
    anonymousToken: anonymous.token,
    anonymousTokenApi: api,
    anonymousSessionExpiresAt: anonymous.expiresAt,
    lastAnonymousSite: site,
  });

  process.stdout.write(`domain:  ${site}.${DEFAULT_BASE_DOMAIN}\n`);
  process.stdout.write(`expires: ${body.expiresAt ?? "unknown"}\n`);
  process.stdout.write("claim:   drophere login --email <email>\n");
  process.stdout.write(`         drophere claim ${site}.${DEFAULT_BASE_DOMAIN}\n`);
  process.stdout.write(`Success! - Published temporary site to ${body.url}\n`);
}

export async function claim(args: string[]): Promise<void> {
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
  process.stdout.write(`Success - Claimed ${site}.${DEFAULT_BASE_DOMAIN} for ${body.owner?.email ?? runtime.email ?? "your account"}.\n`);
  process.stdout.write("This site is now permanent under your account.\n");
}

async function resolveAnonymousSession(api: string): Promise<{ token: string; expiresAt: string }> {
  const userConfig = await loadUserConfig();
  const configuredApi = normalizeApiEndpoint(userConfig.anonymousTokenApi ?? userConfig.api ?? api);
  const expiresAt = userConfig.anonymousSessionExpiresAt;
  if (
    userConfig.anonymousToken &&
    expiresAt &&
    configuredApi === api &&
    Date.parse(expiresAt) > Date.now() + 60_000
  ) {
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
    anonymousSessionExpiresAt: sessionExpiresAt,
  });
  return { token, expiresAt: sessionExpiresAt };
}

export async function list(args: string[]): Promise<void> {
  const options = parseCommonArgs(args);
  const domain = options.positionals[0];
  const runtime = await resolveRuntime(options, { allowAnonymousToken: true });

  if (domain) {
    const site = siteFromDomain(domain);
    const body = await apiRequest(runtime, `/v1/projects/${encodeURIComponent(site)}/deployments`, { method: "GET" });
    process.stdout.write(formatRows(body.deployments ?? [], [
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

export async function files(args: string[]): Promise<void> {
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

export async function rename(args: string[]): Promise<void> {
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

  process.stdout.write(`old:     ${body.oldSite ?? currentSite}.${DEFAULT_BASE_DOMAIN}\n`);
  process.stdout.write(`new:     ${body.site ?? nextSite}.${DEFAULT_BASE_DOMAIN}\n`);
  process.stdout.write(`url:     ${body.url ?? `https://${nextSite}.${DEFAULT_BASE_DOMAIN}/`}\n`);
  process.stdout.write("Success - Domain renamed.\n");
}

export async function teardown(args: string[]): Promise<void> {
  const options = parseCommonArgs(args);
  const domain = options.positionals[0];
  if (!domain) throw new CliError("Usage: drophere teardown <domain>");
  const site = siteFromDomain(domain);
  const runtime = await resolveRuntime(options, { allowAnonymousToken: true });
  await trackCliEvent(runtime.api, runtime.token, { event: "teardown_started", site });
  const body = await apiRequest(runtime, `/v1/projects/${encodeURIComponent(site)}`, { method: "DELETE" });
  process.stdout.write(`Success - ${site}.${DEFAULT_BASE_DOMAIN} removed (${body.deletedDeployments} deployments, ${body.deletedObjects} objects).\n`);
}

export async function login(args: string[]): Promise<void> {
  const options = parseCommonArgs(args);
  const api = normalizeApiEndpoint(options.api ?? process.env.DROPHERE_API ?? DEFAULT_API);
  const token = options.token ?? process.env.DROPHERE_API_TOKEN;

  if (token) {
    const current = await loadUserConfig();
    await writeUserConfig({ ...current, api, token, tokenApi: api });
    process.stdout.write(`Success - Logged in for ${api}.\n`);
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
    process.stdout.write(`Success - Account created and logged in as ${body.user?.email ?? email}.\n`);
  } else {
    process.stdout.write(`Success - Logged in as ${body.user?.email ?? email}.\n`);
  }
}

export async function logout(): Promise<void> {
  const config = await loadUserConfig();
  if (!config.api && !config.token && !config.email) {
    process.stdout.write("Not Authenticated\n");
    return;
  }
  if (config.token) {
    const tokenApi = normalizeApiEndpoint(config.tokenApi ?? config.api ?? DEFAULT_API);
    await apiRequest({ api: tokenApi, token: config.token, tokenKind: "user", email: config.email }, "/v1/auth/logout", { method: "POST" }).catch(() => undefined);
  }
  await writeUserConfig({
    api: config.anonymousTokenApi ?? config.api ?? DEFAULT_API,
    anonymousToken: config.anonymousToken,
    anonymousTokenApi: config.anonymousTokenApi,
    anonymousSessionExpiresAt: config.anonymousSessionExpiresAt,
    lastAnonymousSite: config.lastAnonymousSite,
  });
  process.stdout.write("Success - Logged out.\n");
}

export async function verifyEmail(args: string[]): Promise<void> {
  const options = parseCommonArgs(args);
  const runtime = await resolveRuntime(options);
  const body = await apiRequest(runtime, "/v1/auth/email/request", { method: "POST" });
  if (body.alreadyVerified) {
    process.stdout.write(`email:   ${body.email ?? runtime.email ?? "unknown"}\n`);
    process.stdout.write("status:  already verified\n");
    return;
  }
  process.stdout.write(`email:   ${body.email ?? runtime.email ?? "unknown"}\n`);
  process.stdout.write("status:  verification email requested\n");
  process.stdout.write("next:    open your mailbox and click the DropHere verification link\n");
}

export async function whoami(args: string[]): Promise<void> {
  const options = parseCommonArgs(args);
  const runtime = await resolveRuntime(options, { allowMissingToken: true, allowAnonymousToken: true });
  const hasToken = Boolean(runtime.token);
  let health = "unknown";
  let identity = runtime.tokenKind === "anonymous" ? "guest" : runtime.email ?? "unknown";
  let role = "unknown";
  let expiresAt: string | undefined;

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

  process.stdout.write(`endpoint: ${runtime.api}\n`);
  process.stdout.write(`token:    ${hasToken ? runtime.tokenKind ?? "configured" : "missing"}\n`);
  process.stdout.write(`email:    ${identity}\n`);
  process.stdout.write(`role:     ${role}\n`);
  if (expiresAt) process.stdout.write(`expires:  ${expiresAt}\n`);
  process.stdout.write(`service:  ${health}\n`);
}

export async function doctor(args: string[]): Promise<void> {
  const options = parsePublishArgs(args);
  const runtime = await resolveRuntime(options, { allowMissingToken: true, allowAnonymousToken: true });
  const root = path.resolve(options.project ?? ".");
  const entrypoint = options.entrypoint;
  const issues: string[] = [];
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

  const stat = await fs.stat(root).catch(() => null);
  if (!stat?.isDirectory()) {
    projectStatus = "missing";
    issues.push(`Project directory not found: ${root}`);
  } else {
    try {
      const files = await collectFiles(root);
      fileCount = files.length;
      totalBytes = sumBytes(files);
      projectStatus = files.some((file) => file.path === entrypoint) ? "deployable" : `missing ${entrypoint}`;
      if (files.length === 0) issues.push(`No deployable files found in ${root}`);
      if (!files.some((file) => file.path === entrypoint)) issues.push(`Missing ${entrypoint}`);
    } catch (error) {
      projectStatus = "read failed";
      issues.push(error instanceof Error ? error.message : String(error));
    }
  }

  process.stdout.write("DropHere doctor\n");
  process.stdout.write(`version:  ${VERSION}\n`);
  process.stdout.write(`endpoint: ${runtime.api}\n`);
  process.stdout.write(`service:  ${service}\n`);
  process.stdout.write(`auth:     ${auth}\n`);
  process.stdout.write(`project:  ${root}\n`);
  process.stdout.write(`status:   ${projectStatus}\n`);
  process.stdout.write(`files:    ${fileCount}\n`);
  process.stdout.write(`size:     ${formatBytes(totalBytes)}\n`);

  if (auth === "missing") {
    process.stdout.write("next:     run `drophere guest <path>` for a temporary site or `drophere login --email <email>` for a permanent deploy\n");
  } else if (projectStatus === "deployable") {
    process.stdout.write("next:     ready to deploy\n");
  }

  if (issues.length > 0) {
    process.stdout.write("issues:\n");
    for (const issue of issues) process.stdout.write(`  - ${issue}\n`);
    process.exitCode = 1;
  }
}

export async function printToken(args: string[]): Promise<void> {
  const options = parseCommonArgs(args);
  const runtime = await resolveRuntime(options);
  process.stdout.write(`${runtime.token}\n`);
}

export async function quota(args: string[]): Promise<void> {
  const options = parseCommonArgs(args);
  const runtime = await resolveRuntime(options);
  const query = options.domain ? `?site=${encodeURIComponent(siteFromDomain(options.domain))}` : "";
  const body = await apiRequest(runtime, `/v1/quota${query}`, { method: "GET" });
  const rows = [
    ["projects", body.quota?.projectsRemaining],
    ["deploys this minute", body.quota?.deploysThisMinuteRemaining],
    ["deploys today", body.quota?.deploysTodayRemaining],
    ["project deploys today", body.quota?.projectDeploysTodayRemaining],
    ["storage", body.quota?.storageBytesRemaining == null ? undefined : formatBytes(body.quota.storageBytesRemaining)]
  ].filter((row) => row[1] !== undefined);

  process.stdout.write(`account: ${body.user?.email ?? runtime.email ?? "unknown"}\n`);
  process.stdout.write("remaining quota:\n");
  for (const [label, value] of rows) process.stdout.write(`  ${label}: ${value}\n`);
  if (body.contact?.xiaohongshu) process.stdout.write(`contact: Xiaohongshu ${body.contact.xiaohongshu}\n`);
}

export async function usage(args: string[]): Promise<void> {
  const options = parseCommonArgs(args);
  const runtime = await resolveRuntime(options, { allowAnonymousToken: true });
  const body = await apiRequest(runtime, "/v1/usage", { method: "GET" });
  process.stdout.write(`account: ${body.user?.email ?? runtime.email ?? "guest"}\n`);
  process.stdout.write(`service: ${body.plan?.name ?? body.plan?.key ?? "unknown"}\n`);
  if (body.emailVerified === false) process.stdout.write("email:   not verified - run `drophere verify-email`\n");
  process.stdout.write("remaining quota:\n");
  const remaining = body.remaining ?? body.quota ?? {};
  for (const [key, value] of Object.entries(remaining)) {
    process.stdout.write(`  ${key}: ${key.toLowerCase().includes("bytes") ? formatBytes(value) : value}\n`);
  }
  const guidance = body.guidance ?? body.upgrade;
  if (guidance?.message) process.stdout.write(`guidance: ${guidance.message}\n`);
  if (body.contact?.xiaohongshu) process.stdout.write(`contact: Xiaohongshu ${body.contact.xiaohongshu}\n`);
}

export async function contact(args: string[]): Promise<void> {
  const options = parseCommonArgs(args);
  const api = normalizeApiEndpoint(options.api ?? process.env.DROPHERE_API ?? DEFAULT_API);
  const { response, body } = await publicApiRequest(api, "/v1/contact", { method: "GET" });
  if (!response.ok || body.ok === false) {
    throw new CliError(formatApiError("Contact lookup failed", response.status, body));
  }
  process.stdout.write(`Xiaohongshu: ${body.contact?.xiaohongshu ?? "krishimtech"}\n`);
}

async function prompt(label: string, fallback: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(`${label} ${fallback ? `(${fallback}) ` : ""}`);
    return answer.trim() || fallback;
  } finally {
    rl.close();
  }
}

async function readPasswordFromStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > 16 * 1024) throw new CliError("Password input is too large.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

function promptSecret(label: string): Promise<string> {
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
    const finish = (result: string | Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    const onData = (chunk: Buffer | string) => {
      for (const character of String(chunk)) {
        if (character === "\u0003") {
          finish(new CliError("Password prompt cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
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
