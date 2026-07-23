import { normalizeApiEndpoint, type Runtime } from "./config";
import { CliError } from "./errors";
import { formatApiError } from "./format";

export async function apiRequest(runtime: Runtime, pathname: string, options: { method: string; body?: unknown }): Promise<any> {
  const headers: Record<string, string> = {
    ...(runtime.token ? { authorization: `Bearer ${runtime.token}` } : {}),
    "content-type": "application/json"
  };

  const response = await fetchWithRetry(`${normalizeApiEndpoint(runtime.api)}${pathname}`, {
    method: options.method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const body = await parseResponseBody(response);
  if (!response.ok || body.ok === false) {
    throw new CliError(formatApiError("Request failed", response.status, body));
  }
  return body;
}

export async function publicApiRequest(api: string, pathname: string, options: { method: string; body?: unknown }): Promise<any> {
  const response = await fetchWithRetry(`${normalizeApiEndpoint(api)}${pathname}`, {
    method: options.method,
    headers: { "content-type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  return { response, body: await parseResponseBody(response) };
}

export async function trackCliEvent(
  api: string,
  token: string | undefined,
  input: {
    event: string;
    outcome?: "success" | "error" | "info";
    site?: string;
    error?: string;
    status?: number;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return;
  try {
    await fetchWithRetry(`${normalizeApiEndpoint(api)}/v1/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        event: input.event,
        source: "cli",
        outcome: input.outcome ?? "info",
        site: input.site,
        error: input.error,
        status: input.status,
        metadata: input.metadata
      })
    }, 1);
  } catch {
    // Analytics should never block CLI workflows.
  }
}

export async function parseResponseBody(response: Response): Promise<any> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { ok: false, error: text || response.statusText };
  }
}

export async function fetchWithRetry(url: string, options: RequestInit, attempts = 4): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (response.status < 500 || attempt === attempts - 1) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) throw error;
    }
    await sleep(600 * (attempt + 1));
  }
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
