import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseCommonArgs, parsePublishArgs } from "../src/args";
import { normalizeApiEndpoint, resolveRuntimeConfig } from "../src/config";
import { siteFromDomain } from "../src/domain";
import { collectFiles, contentTypeFor, isSensitivePath, shouldIgnore } from "../src/files";
import { formatApiError, formatRows } from "../src/format";
import { doctor, publish } from "../src/commands";
import { printHelp } from "../src/help";
import { main } from "../src/main";

test("parses publish and common args", () => {
  expect(parsePublishArgs(["./dist", "demo.drophere.page"])).toMatchObject({
    project: "./dist",
    domain: "demo.drophere.page",
    entrypoint: "index.html"
  });
  expect(parseCommonArgs(["--endpoint", "http://127.0.0.1:8787", "--token", "tok", "demo"])).toMatchObject({
    api: "http://127.0.0.1:8787",
    token: "tok",
    positionals: ["demo"]
  });
  expect(parseCommonArgs(["login", "--email", "user@example.com", "--password-stdin"])).toMatchObject({
    email: "user@example.com",
    passwordStdin: true
  });
});

test("binds stored credentials to their configured API origin", () => {
  const options = parseCommonArgs(["--endpoint", "https://attacker.example"]);
  const stored = { api: "https://api.drophere.page", token: "user_secret", anonymousToken: "guest_secret", email: "user@example.com" };

  expect(resolveRuntimeConfig(options, stored, { allowMissingToken: true, allowAnonymousToken: true }, {})).toMatchObject({
    api: "https://attacker.example",
    token: undefined,
    tokenKind: undefined
  });
  expect(resolveRuntimeConfig(
    parseCommonArgs(["--endpoint", "https://attacker.example", "--token", "explicit_token"]),
    stored,
    {},
    {}
  )).toMatchObject({ api: "https://attacker.example", token: "explicit_token", tokenKind: "user" });

  const mixedOrigins = {
    api: "https://other.example",
    token: "official_user_token",
    tokenApi: "https://api.drophere.page",
    anonymousToken: "other_guest_token",
    anonymousTokenApi: "https://other.example"
  };
  expect(resolveRuntimeConfig(parseCommonArgs([]), mixedOrigins, { allowMissingToken: true }, {})).toMatchObject({
    api: "https://other.example",
    token: undefined
  });
  expect(resolveRuntimeConfig(parseCommonArgs([]), mixedOrigins, { allowAnonymousToken: true }, {})).toMatchObject({
    api: "https://other.example",
    token: "other_guest_token",
    tokenKind: "anonymous"
  });
});

test("accepts secure API origins and local development HTTP only", () => {
  expect(normalizeApiEndpoint("https://api.drophere.page/")).toBe("https://api.drophere.page");
  expect(normalizeApiEndpoint("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
  expect(() => normalizeApiEndpoint("http://attacker.example")).toThrow("must use HTTPS");
  expect(() => normalizeApiEndpoint("https://api.drophere.page/v1")).toThrow("must be an origin");
});

test("normalizes DropHere subdomains", () => {
  expect(siteFromDomain("https://demo.drophere.page/")).toBe("demo");
  expect(siteFromDomain("demo")).toBe("demo");
  expect(() => siteFromDomain("example.com")).toThrow("Use a drophere.page subdomain");
});

test("collects deployable files", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "drophere-cli-"));
  await writeFile(path.join(dir, "index.html"), "<h1>Hello</h1>");
  await writeFile(path.join(dir, ".DS_Store"), "ignored");

  const files = await collectFiles(dir);
  expect(files).toHaveLength(1);
  expect(files[0]).toMatchObject({
    path: "index.html",
    contentType: "text/html; charset=utf-8"
  });
  expect(shouldIgnore("node_modules")).toBe(true);
  expect(contentTypeFor("app.wasm")).toBe("application/wasm");
});

test("refuses sensitive files while allowing public environment templates", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "drophere-sensitive-"));
  await writeFile(path.join(dir, "index.html"), "<h1>Safe</h1>");
  await writeFile(path.join(dir, ".env.example"), "PUBLIC_API_URL=https://example.test");
  await writeFile(path.join(dir, ".env.production"), "SECRET_TOKEN=do-not-upload");

  await expect(collectFiles(dir)).rejects.toThrow("Refusing to deploy sensitive path: .env.production");
  expect(isSensitivePath(".env.example")).toBe(false);
  expect(isSensitivePath("nested/private.key")).toBe(true);
  expect(isSensitivePath(".ssh", true)).toBe(true);
});

test("formats quota errors and rows", () => {
  const error = formatApiError("Request failed", 429, {
    error: "deploy_rate_limited",
    message: "Wait",
    quota: { deploysTodayRemaining: 0, storageBytesRemaining: 2048 },
    contact: { xiaohongshu: "krishimtech" },
    retryAfterSeconds: 60
  });
  expect(error).toContain("deploys today: 0");
  expect(error).toContain("storage: 2.00 KB");
  expect(error).toContain("contact: Xiaohongshu krishimtech");

  const guidance = formatApiError("Request failed", 429, {
    error: "quota_exceeded",
    guidance: { usageUrl: "https://drophere.page/usage" }
  });
  expect(guidance).toContain("usage: https://drophere.page/usage");

  expect(formatRows([{ domain: "demo.drophere.page", version: 1 }], [["domain", "domain"], ["version", "version"]]))
    .toContain("demo.drophere.page");
});

