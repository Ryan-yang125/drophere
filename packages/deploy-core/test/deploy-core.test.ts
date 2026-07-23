import JSZip from "jszip";
import {
  createDeployClient,
  createMemoryStorageAdapter,
  friendlyApiMessage,
  prepareFiles,
  prepareHtml,
  siteFromDomain,
} from "../src";

test("prepares pasted html as index.html", async () => {
  const prepared = await prepareHtml("<main>Hello</main>", { title: "Hello" });
  expect(prepared.fileCount).toBe(1);
  expect(prepared.files[0]).toMatchObject({
    path: "index.html",
    contentType: "text/html; charset=utf-8",
  });
  expect(atob(prepared.files[0]!.contentBase64)).toContain("<main>Hello</main>");
});

test("treats a single html file as index.html", async () => {
  const prepared = await prepareFiles([
    new File(["<h1>Single HTML</h1>"], "demo-page.html", { type: "text/html" }),
  ]);

  expect(prepared.sourceLabel).toBe("demo-page.html");
  expect(prepared.files).toHaveLength(1);
  expect(prepared.files[0]).toMatchObject({
    path: "index.html",
    contentType: "text/html; charset=utf-8",
  });
  expect(atob(prepared.files[0]!.contentBase64)).toContain("Single HTML");
});

test("prepares files and strips a single zip root folder", async () => {
  const zip = new JSZip();
  zip.file("demo/index.html", "<h1>Zip</h1>");
  zip.file("demo/assets/app.css", "body{}");
  zip.file("demo/.DS_Store", "ignored");
  const blob = await zip.generateAsync({ type: "blob" });
  const file = new File([blob], "demo.zip", { type: "application/zip" });

  const prepared = await prepareFiles([file]);
  expect(prepared.files.map((item) => item.path)).toEqual(["assets/app.css", "index.html"]);
});

test("rejects uploads without a top level entrypoint", async () => {
  const file = new File(["body{}"], "style.css", { type: "text/css" });
  await expect(prepareFiles([file])).rejects.toThrow("index.html");
});

test("normalizes domains", () => {
  expect(siteFromDomain("https://demo.drophere.page/")).toBe("demo");
  expect(siteFromDomain("demo")).toBe("demo");
  expect(() => siteFromDomain("example.com")).toThrow("drophere.page");
});

test("deploys guest without site and stores anonymous config", async () => {
  const storage = createMemoryStorageAdapter();
  const requests: Array<{ url: string; body: any; authorization?: string }> = [];
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      authorization: (init?.headers as Record<string, string>)?.authorization,
    });
    if (String(url).endsWith("/v1/auth/anonymous")) {
      return new Response(JSON.stringify({
        ok: true,
        token: "anon_tok",
        session: { expiresAt: "2026-01-01T00:00:00.000Z" },
      }), { status: 201 });
    }
    return new Response(JSON.stringify({
      ok: true,
      site: "drop-a1b2c3d4",
      url: "https://drop-a1b2c3d4.drophere.page/",
      temporary: true,
      anonymous: true,
      expiresAt: "2026-01-03T00:00:00.000Z",
      claimable: true,
    }), { status: 201 });
  }) as unknown as typeof fetch;
  const client = createDeployClient({ api: "https://api.test", source: "web", storage, fetcher });
  const prepared = await prepareHtml("<h1>Guest</h1>");

  const result = await client.deployGuest(prepared);

  expect(result.site).toBe("drop-a1b2c3d4");
  expect(requests[1]!.body.site).toBeUndefined();
  expect(requests[1]!.authorization).toBe("Bearer anon_tok");
  expect(storage.value()).toMatchObject({
    anonymousToken: "anon_tok",
    lastAnonymousSite: "drop-a1b2c3d4",
  });
  expect(storage.value().localDeployments?.[0]).toMatchObject({
    site: "drop-a1b2c3d4",
    temporary: true,
    source: "web-drop",
  });
});

