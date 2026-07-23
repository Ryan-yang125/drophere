import { DEFAULT_BASE_DOMAIN } from "./constants";
import { CliError } from "./errors";

export function siteFromDomain(value: string): string {
  const cleaned = value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
  const suffix = `.${DEFAULT_BASE_DOMAIN}`;
  const site = cleaned.endsWith(suffix) ? cleaned.slice(0, -suffix.length) : cleaned;

  if (site === DEFAULT_BASE_DOMAIN || site.includes(".")) {
    throw new CliError(`Use a ${DEFAULT_BASE_DOMAIN} subdomain, for example demo.${DEFAULT_BASE_DOMAIN}`);
  }

  if (!isValidSiteSlug(site)) {
    throw new CliError("Invalid domain. Use lowercase letters, numbers, and hyphens.");
  }

  return site;
}

export function makeDefaultSiteSlug(name: string, now = Date.now()): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "site";
  const suffix = now.toString(36).slice(-6);
  return `${base}-${suffix}`;
}

export function isValidSiteSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug);
}

export function isSafeAssetPath(assetPath: string): boolean {
  if (!assetPath || assetPath.length > 512) return false;
  if (assetPath.startsWith("/") || assetPath.includes("\\") || assetPath.includes("\0")) return false;
  return !assetPath.split("/").some((part) => !part || part === "." || part === "..");
}
