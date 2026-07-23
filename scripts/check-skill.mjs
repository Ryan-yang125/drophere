import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = path.join(root, "skills", "drophere");
const skillScripts = [
  "detect-build-output.mjs",
  "run-cli.mjs",
  "scan-sensitive-files.mjs",
  "verify-bundled-cli.mjs",
  "verify-url.mjs",
].map((name) => path.join(skillRoot, "scripts", name));

for (const script of skillScripts) run(process.execPath, ["--check", script]);

const skill = await readFile(path.join(skillRoot, "SKILL.md"), "utf8");
const frontmatter = skill.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
if (!/^name:\s*drophere\s*$/m.test(frontmatter) || !/^description:\s*.+$/m.test(frontmatter)) {
  throw new Error("SKILL.md needs valid drophere name and description frontmatter");
}
if (/curl\s+[^\n]*\|\s*(?:ba)?sh\b|install\.sh/i.test(skill)) {
  throw new Error("SKILL.md must use the bundled CLI without a runtime shell installer");
}

const bundledCli = path.join(skillRoot, "bin", "drophere.js");
const builtCli = path.join(root, "packages", "cli", "dist", "drophere.js");
const [bundledBytes, builtBytes, checksumText] = await Promise.all([
  readFile(bundledCli),
  readFile(builtCli),
  readFile(path.join(skillRoot, "bin", "drophere.js.sha256"), "utf8"),
]);
if (!bundledBytes.equals(builtBytes)) throw new Error("Bundled Skill CLI differs from the fresh public CLI build");
const expectedChecksum = checksumText.match(/^([a-f0-9]{64})\s+drophere\.js\s*$/i)?.[1]?.toLowerCase();
const actualChecksum = createHash("sha256").update(bundledBytes).digest("hex");
if (expectedChecksum !== actualChecksum) throw new Error("Bundled Skill CLI checksum does not match");
run(process.execPath, [skillScripts[3]]);
const bundledVersion = run(process.execPath, [skillScripts[1], "--version"]).trim();
const cliPackage = JSON.parse(await readFile(path.join(root, "packages", "cli", "package.json"), "utf8"));
if (bundledVersion !== cliPackage.version) throw new Error(`Unexpected bundled CLI version: ${bundledVersion}`);

const tamperFixture = await mkdtemp(path.join(tmpdir(), "drophere-cli-tamper-"));
try {
  const tamperScripts = path.join(tamperFixture, "scripts");
  const tamperBin = path.join(tamperFixture, "bin");
  await Promise.all([mkdir(tamperScripts), mkdir(tamperBin)]);
  await Promise.all([
    cp(path.join(skillRoot, "scripts", "run-cli.mjs"), path.join(tamperScripts, "run-cli.mjs")),
    cp(path.join(skillRoot, "scripts", "verify-bundled-cli.mjs"), path.join(tamperScripts, "verify-bundled-cli.mjs")),
    cp(path.join(skillRoot, "bin", "drophere.js.sha256"), path.join(tamperBin, "drophere.js.sha256")),
  ]);
  const tamperedBytes = Buffer.from(bundledBytes);
  tamperedBytes[tamperedBytes.length - 1] ^= 1;
  await writeFile(path.join(tamperBin, "drophere.js"), tamperedBytes);
  const tamperedRun = spawnSync(process.execPath, [path.join(tamperScripts, "run-cli.mjs"), "--version"], {
    cwd: tamperFixture,
    encoding: "utf8",
  });
  if (tamperedRun.status === 0 || !tamperedRun.stderr.includes("checksum mismatch")) {
    throw new Error("Bundled CLI runner did not block a tampered executable");
  }
} finally {
  await rm(tamperFixture, { recursive: true, force: true });
}

const evals = JSON.parse(await readFile(path.join(skillRoot, "evals", "evals.json"), "utf8"));
if (evals.skill_name !== "drophere" || !Array.isArray(evals.evals) || evals.evals.length < 4) {
  throw new Error("evals/evals.json needs at least four drophere scenarios");
}
for (const evaluation of evals.evals) {
  if (!Number.isInteger(evaluation.id) || !evaluation.prompt || !evaluation.expected_output || !Array.isArray(evaluation.assertions) || evaluation.assertions.length === 0) {
    throw new Error(`Invalid Skill evaluation: ${JSON.stringify(evaluation.id)}`);
  }
}