test("extension login preserves anonymous token and claim sends both tokens", async () => {
  const storage = createMemoryStorageAdapter({
    api: "https://api.test",
    anonymousToken: "anon_tok",
    anonymousSessionExpiresAt: "2026-01-01T00:00:00.000Z",
  });
  const requests: Array<{ url: string; body: any; authorization?: string }> = [];
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      authorization: (init?.headers as Record<string, string>)?.authorization,
    });
    if (String(url).endsWith("/v1/auth/login")) {
      return new Response(JSON.stringify({
        ok: true,
        token: "user_tok",
        user: { email: "user@example.com" },
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      ok: true,
      site: "drop-a1b2c3d4",
      url: "https://drop-a1b2c3d4.drophere.page/",
      claimed: true,
      owner: { email: "user@example.com" },
    }), { status: 200 });
  }) as unknown as typeof fetch;
  const client = createDeployClient({ api: "https://api.test", source: "extension", storage, fetcher });

  await client.login("user@example.com", "LongPassword123");
  const result = await client.claim("drop-a1b2c3d4.drophere.page");

  expect(result.claimed).toBe(true);
  expect(storage.value()).toMatchObject({ token: "user_tok", anonymousToken: "anon_tok" });
  expect(requests[1]!.authorization).toBe("Bearer user_tok");
  expect(requests[1]!.body).toEqual({ anonymousToken: "anon_tok" });
});

test("web login uses session cookies and can claim without bearer token", async () => {
  const storage = createMemoryStorageAdapter({
    api: "https://api.test",
    anonymousToken: "anon_tok",
    anonymousSessionExpiresAt: "2026-01-01T00:00:00.000Z",
  });
  const requests: Array<{ url: string; body: any; authorization?: string; credentials?: RequestCredentials }> = [];
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      authorization: (init?.headers as Record<string, string>)?.authorization,
      credentials: init?.credentials,
    });
    if (String(url).endsWith("/v1/auth/session")) {
      return new Response(JSON.stringify({
        ok: true,
        session: true,
        user: { email: "user@example.com", emailVerified: false, planKey: "unverified" },
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      ok: true,
      site: "drop-a1b2c3d4",
      url: "https://drop-a1b2c3d4.drophere.page/",
      claimed: true,
      owner: { email: "user@example.com" },
    }), { status: 200 });
  }) as unknown as typeof fetch;
  const client = createDeployClient({ api: "https://api.test", source: "web", storage, fetcher });

  await client.login("user@example.com", "LongPassword123");
  const result = await client.claim("drop-a1b2c3d4.drophere.page");

  expect(result.claimed).toBe(true);
  expect(storage.value()).toMatchObject({ session: true, anonymousToken: "anon_tok" });
  expect(storage.value().token).toBeUndefined();
  expect(requests[0]!.url).toBe("https://api.test/v1/auth/session");
  expect(requests[0]!.credentials).toBe("include");
  expect(requests[1]!.authorization).toBeUndefined();
  expect(requests[1]!.body).toEqual({ anonymousToken: "anon_tok" });
});

test("never reuses stored tokens across API origins", async () => {
  const storage = createMemoryStorageAdapter({
    api: "https://api.drophere.page",
    token: "official_user_token",
    tokenApi: "https://api.drophere.page",
    anonymousToken: "official_guest_token",
    anonymousTokenApi: "https://api.drophere.page",
    anonymousSessionExpiresAt: "2099-01-01T00:00:00.000Z",
  });
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    expect(String(url)).toBe("https://other.example/v1/auth/anonymous");
    return new Response(JSON.stringify({
      ok: true,
      token: "other_guest_token",
      session: { expiresAt: "2099-01-02T00:00:00.000Z" },
    }), { status: 201 });
  }) as unknown as typeof fetch;
  const client = createDeployClient({ api: "https://other.example", source: "extension", storage, fetcher });

  await expect(client.listProjects()).rejects.toMatchObject({ code: "missing_user_token" });
  expect(fetcher).not.toHaveBeenCalled();

  await expect(client.ensureAnonymousSession()).resolves.toEqual({
    token: "other_guest_token",
    expiresAt: "2099-01-02T00:00:00.000Z",
  });
  expect(storage.value()).toMatchObject({
    token: "official_user_token",
    tokenApi: "https://api.drophere.page",
    anonymousToken: "other_guest_token",
    anonymousTokenApi: "https://other.example",
  });
});

