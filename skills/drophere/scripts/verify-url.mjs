#!/usr/bin/env node

import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 750;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ASSETS = 40;
const MAX_REMOTE_BODY_INSPECTION_BYTES = 8192;

function printHelp() {
  process.stdout.write(`Usage: node verify-url.mjs <drophere-url> [options]

Verify a deployed DropHere homepage, local-build assets, and optional routes.

Options:
  --dir <path>           Scanned local build output containing index.html
  --route <path>         Verify an important application route; repeatable
  --retries <count>      Retry failed requests (default: 3)
  --retry-delay-ms <ms>  Delay between retries (default: 750)
  --timeout-ms <ms>      Per-request timeout (default: 10000)
  --max-assets <count>   Maximum same-origin assets to check (default: 40)
  --human                Print a concise human-readable result instead of JSON
  --allow-localhost      Permit HTTP localhost URLs for local script tests only
  --help                 Show this help

Exit codes:
  0  Verified
  2  Degraded or partially verified
  3  Failed verification
  1  Invalid arguments or an execution failure
`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseInteger(value, option, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    fail(`${option} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function parseArgs(argv) {
  let target;
  let buildDirectory;
  const routes = [];
  let retries = DEFAULT_RETRIES;
  let retryDelayMs = DEFAULT_RETRY_DELAY_MS;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let maxAssets = DEFAULT_MAX_ASSETS;
  let human = false;
  let allowLocalhost = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--human") {
      human = true;
      continue;
    }
    if (arg === "--allow-localhost") {
      allowLocalhost = true;
      continue;
    }
    if (["--dir", "--route", "--retries", "--retry-delay-ms", "--timeout-ms", "--max-assets"].includes(arg)) {
      const value = argv[index + 1];
      if (value === undefined) fail(`Missing value for ${arg}`);
      index += 1;
      if (arg === "--dir") buildDirectory = value;
      if (arg === "--route") routes.push(value);
      if (arg === "--retries") retries = parseInteger(value, arg, 0, 10);
      if (arg === "--retry-delay-ms") retryDelayMs = parseInteger(value, arg, 0, 30_000);
      if (arg === "--timeout-ms") timeoutMs = parseInteger(value, arg, 250, 120_000);
      if (arg === "--max-assets") maxAssets = parseInteger(value, arg, 1, 200);
      continue;
    }
    if (arg.startsWith("-")) fail(`Unknown option: ${arg}`);
    if (target) fail(`Unexpected positional argument: ${arg}`);
    target = arg;
  }

  if (!target) fail("A deployed DropHere URL is required");
  if (!buildDirectory) fail("--dir is required and must point to the scanned local build output");
  return { target, buildDirectory, routes, retries, retryDelayMs, timeoutMs, maxAssets, human, allowLocalhost };
}

function isLocalHostname(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

function validateTarget(input, allowLocalhost) {
  let url;
  try {
    url = new URL(input);
  } catch {
    fail("Target must be an absolute URL");
  }
  if (url.username || url.password) fail("Target URL must not contain credentials");

  const local = isLocalHostname(url.hostname);
  if (local && allowLocalhost) {
    if (url.protocol !== "http:" && url.protocol !== "https:") fail("Local test URL must use HTTP or HTTPS");
    return { url, local: true };
  }

  if (url.protocol !== "https:") fail("DropHere verification requires HTTPS");
  if (!/^[a-z0-9-]+\.drophere\.page$/i.test(url.hostname)) {
    fail("Target must be a drophere.page deployment subdomain");
  }
  return { url, local: false };
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function safePath(url) {
  return url.pathname || "/";
}

async function fetchOnce(url, origin, timeoutMs) {
  let current = new URL(url);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    if (current.origin !== origin) throw new Error("cross-origin-redirect");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "DropHere-Skill-Verifier/0.1" },
      });
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }

    if (response.status >= 300 && response.status < 400 && response.headers.has("location")) {
      let next;
      try {
        next = new URL(response.headers.get("location"), current);
      } finally {
        await response.body?.cancel().catch(() => undefined);
        clearTimeout(timeout);
      }
      if (next.origin !== origin) throw new Error("cross-origin-redirect");
      current = next;
      continue;
    }
    return {
      response,
      finalUrl: current,
      close: () => clearTimeout(timeout),
    };
  }
  throw new Error("too-many-redirects");
}

async function fetchWithRetry(url, origin, options) {
  let lastError;

  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      const result = await fetchOnce(url, origin, options.timeoutMs);
      if (result.response.ok) return { ...result, attempts: attempt + 1 };
      if (result.response.status === 410 || attempt === options.retries) {
        return { ...result, attempts: attempt + 1 };
      }
      try {
        await result.response.body?.cancel();
      } finally {
        result.close();
      }
    } catch (error) {
      lastError = error;
      if (attempt === options.retries) break;
    }
    await sleep(options.retryDelayMs);
  }

  throw lastError ?? new Error("request-failed");
}

function decodeHtmlAttribute(value) {
  return value.replace(/&(amp|quot|apos|#39|#x27);/gi, (_match, entity) => {
    switch (entity.toLowerCase()) {
      case "amp": return "&";
      case "quot": return '"';
      default: return "'";
    }
  });
}

function discoverAssets(html, pageUrl) {
  const assets = new Map();
  const attributePattern = /<(?:script|link|img|source|video|audio|object|embed)\b[^>]*?\b(?:src|href|data)\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = attributePattern.exec(html)) !== null) {
    const raw = decodeHtmlAttribute(match[1].trim());
    if (!raw || raw.startsWith("#")) continue;
    let assetUrl;
    try {
      assetUrl = new URL(raw, pageUrl);
    } catch {
      continue;
    }
    if (assetUrl.protocol !== "http:" && assetUrl.protocol !== "https:") continue;
    assetUrl.hash = "";
    if (assetUrl.origin !== pageUrl.origin) continue;
    if (assetUrl.pathname === pageUrl.pathname && assetUrl.search === pageUrl.search) continue;
    assets.set(assetUrl.href, assetUrl);
  }
  return [...assets.values()].sort((left, right) => left.href.localeCompare(right.href));
}

async function loadLocalBuild(buildDirectory, pageUrl) {
  const directory = path.resolve(buildDirectory);
  const directoryInfo = await lstat(directory).catch(() => null);
  if (!directoryInfo?.isDirectory() || directoryInfo.isSymbolicLink()) {
    throw new Error("--dir must be a real local directory");
  }

  const indexPath = path.join(directory, "index.html");
  const indexInfo = await lstat(indexPath).catch(() => null);
  if (!indexInfo?.isFile() || indexInfo.isSymbolicLink()) {
    throw new Error("--dir must contain a regular index.html file");
  }
  if (indexInfo.size > 5 * 1024 * 1024) throw new Error("Local index.html exceeds 5 MiB");

  const [realDirectory, realIndex] = await Promise.all([realpath(directory), realpath(indexPath)]);
  if (path.dirname(realIndex) !== realDirectory) throw new Error("Local index.html escapes --dir");

  const indexBuffer = await readFile(realIndex);
  const html = indexBuffer.toString("utf8");
  if (indexBuffer.length < 32 || !/<(?:!doctype\s+html|html|body)\b/i.test(html)) {
    throw new Error("Local index.html does not look like a complete HTML document");
  }

  return {
    directory: realDirectory,
    indexBytes: indexBuffer.length,
    assets: discoverAssets(html, pageUrl),
  };
}

async function inspectOpaqueBody(response) {
  const lengthHeader = response.headers.get("content-length");
  const declaredLength = lengthHeader && /^\d+$/.test(lengthHeader) ? Number(lengthHeader) : null;
  const inspected = Buffer.alloc(MAX_REMOTE_BODY_INSPECTION_BYTES);
  let inspectedBytes = 0;

  if (response.body) {
    const reader = response.body.getReader();
    try {
      while (inspectedBytes < MAX_REMOTE_BODY_INSPECTION_BYTES) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (!chunk.value?.byteLength) continue;
        const bytes = Buffer.from(chunk.value.buffer, chunk.value.byteOffset, chunk.value.byteLength);
        const take = Math.min(bytes.length, MAX_REMOTE_BODY_INSPECTION_BYTES - inspectedBytes);
        bytes.copy(inspected, inspectedBytes, 0, take);
        inspectedBytes += take;
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }

  const prefix = inspected.subarray(0, inspectedBytes);
  return {
    bytes: Number.isSafeInteger(declaredLength) ? declaredLength : inspectedBytes,
    inspectedBytes,
    hasBody: inspectedBytes > 0,
    looksLikeHtml: ["<!doctype html", "<html", "<body"].some((marker) => includesAsciiCaseInsensitive(prefix, marker)),
  };
}

function includesAsciiCaseInsensitive(bytes, text) {
  const needle = Buffer.from(text, "ascii");
  if (needle.length > bytes.length) return false;
  for (let start = 0; start <= bytes.length - needle.length; start += 1) {
    let matches = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      const candidate = bytes[start + offset];
      const lowered = candidate >= 65 && candidate <= 90 ? candidate + 32 : candidate;
      if (lowered !== needle[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function checkResource(url, origin, options) {
  let result;
  try {
    result = await fetchWithRetry(url, origin, options);
    const outcome = {
      path: safePath(url),
      status: result.response.status,
      ok: result.response.ok,
      attempts: result.attempts,
    };
    await result.response.body?.cancel();
    return outcome;
  } catch {
    return { path: safePath(url), status: null, ok: false, attempts: options.retries + 1, error: "request-failed" };
  } finally {
    result?.close();
  }
}

function printHuman(result) {
  process.stdout.write(`status: ${result.status}\n`);
  process.stdout.write(`url: ${result.url}\n`);
  process.stdout.write(`homepage: ${result.homepage.status ?? "request-failed"}\n`);
  process.stdout.write(`assets: ${result.assets.passed}/${result.assets.checked}\n`);
  process.stdout.write(`routes: ${result.routes.passed}/${result.routes.checked}\n`);
  for (const failure of result.assets.failures) process.stdout.write(`asset-failed: ${failure.path} (${failure.status ?? "request-failed"})\n`);
  for (const failure of result.routes.failures) process.stdout.write(`route-failed: ${failure.path} (${failure.status ?? "request-failed"})\n`);
  for (const warning of result.warnings) process.stdout.write(`warning: ${warning}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const target = validateTarget(options.target, options.allowLocalhost);
  const targetUrl = target.url;
  targetUrl.hash = "";
  targetUrl.search = "";
  const origin = targetUrl.origin;
  const localBuild = await loadLocalBuild(options.buildDirectory, targetUrl);
  const warnings = [];
  let homepageResult;

  try {
    const fetched = await fetchWithRetry(targetUrl, origin, options);
    try {
      const contentType = fetched.response.headers.get("content-type") ?? "";
      const opaqueBody = await inspectOpaqueBody(fetched.response);
      const drophereSite = fetched.response.headers.get("x-drophere-site");
      const deployment = fetched.response.headers.get("x-drophere-deployment");
      const robots = fetched.response.headers.get("x-robots-tag");
      const expired = fetched.response.headers.get("x-drophere-expired") === "true";
      const isHtml = contentType.toLowerCase().includes("text/html");
      const providerHeadersPresent = target.local || Boolean(drophereSite && deployment);

      homepageResult = {
        ok: fetched.response.ok && isHtml && opaqueBody.hasBody && opaqueBody.looksLikeHtml && providerHeadersPresent,
        status: fetched.response.status,
        contentType,
        bytes: opaqueBody.bytes,
        inspectedBytes: opaqueBody.inspectedBytes,
        looksLikeHtml: opaqueBody.looksLikeHtml,
        attempts: fetched.attempts,
        drophereSite,
        deployment,
        noindex: robots?.toLowerCase().includes("noindex") ?? false,
        expired,
        finalUrl: fetched.finalUrl,
      };

      if (!isHtml) warnings.push("Homepage content type is not text/html.");
      if (!opaqueBody.hasBody) warnings.push("Homepage response body is empty.");
      if (opaqueBody.hasBody && !opaqueBody.looksLikeHtml) warnings.push("Homepage response prefix does not look like HTML.");
      if (!providerHeadersPresent) warnings.push("DropHere provider headers are missing.");
      if (!target.local && targetUrl.hostname.startsWith("drop-") && !homepageResult.noindex) {
        warnings.push("Temporary guest site is missing an expected noindex header.");
      }
      if (expired) warnings.push("Guest deployment has expired.");
    } finally {
      fetched.close();
    }
  } catch {
    homepageResult = {
      ok: false,
      status: null,
      contentType: "",
      bytes: 0,
      inspectedBytes: 0,
      looksLikeHtml: false,
      attempts: options.retries + 1,
      drophereSite: null,
      deployment: null,
      noindex: false,
      expired: false,
      finalUrl: targetUrl,
    };
    warnings.push("Homepage request failed after retries.");
  }

  const discoveredAssets = homepageResult.status && homepageResult.status >= 200 && homepageResult.status < 300
    ? localBuild.assets.map((asset) => new URL(`${asset.pathname}${asset.search}`, homepageResult.finalUrl))
    : [];
  const sampledAssets = discoveredAssets.slice(0, options.maxAssets);
  if (discoveredAssets.length > sampledAssets.length) {
    warnings.push(`Checked ${sampledAssets.length} of ${discoveredAssets.length} discovered same-origin assets.`);
  }
  const assetResults = await mapWithConcurrency(sampledAssets, 6, (asset) => checkResource(asset, origin, options));

  const routeUrls = [];
  for (const route of options.routes) {
    const normalized = route.startsWith("/") ? route : `/${route}`;
    const routeUrl = new URL(normalized, origin);
    routeUrl.search = "";
    routeUrl.hash = "";
    if (!routeUrls.some((existing) => existing.href === routeUrl.href)) routeUrls.push(routeUrl);
  }
  const routeResults = await mapWithConcurrency(routeUrls, 4, (route) => checkResource(route, origin, options));

  const assetFailures = assetResults.filter((result) => !result.ok);
  const routeFailures = routeResults.filter((result) => !result.ok);
  const hasFailure = !homepageResult.ok || assetFailures.length > 0 || routeFailures.length > 0;
  const hasDegradation = discoveredAssets.length > sampledAssets.length || warnings.some((warning) => warning.includes("noindex"));
  const status = hasFailure ? "failed" : hasDegradation ? "degraded" : "verified";

  const result = {
    tool: "drophere-url-verifier",
    status,
    url: targetUrl.href,
    checkedAt: new Date().toISOString(),
    localBuild: {
      directory: localBuild.directory,
      indexBytes: localBuild.indexBytes,
    },
    homepage: {
      ok: homepageResult.ok,
      status: homepageResult.status,
      contentType: homepageResult.contentType,
      bytes: homepageResult.bytes,
      inspectedBytes: homepageResult.inspectedBytes,
      looksLikeHtml: homepageResult.looksLikeHtml,
      attempts: homepageResult.attempts,
      drophereSite: homepageResult.drophereSite,
      deployment: homepageResult.deployment,
      noindex: homepageResult.noindex,
      expired: homepageResult.expired,
    },
    assets: {
      discovered: discoveredAssets.length,
      checked: assetResults.length,
      passed: assetResults.length - assetFailures.length,
      failed: assetFailures.length,
      failures: assetFailures,
    },
    routes: {
      checked: routeResults.length,
      passed: routeResults.length - routeFailures.length,
      failed: routeFailures.length,
      failures: routeFailures,
    },
    warnings,
  };

  if (options.human) printHuman(result);
  else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(status === "verified" ? 0 : status === "degraded" ? 2 : 3);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