const example = path.join(root, "examples", "hello-site");
const detected = run(process.execPath, [skillScripts[0], example, "--human"]);
if (!detected.includes("status: ready")) throw new Error("hello-site detector smoke did not report ready");
const scanned = run(process.execPath, [skillScripts[2], example, "--human"]);
if (!scanned.includes("status: clear")) throw new Error("hello-site scanner smoke did not report clear");

const verifierRequests = [];
const verifierFixture = await mkdtemp(path.join(tmpdir(), "drophere-verifier-"));
await writeFile(path.join(verifierFixture, "index.html"), "<!doctype html><html><head><link rel=\"stylesheet\" href=\"/style.css\"></head><body><img src=\"vbscript:msgbox(1)\"><img src=\"&amp;quot;/trap&quot;\"></body></html>");
const server = createServer((request, response) => {
  verifierRequests.push(request.url);
  if (request.url === "/invalid") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("x");
    return;
  }
  if (request.url === "/slow") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.flushHeaders();
    const delayedBody = setTimeout(() => response.end("<!doctype html><html><body>late</body></html>"), 1500);
    response.once("close", () => clearTimeout(delayedBody));
    return;
  }
  if (request.url === "/style.css") {
    response.writeHead(200, { "content-type": "text/css" });
    response.end("body { color: #111; }");
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end("<!doctype html><html><body><script src=\"/remote-only.js\"></script><main>Untrusted remote fixture</main></body></html>");
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

try {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not resolve local verifier fixture address");
  const verifiedOutput = await runAsync(process.execPath, [
    skillScripts[4],
    `http://127.0.0.1:${address.port}`,
    "--dir", verifierFixture,
    "--allow-localhost",
    "--retries", "0",
  ]);
  const verified = JSON.parse(verifiedOutput);
  if (verified.status !== "verified" || verified.assets.checked !== 2 || verified.assets.passed !== 2) {
    throw new Error("local URL verifier smoke did not verify homepage and local-build assets");
  }
  if (verifiedOutput.includes("Untrusted remote fixture") || verifiedOutput.includes("remote-only.js")) {
    throw new Error("local URL verifier exposed untrusted remote HTML in its output");
  }
  if (verifierRequests.includes("/%22/trap%22") || !verifierRequests.includes("/&quot;/trap%22")) {
    throw new Error(`local URL verifier decoded an HTML entity more than once: ${JSON.stringify(verifierRequests)}`);
  }
  if (verifierRequests.includes("/remote-only.js")) {
    throw new Error("local URL verifier followed an asset reference from untrusted remote HTML");
  }

  const invalid = await runAsyncResult(process.execPath, [
    skillScripts[4],
    `http://127.0.0.1:${address.port}/invalid`,
    "--dir", verifierFixture,
    "--allow-localhost",
    "--retries", "0",
  ]);
  const invalidOutput = JSON.parse(invalid.stdout);
  if (invalid.code !== 3 || invalidOutput.status !== "failed" || invalidOutput.homepage.looksLikeHtml !== false) {
    throw new Error("local URL verifier accepted a non-HTML response body");
  }

  const slowStartedAt = Date.now();
  const slow = await runAsyncResult(process.execPath, [
    skillScripts[4],
    `http://127.0.0.1:${address.port}/slow`,
    "--dir", verifierFixture,
    "--allow-localhost",
    "--retries", "0",
    "--timeout-ms", "250",
  ]);
  const slowElapsedMs = Date.now() - slowStartedAt;
  if (slow.code !== 3 || slowElapsedMs >= 1000) {
    throw new Error(`local URL verifier did not enforce the body-read timeout: ${slowElapsedMs}ms`);
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(verifierFixture, { recursive: true, force: true });
}

process.stdout.write(`DropHere Skill check passed (${evals.evals.length} evals).\n`);

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed\n${result.stderr || result.stdout}`);
  return result.stdout;
}

async function runAsync(command, args) {
  const result = await runAsyncResult(command, args);
  if (result.code === 0) return result.stdout;
  throw new Error(`${command} ${args.join(" ")} failed\n${result.stderr || result.stdout}`);
}

function runAsyncResult(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}
