import { promises as fs } from "node:fs";
import path from "node:path";
import { DEFAULT_API, USER_CONFIG_PATH } from "./constants";
import type { CommonOptions } from "./args";
import { CliError } from "./errors";

export type CliConfig = {
  api?: string;
  token?: string;
  tokenApi?: string;
  email?: string;
  anonymousToken?: string;
  anonymousTokenApi?: string;
  anonymousSessionExpiresAt?: string;
  lastAnonymousSite?: string;
};

export type Runtime = {
  api: string;
  token?: string;
  email?: string;
  tokenKind?: "user" | "anonymous";
};

type RuntimeSettings = { allowMissingToken?: boolean; allowAnonymousToken?: boolean };

export async function resolveRuntime(options: CommonOptions, settings: RuntimeSettings = {}): Promise<Runtime> {
  return resolveRuntimeConfig(options, await loadUserConfig(), settings, process.env);
}

export function resolveRuntimeConfig(
  options: CommonOptions,
  config: CliConfig,
  settings: RuntimeSettings = {},
  environment: NodeJS.ProcessEnv = process.env
): Runtime {
  const storedApi = normalizeApiEndpoint(config.api ?? DEFAULT_API);
  const api = normalizeApiEndpoint(options.api ?? environment.DROPHERE_API ?? storedApi);
  const explicitToken = options.token ?? environment.DROPHERE_API_TOKEN;
  const userTokenApi = normalizeApiEndpoint(config.tokenApi ?? config.api ?? DEFAULT_API);
  const anonymousTokenApi = normalizeApiEndpoint(config.anonymousTokenApi ?? config.api ?? DEFAULT_API);
  const userToken = explicitToken ?? (api === userTokenApi ? config.token : undefined);
  const anonymousToken = settings.allowAnonymousToken && api === anonymousTokenApi ? config.anonymousToken : undefined;
  const token = userToken ?? anonymousToken;
  const email = api === userTokenApi ? config.email : undefined;

  if (!token && !settings.allowMissingToken) {
    throw new CliError("Not Authenticated. Run `drophere login --email <email>` or use `drophere guest <path>` for a temporary deploy.");
  }

  return { api, token, email, tokenKind: token ? (userToken ? "user" : "anonymous") : undefined };
}

export async function loadConfig(): Promise<CliConfig> {
  return loadUserConfig();
}

export function normalizeApiEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CliError(`Invalid API endpoint: ${value}`);
  }

  const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalhost)) {
    throw new CliError("API endpoint must use HTTPS. Plain HTTP is allowed only for localhost.");
  }
  if (url.username || url.password || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    throw new CliError("API endpoint must be an origin without credentials, a path, query, or fragment.");
  }
  return url.origin;
}

export async function loadUserConfig(): Promise<CliConfig> {
  return readConfig(USER_CONFIG_PATH);
}

export async function readConfig(configPath: string): Promise<CliConfig> {
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      api: typeof parsed.api === "string" ? parsed.api : undefined,
      token: typeof parsed.token === "string" ? parsed.token : undefined,
      tokenApi: typeof parsed.tokenApi === "string" ? parsed.tokenApi : undefined,
      email: typeof parsed.email === "string" ? parsed.email : undefined,
      anonymousToken: typeof parsed.anonymousToken === "string" ? parsed.anonymousToken : undefined,
      anonymousTokenApi: typeof parsed.anonymousTokenApi === "string" ? parsed.anonymousTokenApi : undefined,
      anonymousSessionExpiresAt: typeof parsed.anonymousSessionExpiresAt === "string" ? parsed.anonymousSessionExpiresAt : undefined,
      lastAnonymousSite: typeof parsed.lastAnonymousSite === "string" ? parsed.lastAnonymousSite : undefined
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return {};
    throw error;
  }
}

export async function writeUserConfig(config: CliConfig): Promise<void> {
  await fs.mkdir(path.dirname(USER_CONFIG_PATH), { recursive: true });
  await fs.writeFile(USER_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await fs.chmod(USER_CONFIG_PATH, 0o600);
}
