#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";

const IGNORED_NAMES = new Set([".git", ".DS_Store", ".drophere.local.json", "node_modules"]);

function printHelp() {
  process.stdout.write(`Usage: node detect-build-output.mjs [project-directory] [options]

Detect a browser-ready static build directory for DropHere.

Options:
  --output <path>  Check one explicit output beneath the project directory
  --human          Print a concise human-readable result instead of JSON
  --help           Show this help

Exit codes:
  0  A deployable output with index.html is ready
  2  A build is required or no deployable output was found
  1  Invalid arguments or an inspection failure
`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  let project = ".";
  let projectSet = false;
  let output;
  let human = false;

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
    if (arg === "--output") {
      output = argv[index + 1];
      if (!output) fail("Missing value for --output");
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) fail(`Unknown option: ${arg}`);
    if (projectSet) fail(`Unexpected positional argument: ${arg}`);
    project = arg;
    projectSet = true;
  }

  return { project, output, human };
}

async function exists(filePath) {
  return fs.access(filePath).then(() => true, () => false);
}

async function readPackageJson(root, warnings) {
  const packagePath = path.join(root, "package.json");
  if (!(await exists(packagePath))) return null;
  try {
    return JSON.parse(await fs.readFile(packagePath, "utf8"));
  } catch (error) {
    warnings.push(`Could not parse package.json: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function detectFramework(root, packageJson) {
  const dependencies = {
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {}),
  };

  if (dependencies.next) return "next";
  if (dependencies.nuxt) return "nuxt";
  if (dependencies["@sveltejs/kit"]) return "sveltekit";
  if (dependencies.astro) return "astro";
  if (dependencies["react-scripts"]) return "create-react-app";
  if (dependencies.gatsby) return "gatsby";
  if (dependencies["@docusaurus/core"]) return "docusaurus";
  if (dependencies["@11ty/eleventy"]) return "eleventy";
  if (dependencies.vite) return "vite";
  if (await exists(path.join(root, "hugo.toml")) || await exists(path.join(root, "hugo.yaml"))) return "hugo";
  if (await exists(path.join(root, "mkdocs.yml")) || await exists(path.join(root, "mkdocs.yaml"))) return "mkdocs";
  if (await exists(path.join(root, "_config.yml")) || await exists(path.join(root, "_config.yaml"))) return "jekyll";
  if (await exists(path.join(root, "index.html")) && !packageJson?.scripts?.build) return "static-html";
  if (packageJson) return "node-static";
  return "unknown";
}

async function detectPackageManager(root) {
  let repositoryRoot = root;
  let boundaryCursor = root;
  while (true) {
    if (await exists(path.join(boundaryCursor, ".git"))) {
      repositoryRoot = boundaryCursor;
      break;
    }
    const parent = path.dirname(boundaryCursor);
    if (parent === boundaryCursor) break;
    boundaryCursor = parent;
  }

  let current = root;
  while (true) {
    const lockfiles = [
      ["pnpm-lock.yaml", "pnpm"],
      ["yarn.lock", "yarn"],
      ["bun.lock", "bun"],
      ["bun.lockb", "bun"],
      ["package-lock.json", "npm"],
    ];
    for (const [filename, manager] of lockfiles) {
      const lockfile = path.join(current, filename);
      if (await exists(lockfile)) return { name: manager, lockfile };
    }

    const parent = path.dirname(current);
    if (current === repositoryRoot || parent === current) break;
    current = parent;
  }
  return { name: "npm", lockfile: null };
}

function buildCommandFor(framework, packageJson, packageManager) {
  if (packageJson?.scripts?.build) {
    if (packageManager === "pnpm" || packageManager === "yarn") return `${packageManager} build`;
    if (packageManager === "bun") return "bun run build";
    return "npm run build";
  }
  if (framework === "hugo") return "hugo";
  if (framework === "mkdocs") return "mkdocs build";
  if (framework === "jekyll") return "bundle exec jekyll build";
  return null;
}

function outputRulesFor(framework, hasBuildScript) {
  const frameworkRules = {
    next: ["out"],
    nuxt: [".output/public", "dist"],
    sveltekit: ["build"],
    astro: ["dist"],
    "create-react-app": ["build"],
    gatsby: ["public"],
    docusaurus: ["build"],
    eleventy: ["_site"],
    vite: ["dist"],
    hugo: ["public"],
    mkdocs: ["site"],
    jekyll: ["_site"],
    "static-html": ["."],
    "node-static": ["dist", "build", "out"],
    unknown: [".", "dist", "build", "out", "_site", "site"],
  };
  const rules = [...(frameworkRules[framework] ?? [])];
  if (hasBuildScript) {
    for (const candidate of ["dist", "build", "out"]) {
      if (!rules.includes(candidate)) rules.push(candidate);
    }
  }
  return rules;
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

async function summarizeDirectory(directory) {
  let fileCount = 0;
  let totalBytes = 0;
  let newestMtimeMs = 0;

  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORED_NAMES.has(entry.name)) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = await fs.stat(fullPath);
      fileCount += 1;
      totalBytes += stat.size;
      newestMtimeMs = Math.max(newestMtimeMs, stat.mtimeMs);
    }
  }

  await walk(directory);
  return {
    fileCount,
    totalBytes,
    newestModifiedAt: newestMtimeMs ? new Date(newestMtimeMs).toISOString() : null,
  };
}

async function newestSourceModification(root, outputRules) {
  const excludedNames = new Set([...IGNORED_NAMES, ".cache", ".wrangler", "coverage"]);
  const excludedPaths = [...new Set(outputRules
    .map((rule) => path.resolve(root, rule))
    .filter((candidate) => candidate !== root && isWithin(root, candidate))
    .map((candidate) => path.join(root, path.relative(root, candidate).split(path.sep)[0])))];
  let newestMtimeMs = 0;

  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (excludedNames.has(entry.name)) continue;
      const fullPath = path.join(current, entry.name);
      if (excludedPaths.some((excluded) => fullPath === excluded || isWithin(excluded, fullPath))) continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = await fs.stat(fullPath);
      newestMtimeMs = Math.max(newestMtimeMs, stat.mtimeMs);
    }
  }

  await walk(root);
  return newestMtimeMs;
}

async function inspectCandidate(root, relativePath, warnings) {
  const absolutePath = path.resolve(root, relativePath);
  if (!isWithin(root, absolutePath)) {
    warnings.push(`Skipped output outside project directory: ${relativePath}`);
    return null;
  }

  const lstat = await fs.lstat(absolutePath).catch(() => null);
  if (lstat?.isSymbolicLink()) {
    warnings.push(`Skipped symbolic-link output: ${relativePath}`);
    return null;
  }
  if (!lstat?.isDirectory()) return null;

  const realPath = await fs.realpath(absolutePath);
  if (!isWithin(root, realPath)) {
    warnings.push(`Skipped output resolving outside project directory: ${relativePath}`);
    return null;
  }

  const entrypoint = path.join(realPath, "index.html");
  const entrypointStat = await fs.lstat(entrypoint).catch(() => null);
  if (!entrypointStat?.isFile() || entrypointStat.isSymbolicLink()) return null;

  return {
    path: realPath,
    relativePath: path.relative(root, realPath) || ".",
    entrypoint: "index.html",
    ...(await summarizeDirectory(realPath)),
  };
}

function printHuman(result) {
  process.stdout.write(`status: ${result.status}\n`);
  process.stdout.write(`framework: ${result.framework}\n`);
  process.stdout.write(`project: ${result.projectRoot}\n`);
  if (result.buildCommand) process.stdout.write(`build: ${result.buildCommand}\n`);
  if (result.recommendedOutput) process.stdout.write(`output: ${result.recommendedOutput}\n`);
  for (const warning of result.warnings) process.stdout.write(`warning: ${warning}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const requestedRoot = path.resolve(options.project);
  const rootStat = await fs.stat(requestedRoot).catch(() => null);
  if (!rootStat?.isDirectory()) fail(`Project directory does not exist: ${requestedRoot}`);
  const root = await fs.realpath(requestedRoot);
  const warnings = [];
  const packageJson = await readPackageJson(root, warnings);
  const packageManager = await detectPackageManager(root);
  const framework = await detectFramework(root, packageJson);
  const buildCommand = buildCommandFor(framework, packageJson, packageManager.name);
  const rules = options.output ? [options.output] : outputRulesFor(framework, Boolean(packageJson?.scripts?.build));
  const candidates = [];

  for (const rule of [...new Set(rules)]) {
    const candidate = await inspectCandidate(root, rule, warnings);
    if (candidate) candidates.push(candidate);
  }

  if (framework === "next" && await exists(path.join(root, ".next")) && candidates.length === 0) {
    warnings.push("Found .next server output. Configure a static export and deploy out/.");
  }
  if (framework === "next") {
    const apiDirectories = ["pages/api", "src/pages/api", "app/api", "src/app/api"];
    const presentApiDirectories = [];
    for (const apiDirectory of apiDirectories) {
      if (await exists(path.join(root, apiDirectory))) presentApiDirectories.push(apiDirectory);
    }
    if (presentApiDirectories.length > 0) {
      warnings.push(`Found Next.js API routes (${presentApiDirectories.join(", ")}); DropHere serves only the static export.`);
    }
  }
  if (framework === "nuxt" && await exists(path.join(root, ".output/server")) && candidates.length === 0) {
    warnings.push("Found Nuxt server output without a public static entrypoint.");
  }
  if (candidates.length > 1) {
    warnings.push(`Multiple static outputs found; selected ${candidates[0].relativePath} using framework priority.`);
  }

  const newestSourceMtimeMs = candidates.length > 0 && candidates[0].path !== root
    ? await newestSourceModification(root, rules)
    : 0;
  const recommendedOutputMtimeMs = candidates[0]?.newestModifiedAt ? Date.parse(candidates[0].newestModifiedAt) : 0;
  const outputStale = newestSourceMtimeMs > recommendedOutputMtimeMs + 1_000;
  if (outputStale) {
    warnings.push("Project source or configuration is newer than the selected build output. Run a fresh build before scanning or deployment.");
  }

  let status;
  if (candidates.length > 0 && !outputStale) status = "ready";
  else if (candidates.length > 0) status = "needs-build";
  else if (buildCommand) status = "needs-build";
  else status = "not-found";

  if (options.output && candidates.length === 0) {
    warnings.push(`Explicit output is missing a regular top-level index.html: ${options.output}`);
    status = "not-found";
  }

  const result = {
    tool: "drophere-build-output-detector",
    status,
    projectRoot: root,
    framework,
    packageManager: packageJson ? packageManager.name : null,
    lockfile: packageJson ? packageManager.lockfile : null,
    buildCommand,
    recommendedOutput: candidates[0]?.path ?? null,
    entrypoint: candidates[0]?.entrypoint ?? null,
    newestSourceModifiedAt: newestSourceMtimeMs ? new Date(newestSourceMtimeMs).toISOString() : null,
    outputStale,
    candidates,
    warnings,
  };

  if (options.human) printHuman(result);
  else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(status === "ready" ? 0 : 2);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
