import { DEFAULT_API } from "./constants";
import { siteFromDomain } from "./domain";
import { friendlyApiMessage } from "./format";
import { DropHereError, type AnonymousSession, type ApiClientOptions, type ApiTokenSummary, type ClaimResult, type DeploymentSummary, type DeployResult, type FileSummary, type LocalDeploymentInput, type LocalDeploymentRecord, type PreparedDeployment, type ProjectSummary, type RenameProjectResult, type StorageAdapter, type TeardownProjectResult, type TrackEventInput, type UsageOverview, type WebSessionSummary } from "./types";

export function createDeployClient(options: ApiClientOptions) {
  const api = normalizeApiEndpoint(options.api ?? DEFAULT_API);
  const fetcher = options.fetcher ?? fetch;
  const storage = options.storage;

  return {
    api,
    storage,
    async readConfig() {
      return storage.read();
    },
    async trackEvent(input: TrackEventInput): Promise<void> {
      await trackEvent(fetcher, api, options.source, storage, input);
    },
    async createAnonymousSession(): Promise<AnonymousSession> {
      const body = await request(fetcher, api, "/v1/auth/anonymous", {
        method: "POST",
        body: { source: options.source },
      });
      const token = stringValue(body.token);
      const expiresAt = stringValue(body.session?.expiresAt);
      if (!token || !expiresAt) throw new DropHereError("匿名会话创建失败，请稍后重试。", "anonymous_session_failed");
      const current = await storage.read();
      await storage.write({ ...current, api: current.api ?? api, anonymousToken: token, anonymousTokenApi: api, anonymousSessionExpiresAt: expiresAt });
      return { token, expiresAt };
    },
    async ensureAnonymousSession(): Promise<AnonymousSession> {
      const current = await storage.read();
      if (
        current.anonymousToken &&
        credentialMatchesApi(current.anonymousTokenApi ?? current.api, api) &&
        current.anonymousSessionExpiresAt &&
        Date.parse(current.anonymousSessionExpiresAt) > Date.now() + 60_000
      ) {
        return { token: current.anonymousToken, expiresAt: current.anonymousSessionExpiresAt };
      }
      return this.createAnonymousSession();
    },
    async login(email: string, password: string) {
      const webSession = options.source === "web";
      const body = await request(fetcher, api, webSession ? "/v1/auth/session" : "/v1/auth/login", {
        method: "POST",
        body: { email, password, source: options.source },
      });
      const accountEmail = stringValue(body.user?.email) ?? email;
      const token = stringValue(body.token);
      if (!webSession && !token) throw new DropHereError("登录失败，请检查邮箱和密码后重试。", "login_failed");
      const current = await storage.read();
      await storage.write({
        ...current,
        api,
        token: webSession ? undefined : token,
        tokenApi: webSession ? undefined : api,
        session: webSession ? true : current.session,
        sessionApi: webSession ? api : current.sessionApi,
        email: accountEmail,
        emailVerified: Boolean(body.user?.emailVerified),
        planKey: stringValue(body.user?.planKey),
      });
      return {
        token,
        session: webSession,
        user: { email: accountEmail, emailVerified: Boolean(body.user?.emailVerified), planKey: stringValue(body.user?.planKey) },
        created: Boolean(body.created),
      };
    },
    async register(email: string, password: string) {
      const body = await request(fetcher, api, "/v1/auth/register", {
        method: "POST",
        body: { email, password, source: options.source },
      });
      const accountEmail = stringValue(body.user?.email) ?? email;
      const current = await storage.read();
      await storage.write({
        ...current,
        api,
        session: options.source === "web" ? true : current.session,
        sessionApi: options.source === "web" ? api : current.sessionApi,
        email: accountEmail,
        emailVerified: Boolean(body.user?.emailVerified),
        planKey: stringValue(body.user?.planKey),
      });
      return { session: options.source === "web", user: { email: accountEmail, emailVerified: Boolean(body.user?.emailVerified), planKey: stringValue(body.user?.planKey) }, created: Boolean(body.created) };
    },
    async logout() {
      const current = await storage.read();
      const token = credentialMatchesApi(current.tokenApi ?? current.api, api) ? current.token : undefined;
      void request(fetcher, api, "/v1/auth/logout", {
        method: "POST",
        token,
        optionalAuth: true,
      }).catch(() => undefined);
      const next = {
        api: current.anonymousTokenApi ?? current.api ?? api,
        anonymousToken: current.anonymousToken,
        anonymousTokenApi: current.anonymousTokenApi,
        anonymousSessionExpiresAt: current.anonymousSessionExpiresAt,
        lastAnonymousSite: current.lastAnonymousSite,
        localDeployments: current.localDeployments,
      };
      await storage.write(next);
      return next;
    },
    async me() {
      const token = await authToken(storage, api, { allowSession: true, optional: true });
      return request(fetcher, api, "/v1/me", { method: "GET", token, optionalAuth: true });
    },
    async usage(): Promise<UsageOverview> {
      const token = await authToken(storage, api, { allowAnonymous: true, allowSession: true });
      return request(fetcher, api, "/v1/usage", { method: "GET", token });
    },
    async requestEmailVerification() {
      const token = await authToken(storage, api, { allowSession: true });
      return request(fetcher, api, "/v1/auth/email/request", { method: "POST", token });
    },
    async confirmEmail(tokenValue: string) {
      return request(fetcher, api, "/v1/auth/email/confirm", { method: "POST", body: { token: tokenValue } });
    },
    async requestPasswordReset(email: string) {
      return request(fetcher, api, "/v1/auth/password/request", { method: "POST", body: { email } });
    },
    async confirmPasswordReset(tokenValue: string, password: string) {
      return request(fetcher, api, "/v1/auth/password/confirm", { method: "POST", body: { token: tokenValue, password } });
    },
    async listApiTokens(): Promise<ApiTokenSummary[]> {
      const token = await authToken(storage, api, { allowSession: true });
      const body = await request(fetcher, api, "/v1/api-tokens", { method: "GET", token });
      return Array.isArray(body.tokens) ? body.tokens : [];
    },
    async createApiToken(name: string) {
      const token = await authToken(storage, api, { allowSession: true });
      return request(fetcher, api, "/v1/api-tokens", { method: "POST", token, body: { name } });
    },
    async revokeApiToken(id: string) {
      const token = await authToken(storage, api, { allowSession: true });
      return request(fetcher, api, `/v1/api-tokens/${encodeURIComponent(id)}`, { method: "DELETE", token });
    },
    async listSessions(): Promise<WebSessionSummary[]> {
      const token = await authToken(storage, api, { allowSession: true });
      const body = await request(fetcher, api, "/v1/sessions", { method: "GET", token });
      return Array.isArray(body.sessions) ? body.sessions : [];
    },
    async revokeSession(id: string) {
      const token = await authToken(storage, api, { allowSession: true });
      return request(fetcher, api, `/v1/sessions/${encodeURIComponent(id)}`, { method: "DELETE", token });
    },
    async deployGuest(prepared: PreparedDeployment, local?: LocalDeploymentInput): Promise<DeployResult> {
      const anonymous = await this.ensureAnonymousSession();
      const body = await request(fetcher, api, "/v1/deploy", {
        method: "POST",
        token: anonymous.token,
        body: {
          source: options.source,
          entrypoint: prepared.entrypoint,
          files: prepared.files,
        },
      });
      const site = stringValue(body.site) ?? siteFromDomain(String(body.url ?? ""));
      const current = await storage.read();
      await storage.write({ ...current, api: current.api ?? api, anonymousToken: anonymous.token, anonymousTokenApi: api, anonymousSessionExpiresAt: anonymous.expiresAt, lastAnonymousSite: site });
      const result = deployResult(body, site);
      await saveLocalDeployment(storage, result, prepared, local ?? { source: options.source === "extension" ? "extension-paste" : "web-drop" });
      return result;
    },
    async deployUser(prepared: PreparedDeployment, domain: string, local?: LocalDeploymentInput): Promise<DeployResult> {
      const token = await authToken(storage, api, { allowSession: true });
      const site = siteFromDomain(domain);
      const body = await request(fetcher, api, "/v1/deploy", {
        method: "POST",
        token,
        body: {
          source: options.source,
          site,
          entrypoint: prepared.entrypoint,
          files: prepared.files,
        },
      });
      const result = deployResult(body, site);
      await saveLocalDeployment(storage, { ...result, temporary: false, anonymous: false, claimable: false }, prepared, local ?? { source: options.source === "extension" ? "extension-paste" : "web-drop" });
      return result;
    },
    async claim(domain: string): Promise<ClaimResult> {
      const current = await storage.read();
      const token = await authToken(storage, api, { allowSession: true });
      if (!current.anonymousToken || !credentialMatchesApi(current.anonymousTokenApi ?? current.api, api)) {
        throw new DropHereError("这个浏览器里找不到当前服务对应的匿名发布记录，请在发布它的浏览器里归属到账号。", "missing_anonymous_token");
      }
      const site = siteFromDomain(domain);
      const body = await request(fetcher, api, `/v1/projects/${encodeURIComponent(site)}/claim`, {
        method: "POST",
        token,
        body: { anonymousToken: current.anonymousToken },
      });
      const ownerEmail = stringValue(body.owner?.email) ?? current.email ?? "你的账号";
      await markLocalDeploymentClaimed(storage, site, ownerEmail);
      return {
        ok: true,
        site,
        url: String(body.url ?? `https://${site}.drophere.page/`),
        claimed: true,
        owner: {
          id: stringValue(body.owner?.id),
          email: ownerEmail,
        },
      };
    },
    async listLocalDeployments(): Promise<LocalDeploymentRecord[]> {
      const current = await storage.read();
      return sortLocalDeployments(current.localDeployments ?? []);
    },
    async saveLocalDeployment(result: DeployResult, prepared: PreparedDeployment, local: LocalDeploymentInput): Promise<LocalDeploymentRecord> {
      return saveLocalDeployment(storage, result, prepared, local);
    },
    async removeLocalDeployment(siteOrDomain: string): Promise<LocalDeploymentRecord[]> {
      const site = siteFromDomain(siteOrDomain);
      const current = await storage.read();
      const nextRecords = (current.localDeployments ?? []).filter((record) => record.site !== site);
      await storage.write({ ...current, localDeployments: sortLocalDeployments(nextRecords) });
      return nextRecords;
    },
    async listProjects(): Promise<ProjectSummary[]> {
      const token = await authToken(storage, api, { allowAnonymous: true, allowSession: true });
      const body = await request(fetcher, api, "/v1/projects", {
        method: "GET",
        token,
      });
      return Array.isArray(body.projects) ? body.projects.map(projectSummary) : [];
    },
    async listDeployments(domain: string): Promise<DeploymentSummary[]> {
      const token = await authToken(storage, api, { allowAnonymous: true, allowSession: true });
      const site = siteFromDomain(domain);
      const body = await request(fetcher, api, `/v1/projects/${encodeURIComponent(site)}/deployments`, {
        method: "GET",
        token,
      });
      return Array.isArray(body.deployments) ? body.deployments.map(deploymentSummary) : [];
    },
    async listFiles(domain: string): Promise<FileSummary[]> {
      const token = await authToken(storage, api, { allowAnonymous: true, allowSession: true });
      const site = siteFromDomain(domain);
      const body = await request(fetcher, api, `/v1/projects/${encodeURIComponent(site)}/files`, {
        method: "GET",
        token,
      });
      return Array.isArray(body.files) ? body.files.map(fileSummary) : [];
    },
    async teardownProject(domain: string): Promise<TeardownProjectResult> {
      const token = await authToken(storage, api, { allowAnonymous: true, allowSession: true });
      const site = siteFromDomain(domain);
      const body = await request(fetcher, api, `/v1/projects/${encodeURIComponent(site)}`, {
        method: "DELETE",
        token,
      });
      const result: TeardownProjectResult = {
        ok: true,
        site: stringValue(body.site) ?? site,
        deletedDeployments: numberValue(body.deletedDeployments) ?? 0,
        deletedObjects: numberValue(body.deletedObjects) ?? 0,
      };
      await this.removeLocalDeployment(site);
      return result;
    },
    async renameProject(domain: string, nextDomain: string): Promise<RenameProjectResult> {
      const token = await authToken(storage, api, { allowSession: true });
      const site = siteFromDomain(domain);
      const nextSite = siteFromDomain(nextDomain);
      const body = await request(fetcher, api, `/v1/projects/${encodeURIComponent(site)}`, {
        method: "PATCH",
        token,
        body: { site: nextSite },
      });
      const result: RenameProjectResult = {
        ok: true,
        oldSite: stringValue(body.oldSite) ?? site,
        site: stringValue(body.site) ?? nextSite,
        url: String(body.url ?? `https://${nextSite}.drophere.page/`),
        copiedObjects: numberValue(body.copiedObjects),
        deletedObjects: numberValue(body.deletedObjects),
      };
      await renameLocalDeployment(storage, result.oldSite, result.site, result.url);
      return result;
    },
  };
}

