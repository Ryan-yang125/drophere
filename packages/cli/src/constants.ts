import os from "node:os";
import path from "node:path";

export const VERSION = "1.0.1";
export const DEFAULT_API = "https://api.drophere.page";
export const DEFAULT_BASE_DOMAIN = "drophere.page";
export const USER_CONFIG_PATH = path.join(os.homedir(), ".config", "drophere", "config.json");

export const MANAGEMENT_COMMANDS = new Set([
  "list",
  "files",
  "teardown",
  "rename",
  "guest",
  "claim",
  "verify-email",
  "login",
  "logout",
  "whoami",
  "doctor",
  "token",
  "quota",
  "usage",
  "contact"
]);
