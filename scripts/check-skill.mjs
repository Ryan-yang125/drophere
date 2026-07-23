import { spawn, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = path.join(root, "skills", "drophere");
const skillScripts = [
  "detect-build-output.mjs",
  "scan-sensitive-files.mjs",
  "verify-url.mjs",
].map((name) => path.join(skillRoot, "scripts", name));

for (const script of skillScripts) run(process.execPath, ["--check", script]);

const skill = await readFile(path.join(skillRoot, "SKILL.md"), "utf8");
const frontmatter = skill.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
if (!/^name:\s*drophere\s*$/m.test(frontmatter) || !/^description:\s*.+$/m.test(frontmatter)) {
  throw new Error("SKILL.md needs valid drophere name and description frontmatter");
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
const scanned = run(process.execPath, [skillScripts[1], example, "--human"]);
if (!scanned.includes("status: clear")) throw new Error("hello-site scanner smoke did not report clear");

const verifierRequests = [];
const server = createServer((request, response) => {
  verifierRequests.push(request.url);
  if (request.url === "/style.css") {
    response.writeHead(200, { "content-type": "text/css" });
    response.end("body { color: #111; }");
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end("<!doctype html><html><head><link rel=\"stylesheet\" href=\"/style.css\"></head><body><main>DropHere Skill fixture</main><img src=\"vbscript:msgbox(1)\"><img src=\"&amp;quot;/trap&quot;\"></body></html>");
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

try {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not resolve local verifier fixture address");
  const verified = await runAsync(process.execPath, [
    skillScripts[2],
    `http://127.0.0.1:${address.port}`,
    "--allow-localhost",
    "--retries", "0",
    "--human",
  ]);
  if (!verified.includes("status: verified") || !verified.includes("assets: 2/2")) {
    throw new Error("local URL verifier smoke did not verify homepage and asset");
  }
  if (verifierRequests.includes("/%22/trap%22") || !verifierRequests.includes("/&quot;/trap%22")) {
    throw new Error(`local URL verifier decoded an HTML entity more than once: ${JSON.stringify(verifierRequests)}`);
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}

process.stdout.write(`DropHere Skill check passed (${evals.evals.length} evals).\n`);

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed\n${result.stderr || result.stdout}`);
  return result.stdout;
}

function runAsync(command, args) {
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
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} ${args.join(" ")} failed\n${stderr || stdout}`));
    });
  });
}
