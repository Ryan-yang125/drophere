#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(skillRoot, "bin", "drophere.js");
const checksumPath = path.join(skillRoot, "bin", "drophere.js.sha256");

export async function verifyBundledCli() {
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (!Number.isInteger(nodeMajor) || nodeMajor < 18) throw new Error("Bundled DropHere CLI requires Node.js 18 or newer");

  const [bundleInfo, checksumInfo, bundle, checksumText] = await Promise.all([
    lstat(cliPath),
    lstat(checksumPath),
    readFile(cliPath),
    readFile(checksumPath, "utf8"),
  ]);
  if (!bundleInfo.isFile() || bundleInfo.isSymbolicLink()) throw new Error("Bundled CLI must be a regular file");
  if (!checksumInfo.isFile() || checksumInfo.isSymbolicLink()) throw new Error("Bundled CLI checksum must be a regular file");
  if (bundleInfo.size < 1024 || bundleInfo.size > 1024 * 1024) throw new Error("Bundled CLI has an unexpected size");
  if (!bundle.subarray(0, 20).toString("utf8").startsWith("#!/usr/bin/env node")) {
    throw new Error("Bundled CLI is missing the Node.js shebang");
  }
  const expected = checksumText.match(/^([a-f0-9]{64})\s+drophere\.js\s*$/i)?.[1]?.toLowerCase();
  if (!expected) throw new Error("Bundled CLI checksum file is invalid");

  const actual = createHash("sha256").update(bundle).digest("hex");
  if (actual !== expected) throw new Error("Bundled CLI checksum mismatch");

  return {
    tool: "drophere-bundled-cli-verifier",
    status: "verified",
    sha256: actual,
    bundle,
  };
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    const result = await verifyBundledCli();
    process.stdout.write(`${JSON.stringify({
      tool: result.tool,
      status: result.status,
      sha256: result.sha256,
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
