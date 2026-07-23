#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { verifyBundledCli } from "./verify-bundled-cli.mjs";

let runtimeDirectory;
try {
  const verified = await verifyBundledCli();
  runtimeDirectory = await mkdtemp(path.join(tmpdir(), "drophere-skill-cli-"));
  const runtimeCli = path.join(runtimeDirectory, "drophere.js");
  await writeFile(runtimeCli, verified.bundle, { flag: "wx", mode: 0o700 });

  const result = spawnSync(process.execPath, [runtimeCli, ...process.argv.slice(2)], {
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`Bundled CLI stopped by ${result.signal}`);
  process.exitCode = result.status ?? 1;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  if (runtimeDirectory) await rm(runtimeDirectory, { recursive: true, force: true });
}