test("claim requires user and guest credentials from the same API origin", async () => {
  const storage = createMemoryStorageAdapter({
    api: "https://other.example",
    token: "other_user_token",
    tokenApi: "https://other.example",
    anonymousToken: "official_guest_token",
    anonymousTokenApi: "https://api.drophere.page",
  });
  const fetcher = vi.fn() as unknown as typeof fetch;
  const client = createDeployClient({ api: "https://other.example", source: "extension", storage, fetcher });

  await expect(client.claim("drop-a1b2c3d4.drophere.page")).rejects.toMatchObject({ code: "missing_anonymous_token" });
  expect(fetcher).not.toHaveBeenCalled();
});

test("requires HTTPS for non-local API endpoints", () => {
  const storage = createMemoryStorageAdapter();
  expect(() => createDeployClient({ api: "http://attacker.example", source: "extension", storage })).toThrow("HTTPS");
  expect(createDeployClient({ api: "http://127.0.0.1:8787", source: "extension", storage }).api).toBe("http://127.0.0.1:8787");
});

test("trackEvent posts source and current token without blocking callers", async () => {
  const storage = createMemoryStorageAdapter({ api: "https://api.test", token: "user_tok" });
  const requests: Array<{ url: string; body: any; authorization?: string }> = [];
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      authorization: (init?.headers as Record<string, string>)?.authorization,
    });
    return new Response(JSON.stringify({ ok: true }), { status: 201 });
  }) as unknown as typeof fetch;
  const client = createDeployClient({ api: "https://api.test", source: "extension", storage, fetcher });

  await client.trackEvent({
    event: "publish_started",
    outcome: "info",
    site: "demo.drophere.page",
    metadata: { fileCount: 1 },
  });

  expect(requests[0]).toMatchObject({
    url: "https://api.test/v1/events",
    authorization: "Bearer user_tok",
    body: {
      event: "publish_started",
      source: "extension",
      outcome: "info",
      site: "demo.drophere.page",
      metadata: { fileCount: 1 },
    },
  });
});

test("manages local deployment history", async () => {
  const storage = createMemoryStorageAdapter();
  const client = createDeployClient({ api: "https://api.test", source: "extension", storage, fetcher: vi.fn() as unknown as typeof fetch });
  const prepared = await prepareHtml("<h1>Local</h1>");

  await client.saveLocalDeployment({
    ok: true,
    site: "drop-local",
    url: "https://drop-local.drophere.page/",
    temporary: true,
    expiresAt: "2026-01-03T00:00:00.000Z",
  }, prepared, { source: "extension-scan", title: "扫描页面" });

  await expect(client.listLocalDeployments()).resolves.toMatchObject([{
    site: "drop-local",
    source: "extension-scan",
    title: "扫描页面",
    temporary: true,
  }]);

  await client.removeLocalDeployment("drop-local.drophere.page");
  await expect(client.listLocalDeployments()).resolves.toEqual([]);
});

test("friendly messages prefer known error codes over english backend text", () => {
  expect(friendlyApiMessage(429, {
    error: "anonymous_hourly_deploy_quota_exceeded",
    message: "Guest deployments from this network are temporarily limited.",
  })).toBe("本小时游客发布次数已用完。登录后可以继续发布，或稍后再试。");
  expect(friendlyApiMessage(429, {
    error: "anonymous_active_project_quota_exceeded",
    message: "This guest session already has too many active temporary projects.",
  })).toContain("本机临时网站数量已满");
});