test("help shows shipped agent commands", () => {
  const writes: string[] = [];
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
    writes.push(String(chunk));
    return true;
  });

  printHelp();
  const output = writes.join("");
  expect(output).toContain("drophere guest <path>");
  expect(output).toContain("drophere claim <domain>");
  expect(output).toContain("drophere <path> <domain>");
  expect(output).toContain("drophere doctor [path]");
  expect(output).toContain("drophere rename <current-domain> <new-domain>");
  expect(output.includes("rollfore")).toBe(false);
  expect(output.includes("NS SERVERS")).toBe(false);

  stdout.mockRestore();
});

test("prints the formal release version", async () => {
  const writes: string[] = [];
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
    writes.push(String(chunk));
    return true;
  });

  await main(["--version"]);

  expect(writes.join("")).toBe("1.0.0\n");
  stdout.mockRestore();
});

test("doctor checks service auth and deployable project", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "drophere-doctor-"));
  await writeFile(path.join(dir, "index.html"), "<h1>Doctor</h1>");
  const fetchMock = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, service: "drophere" }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      user: { email: "user@example.com", role: "user" },
    }), { status: 200 }));
  const writes: string[] = [];
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
    writes.push(String(chunk));
    return true;
  });

  await doctor([dir, "--endpoint", "https://api.test", "--token", "user_tok"]);

  const output = writes.join("");
  expect(output).toContain("DropHere doctor");
  expect(output).toContain("version:  1.0.0");
  expect(output).toContain("service:  ok");
  expect(output).toContain("auth:     user user@example.com");
  expect(output).toContain("status:   deployable");
  expect(output).toContain("next:     ready to deploy");
  expect(fetchMock).toHaveBeenNthCalledWith(1, "https://api.test/health", expect.objectContaining({ method: "GET" }));
  expect(fetchMock).toHaveBeenNthCalledWith(2, "https://api.test/v1/me", expect.objectContaining({
    method: "GET",
    headers: expect.objectContaining({ authorization: "Bearer user_tok" }),
  }));

  stdout.mockRestore();
  fetchMock.mockRestore();
});

test("publish sends deployment payload", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "drophere-publish-"));
  await writeFile(path.join(dir, "index.html"), "<h1>Publish</h1>");
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
    ok: true,
    url: "https://demo.drophere.page/"
  }), { status: 201 }));

  const writes: string[] = [];
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
    writes.push(String(chunk));
    return true;
  });

  await publish([dir, "demo.drophere.page", "--endpoint", "https://api.test", "--token", "tok"]);

  expect(fetchMock).toHaveBeenCalledWith("https://api.test/v1/deploy", expect.objectContaining({
    method: "POST"
  }));
  const request = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
  expect(request.site).toBe("demo");
  expect(request.files[0].path).toBe("index.html");
  expect(writes.join("")).toContain("Success! - Published to https://demo.drophere.page/");

  stdout.mockRestore();
  fetchMock.mockRestore();
});

test("login writes user config under HOME", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "drophere-home-"));
  vi.resetModules();
  vi.stubEnv("HOME", home);
  const { login } = await import("../src/commands");
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
    ok: true,
    token: "tok_login",
    created: true,
    user: { email: "user@example.com" }
  }), { status: 200 }));
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

  await login(["--email", "user@example.com", "--password", "LongPassword123", "--endpoint", "https://api.test"]);

  const config = JSON.parse(await readFile(path.join(home, ".config/drophere/config.json"), "utf8"));
  expect(config).toMatchObject({ api: "https://api.test", token: "tok_login", email: "user@example.com" });

  stdout.mockRestore();
  fetchMock.mockRestore();
  vi.unstubAllEnvs();
});

