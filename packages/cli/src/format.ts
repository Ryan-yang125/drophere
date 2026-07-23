export type Column<T> = [label: string, key: keyof T & string, formatter?: (value: unknown) => string];

export function formatBytes(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB"];
  let amount = value / 1024;
  for (const unit of units) {
    if (amount < 1024 || unit === "GB") {
      return `${amount.toFixed(amount >= 10 ? 1 : 2)} ${unit}`;
    }
    amount /= 1024;
  }
  return `${value} B`;
}

export function humanQuotaKey(key: string): string {
  const labels: Record<string, string> = {
    projectsRemaining: "projects",
    deploysThisMinuteRemaining: "deploys this minute",
    deploysTodayRemaining: "deploys today",
    projectDeploysTodayRemaining: "project deploys today",
    storageBytesRemaining: "storage",
    deployBytesRemaining: "deployment size",
    fileBytesRemaining: "file size",
    filesRemaining: "files",
    anonymousDeploysThisHourRemaining: "guest deploys this hour",
    anonymousDeploysTodayRemaining: "guest deploys today",
    anonymousActiveProjectsRemaining: "guest active projects"
  };
  return labels[key] ?? key;
}

export function formatApiError(prefix: string, status: number, body: any): string {
  const lines = [`${prefix} (${status}): ${body?.error ?? "unknown_error"}`];
  if (body?.message) lines.push(body.message);
  if (body?.quota && typeof body.quota === "object") {
    const entries = Object.entries(body.quota)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => `  ${humanQuotaKey(key)}: ${key.toLowerCase().includes("bytes") ? formatBytes(value) : value}`);
    if (entries.length) {
      lines.push("remaining quota:");
      lines.push(...entries);
    }
  }
  if (body?.contact?.xiaohongshu) lines.push(`contact: Xiaohongshu ${body.contact.xiaohongshu}`);
  if (Array.isArray(body?.nextActions) && body.nextActions.length) {
    lines.push("next actions:");
    for (const action of body.nextActions.slice(0, 4)) lines.push(`  - ${action}`);
  }
  const guidance = body?.guidance ?? body?.upgrade;
  if (guidance?.usageUrl) lines.push(`usage: ${guidance.usageUrl}`);
  if (body?.retryAfterSeconds) lines.push(`retry after: ${body.retryAfterSeconds}s`);
  return lines.join("\n");
}

export function formatRows<T extends Record<string, unknown>>(rows: T[], columns: Column<T>[]): string {
  if (rows.length === 0) return "Empty\n";
  const matrix = rows.map((row) => columns.map((column) => {
    const formatter = column[2];
    const value = row[column[1]];
    return formatter ? formatter(value) : String(value ?? "");
  }));
  const widths = columns.map((column, index) => Math.max(
    column[0].length,
    ...matrix.map((row) => row[index]!.length)
  ));
  const output = [`${columns.map((column, index) => column[0].padEnd(widths[index]!)).join("  ")}\n`];
  for (const row of matrix) {
    output.push(`${row.map((value, index) => value.padEnd(widths[index]!)).join("  ")}\n`);
  }
  return output.join("");
}