async function request(fetcher: typeof fetch, api: string, pathname: string, options: { method: string; token?: string; body?: unknown; optionalAuth?: boolean }): Promise<any> {
  const response = await fetcher(`${api}${pathname}`, {
    method: options.method,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    throw new DropHereError(friendlyApiMessage(response.status, body), stringValue(body.error) ?? "request_failed", response.status, body);
  }
  return body;
}

async function trackEvent(
  fetcher: typeof fetch,
  api: string,
  source: "web" | "extension",
  storage: StorageAdapter,
  input: TrackEventInput
): Promise<void> {
  if (isJsdomRuntime()) return;
  try {
    const current = await storage.read();
    const userToken = credentialMatchesApi(current.tokenApi ?? current.api, api) ? current.token : undefined;
    const anonymousToken = credentialMatchesApi(current.anonymousTokenApi ?? current.api, api) ? current.anonymousToken : undefined;
    await fetcher(`${api}/v1/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(userToken ? { authorization: `Bearer ${userToken}` } : anonymousToken ? { authorization: `Bearer ${anonymousToken}` } : {}),
      },
      body: JSON.stringify({
        event: input.event,
        source,
        outcome: input.outcome ?? "info",
        site: input.site,
        error: input.error,
        status: input.status,
        metadata: input.metadata,
      }),
    });
  } catch {
    // Analytics must never block publishing.
  }
}

function isJsdomRuntime(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent.toLowerCase().includes("jsdom");
}

async function authToken(storage: StorageAdapter, api: string, options: { allowAnonymous?: boolean; allowSession?: boolean; optional?: boolean } = {}): Promise<string | undefined> {
  const current = await storage.read();
  if (current.token && credentialMatchesApi(current.tokenApi ?? current.api, api)) return current.token;
  if (options.allowSession && current.session && credentialMatchesApi(current.sessionApi ?? current.api, api)) return undefined;
  if (options.allowAnonymous && current.anonymousToken && credentialMatchesApi(current.anonymousTokenApi ?? current.api, api)) return current.anonymousToken;
  if (options.optional) return undefined;
  throw new DropHereError("请先登录账号。", "missing_user_token");
}

function credentialMatchesApi(storedApi: string | undefined, api: string): boolean {
  try {
    return normalizeApiEndpoint(storedApi ?? DEFAULT_API) === api;
  } catch {
    return false;
  }
}

function normalizeApiEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DropHereError(`API 地址无效：${value}`, "invalid_api_endpoint");
  }
  const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalhost)) {
    throw new DropHereError("API 地址必须使用 HTTPS，本机开发环境可以使用 HTTP。", "insecure_api_endpoint");
  }
  if (url.username || url.password || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    throw new DropHereError("API 地址只能包含协议、主机和端口。", "invalid_api_endpoint");
  }
  return url.origin;
}

function deployResult(body: any, site: string): DeployResult {
  return {
    ok: true,
    site,
    url: String(body.url ?? `https://${site}.drophere.page/`),
    version: numberValue(body.version),
    fileCount: numberValue(body.fileCount),
    totalBytes: numberValue(body.totalBytes),
    temporary: Boolean(body.temporary),
    anonymous: Boolean(body.anonymous),
    expiresAt: stringValue(body.expiresAt),
    claimable: Boolean(body.claimable),
  };
}

async function saveLocalDeployment(
  storage: StorageAdapter,
  result: DeployResult,
  prepared: PreparedDeployment,
  local: LocalDeploymentInput
): Promise<LocalDeploymentRecord> {
  const current = await storage.read();
  const domain = `${result.site}.drophere.page`;
  const createdAt = new Date().toISOString();
  const nextRecord: LocalDeploymentRecord = {
    id: `${result.site}-${createdAt}`,
    site: result.site,
    domain,
    url: result.url,
    title: local.title,
    source: local.source,
    sourceLabel: local.sourceLabel ?? prepared.sourceLabel,
    fileCount: result.fileCount ?? prepared.fileCount,
    totalBytes: result.totalBytes ?? prepared.totalBytes,
    temporary: result.temporary !== false,
    expiresAt: result.expiresAt,
    createdAt,
  };
  const rest = (current.localDeployments ?? []).filter((record) => record.site !== result.site);
  const nextRecords = sortLocalDeployments([nextRecord, ...rest]).slice(0, 50);
  await storage.write({ ...current, localDeployments: nextRecords });
  return nextRecord;
}

async function markLocalDeploymentClaimed(storage: StorageAdapter, site: string, ownerEmail: string): Promise<void> {
  const current = await storage.read();
  const nextRecords = (current.localDeployments ?? []).map((record) =>
    record.site === site
      ? { ...record, temporary: false, expiresAt: undefined, claimedAt: new Date().toISOString(), ownerEmail }
      : record
  );
  await storage.write({ ...current, localDeployments: sortLocalDeployments(nextRecords) });
}

async function renameLocalDeployment(storage: StorageAdapter, oldSite: string, nextSite: string, nextUrl: string): Promise<void> {
  const current = await storage.read();
  const nextRecords = (current.localDeployments ?? []).map((record) =>
    record.site === oldSite
      ? { ...record, site: nextSite, domain: `${nextSite}.drophere.page`, url: nextUrl }
      : record
  );
  await storage.write({ ...current, localDeployments: sortLocalDeployments(nextRecords) });
}

function sortLocalDeployments(records: LocalDeploymentRecord[]): LocalDeploymentRecord[] {
  return [...records].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function projectSummary(value: any): ProjectSummary {
  const site = stringValue(value.site) ?? siteFromDomain(String(value.url ?? ""));
  return {
    projectId: stringValue(value.projectId),
    site,
    domain: stringValue(value.domain) ?? `${site}.drophere.page`,
    url: String(value.url ?? `https://${site}.drophere.page/`),
    ownerUserId: stringOrNull(value.ownerUserId),
    ownerEmail: stringOrNull(value.ownerEmail),
    anonymousSessionId: stringOrNull(value.anonymousSessionId),
    originalAnonymousSessionId: stringOrNull(value.originalAnonymousSessionId),
    temporary: Boolean(value.temporary),
    expiresAt: stringOrNull(value.expiresAt),
    claimedAt: stringOrNull(value.claimedAt),
    version: numberOrNull(value.version),
    fileCount: numberOrNull(value.fileCount),
    totalBytes: numberOrNull(value.totalBytes),
    createdAt: stringValue(value.createdAt),
    updatedAt: stringValue(value.updatedAt),
    deployedAt: stringOrNull(value.deployedAt),
  };
}

function deploymentSummary(value: any): DeploymentSummary {
  const site = stringValue(value.site) ?? siteFromDomain(String(value.url ?? ""));
  return {
    deploymentId: stringValue(value.deploymentId) ?? "",
    site,
    domain: stringValue(value.domain) ?? `${site}.drophere.page`,
    url: String(value.url ?? `https://${site}.drophere.page/`),
    version: numberValue(value.version) ?? 0,
    entrypoint: stringValue(value.entrypoint) ?? "index.html",
    fileCount: numberValue(value.fileCount) ?? 0,
    totalBytes: numberValue(value.totalBytes) ?? 0,
    createdAt: stringValue(value.createdAt) ?? "",
  };
}

function fileSummary(value: any): FileSummary {
  return {
    path: stringValue(value.path) ?? "",
    contentType: stringValue(value.contentType) ?? "application/octet-stream",
    size: numberValue(value.size) ?? 0,
    sha256: stringOrNull(value.sha256),
  };
}

function stringOrNull(value: unknown): string | null | undefined {
  return value === null ? null : stringValue(value);
}

function numberOrNull(value: unknown): number | null | undefined {
  return value === null ? null : numberValue(value);
}

export type DeployClient = ReturnType<typeof createDeployClient>;
