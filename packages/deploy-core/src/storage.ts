import type { LocalDeploymentRecord, LocalDeploymentSource, StorageAdapter, StoredDeployConfig } from "./types";

export function createMemoryStorageAdapter(initial: StoredDeployConfig = {}): StorageAdapter & { value(): StoredDeployConfig } {
  let state = { ...initial };
  return {
    async read() {
      return { ...state };
    },
    async write(config) {
      state = { ...config };
    },
    value() {
      return { ...state };
    },
  };
}

export function createLocalStorageAdapter(key = "drophere.drop.config"): StorageAdapter {
  return {
    async read() {
      if (typeof localStorage === "undefined") return {};
      const raw = localStorage.getItem(key);
      if (!raw) return {};
      try {
        return sanitizeConfig(JSON.parse(raw));
      } catch {
        return {};
      }
    },
    async write(config) {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(key, JSON.stringify(sanitizeConfig(config)));
    },
  };
}

export function createChromeStorageAdapter(area: {
  get(keys?: string[] | string | null): Promise<Record<string, unknown>> | void;
  set(items: Record<string, unknown>): Promise<void> | void;
}, key = "drophereDropConfig"): StorageAdapter {
  return {
    async read() {
      const result = await area.get(key) as Record<string, unknown> | undefined;
      return sanitizeConfig(result?.[key] ?? {});
    },
    async write(config) {
      await area.set({ [key]: sanitizeConfig(config) });
    },
  };
}

function sanitizeConfig(value: unknown): StoredDeployConfig {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  return {
    api: stringValue(record.api),
    token: stringValue(record.token),
    tokenApi: stringValue(record.tokenApi),
    email: stringValue(record.email),
    session: typeof record.session === "boolean" ? record.session : undefined,
    sessionApi: stringValue(record.sessionApi),
    emailVerified: typeof record.emailVerified === "boolean" ? record.emailVerified : undefined,
    planKey: stringValue(record.planKey),
    anonymousToken: stringValue(record.anonymousToken),
    anonymousTokenApi: stringValue(record.anonymousTokenApi),
    anonymousSessionExpiresAt: stringValue(record.anonymousSessionExpiresAt),
    lastAnonymousSite: stringValue(record.lastAnonymousSite),
    localDeployments: arrayValue(record.localDeployments).map(sanitizeLocalDeployment).filter(Boolean).slice(0, 50) as LocalDeploymentRecord[],
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function sanitizeLocalDeployment(value: unknown): LocalDeploymentRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const site = stringValue(record.site);
  const url = stringValue(record.url);
  if (!site || !url) return null;
  const domain = stringValue(record.domain) ?? httpDomain(url);
  if (!domain) return null;
  return {
    id: stringValue(record.id) ?? `${site}-${stringValue(record.createdAt) ?? Date.now().toString(36)}`,
    site,
    domain,
    url,
    title: stringValue(record.title),
    source: sourceValue(record.source),
    sourceLabel: stringValue(record.sourceLabel),
    fileCount: numberValue(record.fileCount),
    totalBytes: numberValue(record.totalBytes),
    temporary: typeof record.temporary === "boolean" ? record.temporary : true,
    expiresAt: stringValue(record.expiresAt),
    createdAt: stringValue(record.createdAt) ?? new Date().toISOString(),
    claimedAt: stringValue(record.claimedAt),
    ownerEmail: stringValue(record.ownerEmail),
  };
}

function httpDomain(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.username || url.password || !url.host) return undefined;
    return url.host;
  } catch {
    return undefined;
  }
}

function sourceValue(value: unknown): LocalDeploymentSource {
  const allowed = new Set<LocalDeploymentSource>(["web-drop", "extension-paste", "extension-scan", "extension-selection", "cli", "unknown"]);
  return typeof value === "string" && allowed.has(value as LocalDeploymentSource) ? value as LocalDeploymentSource : "unknown";
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
