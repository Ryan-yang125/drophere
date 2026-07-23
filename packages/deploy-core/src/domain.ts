import { BASE_DOMAIN } from "./constants";
import { DropHereError } from "./types";

export function siteFromDomain(value: string): string {
  const cleaned = value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
  const suffix = `.${BASE_DOMAIN}`;
  const site = cleaned.endsWith(suffix) ? cleaned.slice(0, -suffix.length) : cleaned;
  if (site === BASE_DOMAIN || site.includes(".")) {
    throw new DropHereError(`请输入 ${BASE_DOMAIN} 子域名，例如 my-site.${BASE_DOMAIN}。`, "invalid_site_slug");
  }
  if (!isValidSiteSlug(site)) {
    throw new DropHereError("域名只能使用小写字母、数字和连字符。", "invalid_site_slug");
  }
  return site;
}

export function isValidSiteSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug);
}

export function domainForSite(site: string): string {
  return `${site}.${BASE_DOMAIN}`;
}

export function isSafeAssetPath(assetPath: string): boolean {
  if (!assetPath || assetPath.length > 512) return false;
  if (assetPath.startsWith("/") || assetPath.includes("\\") || assetPath.includes("\0")) return false;
  return !assetPath.split("/").some((part) => !part || part === "." || part === "..");
}