test("guest deploy creates anonymous session and prints claim guidance", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "drophere-guest-home-"));
  const dir = await mkdtemp(path.join(os.tmpdir(), "drophere-guest-"));
  await writeFile(path.join(dir, "index.html"), "<h1>Guest</h1>");
  vi.resetModules();
  vi.stubEnv("HOME", home);
  const { guest } = await import("../src/commands");
  const fetchMock = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      token: "anon_tok",
      session: { id: "anon_1", expiresAt: "2026-01-01T00:00:00.000Z" },
      limits: {}
    }), { status: 201 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      site: "drop-a1b2c3d4",
      url: "https://drop-a1b2c3d4.drophere.page/",
      expiresAt: "2026-01-03T00:00:00.000Z",
      temporary: true,
      anonymous: true,
      claimable: true
    }), { status: 201 }));
  const writes: string[] = [];
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
    writes.push(String(chunk));
    return true;
  });

  await guest([dir, "--endpoint", "https://api.test"]);

  expect(fetchMock).toHaveBeenNthCalledWith(1, "https://api.test/v1/auth/anonymous", expect.objectContaining({ method: "POST" }));
  expect(fetchMock).toHaveBeenNthCalledWith(2, "https://api.test/v1/deploy", expect.objectContaining({ method: "POST" }));
  const request = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string);
  expect(request.site).toBeUndefined();
  expect(request.files[0].path).toBe("index.html");
  expect(writes.join("")).toContain("mode:    guest temporary deploy");
  expect(writes.join("")).toContain("drophere claim drop-a1b2c3d4.drophere.page");

  const config = JSON.parse(await readFile(path.join(home, ".config/drophere/config.json"), "utf8"));
  expect(config).toMatchObject({
    api: "https://api.test",
    anonymousToken: "anon_tok",
    anonymousSessionExpiresAt: "2026-01-01T00:00:00.000Z",
    lastAnonymousSite: "drop-a1b2c3d4"
  });

  stdout.mockRestore();
  fetchMock.mockRestore();
  vi.unstubAllEnvs();
});

test("guest deploy rejects custom domains", async () => {
  vi.resetModules();
  const { guest } = await import("../src/commands");
  await expect(guest(["./dist", "demo.drophere.page"])).rejects.toThrow("Guest deploys use random temporary domains");
});

test("login preserves anonymous config fields", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "drophere-login-preserve-"));
  const configPath = path.join(home, ".config/drophere/config.json");
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify({
    anonymousToken: "anon_tok",
    anonymousSessionExpiresAt: "2026-01-01T00:00:00.000Z",
    lastAnonymousSite: "drop-a1b2c3d4"
  }));
  vi.resetModules();
  vi.stubEnv("HOME", home);
  const { login } = await import("../src/commands");
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
    ok: true,
    token: "user_tok",
    created: false,
    user: { email: "user@example.com" }
  }), { status: 200 }));
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

  await login(["--email", "user@example.com", "--password", "LongPassword123", "--endpoint", "https://api.test"]);

  const config = JSON.parse(await readFile(configPath, "utf8"));
  expect(config).toMatchObject({
    api: "https://api.test",
    token: "user_tok",
    email: "user@example.com",
    anonymousToken: "anon_tok",
    lastAnonymousSite: "drop-a1b2c3d4"
  });

  stdout.mockRestore();
  fetchMock.mockRestore();
  vi.unstubAllEnvs();
});

test("claim sends user token with anonymous token body", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "drophere-claim-"));
  const configPath = path.join(home, ".config/drophere/config.json");
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify({
    api: "https://api.test",
    token: "user_tok",
    email: "user@example.com",
    anonymousToken: "anon_tok"
  }));
  vi.resetModules();
  vi.stubEnv("HOME", home);
  const { claim } = await import("../src/commands");
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
    ok: true,
    site: "drop-a1b2c3d4",
    url: "https://drop-a1b2c3d4.drophere.page/",
    claimed: true,
    owner: { email: "user@example.com" }
  }), { status: 200 }));
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

  await claim(["drop-a1b2c3d4.drophere.page"]);

  expect(fetchMock).toHaveBeenCalledWith("https://api.test/v1/projects/drop-a1b2c3d4/claim", expect.objectContaining({
    method: "POST",
    headers: expect.objectContaining({ authorization: "Bearer user_tok" })
  }));
  const request = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
  expect(request).toEqual({ anonymousToken: "anon_tok" });

  stdout.mockRestore();
  fetchMock.mockRestore();
  vi.unstubAllEnvs();
});

test("rename sends project patch with new site", async () => {
  const { rename } = await import("../src/commands");
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
    ok: true,
    oldSite: "drop-a1b2c3d4",
    site: "my-site",
    url: "https://my-site.drophere.page/"
  }), { status: 200 }));
  const writes: string[] = [];
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
    writes.push(String(chunk));
    return true;
  });

  await rename(["drop-a1b2c3d4.drophere.page", "my-site", "--endpoint", "https://api.test", "--token", "user_tok"]);

  expect(fetchMock).toHaveBeenCalledWith("https://api.test/v1/projects/drop-a1b2c3d4", expect.objectContaining({
    method: "PATCH",
    headers: expect.objectContaining({ authorization: "Bearer user_tok" })
  }));
  const request = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
  expect(request).toEqual({ site: "my-site" });
  expect(writes.join("")).toContain("old:     drop-a1b2c3d4.drophere.page");
  expect(writes.join("")).toContain("new:     my-site.drophere.page");
  expect(writes.join("")).toContain("Success - Domain renamed.");

  stdout.mockRestore();
  fetchMock.mockRestore();
});

test("rename rejects unchanged domains before API call", async () => {
  const { rename } = await import("../src/commands");
  const fetchMock = vi.spyOn(globalThis, "fetch");

  await expect(rename(["demo.drophere.page", "demo", "--endpoint", "https://api.test", "--token", "user_tok"]))
    .rejects.toThrow("same as the current domain");
  expect(fetchMock).not.toHaveBeenCalled();

  fetchMock.mockRestore();
});
