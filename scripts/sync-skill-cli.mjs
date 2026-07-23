import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(repoRoot, "packages", "cli", "dist", "drophere.js");
const destinationDirectory = path.join(repoRoot, "skills", "drophere", "bin");
const destination = path.join(destinationDirectory, "drophere.js");
const checksumFile = path.join(destinationDirectory, "drophere.js.sha256");

await mkdir(destinationDirectory, { recursive: true });
const [sourceInfo, destinationInfo] = await Promise.all([lstat(source), lstat(destinationDirectory)]);
if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) throw new Error("CLI build output must be a regular file");
if (sourceInfo.size < 1024 || sourceInfo.size > 1024 * 1024) throw new Error("CLI build output has an unexpected size");
if (!destinationInfo.isDirectory() || destinationInfo.isSymbolicLink()) throw new Error("Skill bin target must be a real directory");

const bundle = await readFile(source);
if (!bundle.subarray(0, 20).toString("utf8").startsWith("#!/usr/bin/env node")) {
  throw new Error("CLI build output is missing the Node.js shebang");
}
const checksum = createHash("sha256").update(bundle).digest("hex");
const temporaryDirectory = await mkdtemp(path.join(destinationDirectory, ".drophere-sync-"));
const temporaryBundle = path.join(temporaryDirectory, "drophere.js");
const temporaryChecksum = path.join(temporaryDirectory, "drophere.js.sha256");

try {
  await writeFile(temporaryBundle, bundle, { flag: "wx", mode: 0o700 });
  await chmod(temporaryBundle, 0o755);
  await writeFile(temporaryChecksum, `${checksum}  drophere.js\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  await rename(temporaryBundle, destination);
  await rename(temporaryChecksum, checksumFile);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

process.stdout.write(`Bundled DropHere CLI for the Skill: ${checksum}\n`);