test("logout removes user identity and keeps guest claim data", async () => {
  const storage = createMemoryStorageAdapter({
    api: "https://api.test",
    token: "user_tok",
    email: "user@example.com",
    anonymousToken: "anon_tok",
    anonymousSessionExpiresAt: "2026-01-01T00:00:00.000Z",
    lastAnonymousSite: "drop-a1b2c3d4",
  });
  const client = createDeployClient({ api: "https://api.test", source: "web", storage });

  await client.logout();

  expect(storage.value()).toEqual({
    api: "https://api.test",
    anonymousToken: "anon_tok",
    anonymousSessionExpiresAt: "2026-01-01T00:00:00.000Z",
    lastAnonymousSite: "drop-a1b2c3d4",
  });
});

test("project management client uses stable API payloads", async () => {
  const storage = createMemoryStorageAdapter({ api: "https://api.test", token: "user_tok", email: "user@example.com" });
  const requests: Array<{ url: string; method?: string; body: any; authorization?: string }> = [];
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(url),
      method: init?.method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      authorization: (init?.headers as Record<string, string>)?.authorization,
    });
    if (String(url).endsWith("/v1/projects") && init?.method === "GET") {
      return new Response(JSON.stringify({
        ok: true,
        projects: [{
          projectId: "prj_1",
          site: "demo",
          domain: "demo.drophere.page",
          url: "https://demo.drophere.page/",
          version: 2,
          fileCount: 3,
          totalBytes: 1200,
        }],
      }), { status: 200 });
    }
    if (String(url).endsWith("/v1/projects/demo/deployments")) {
      return new Response(JSON.stringify({
        ok: true,
        deployments: [{ deploymentId: "dep_1", site: "demo", domain: "demo.drophere.page", url: "https://demo.drophere.page/", version: 2, entrypoint: "index.html", fileCount: 3, totalBytes: 1200, createdAt: "2026-01-01T00:00:00.000Z" }],
      }), { status: 200 });
    }
    if (String(url).endsWith("/v1/projects/demo/files")) {
      return new Response(JSON.stringify({
        ok: true,
        files: [{ path: "index.html", contentType: "text/html; charset=utf-8", size: 12, sha256: null }],
      }), { status: 200 });
    }
    if (String(url).endsWith("/v1/projects/demo") && init?.method === "PATCH") {
      return new Response(JSON.stringify({
        ok: true,
        oldSite: "demo",
        site: "renamed",
        url: "https://renamed.drophere.page/",
        copiedObjects: 1,
        deletedObjects: 1,
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      ok: true,
      site: "renamed",
      deletedDeployments: 2,
      deletedObjects: 4,
    }), { status: 200 });
  }) as unknown as typeof fetch;
  const client = createDeployClient({ api: "https://api.test", source: "web", storage, fetcher });

  await expect(client.listProjects()).resolves.toMatchObject([{ site: "demo", version: 2 }]);
  await expect(client.listDeployments("demo.drophere.page")).resolves.toMatchObject([{ deploymentId: "dep_1", version: 2 }]);
  await expect(client.listFiles("demo.drophere.page")).resolves.toMatchObject([{ path: "index.html", size: 12 }]);
  await expect(client.renameProject("demo.drophere.page", "renamed")).resolves.toMatchObject({ site: "renamed", copiedObjects: 1 });
  await expect(client.teardownProject("renamed.drophere.page")).resolves.toMatchObject({ site: "renamed", deletedObjects: 4 });

  expect(requests.map((request) => [request.method, request.url])).toEqual([
    ["GET", "https://api.test/v1/projects"],
    ["GET", "https://api.test/v1/projects/demo/deployments"],
    ["GET", "https://api.test/v1/projects/demo/files"],
    ["PATCH", "https://api.test/v1/projects/demo"],
    ["DELETE", "https://api.test/v1/projects/renamed"],
  ]);
  expect(requests[3]!.body).toEqual({ site: "renamed" });
  expect(requests.every((request) => request.authorization === "Bearer user_tok")).toBe(true);
});
