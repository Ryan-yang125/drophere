export type DropSource = "web" | "extension";

export type TrackEventOutcome = "success" | "error" | "info";

export type TrackEventInput = {
  event: string;
  outcome?: TrackEventOutcome;
  site?: string;
  error?: string;
  status?: number;
  metadata?: Record<string, unknown>;
};

export type DeployStage =
  | "idle"
  | "collecting"
  | "ready"
  | "naming"
  | "publishing"
  | "published"
  | "claiming"
  | "claimed"
  | "error";

export type BrowserFileInput = File | {
  file: File;
  path?: string;
};

export type DeployFile = {
  path: string;
  contentBase64: string;
  contentType: string;
  size: number;
  sha256: string;
};

export type PreparedDeployment = {
  entrypoint: "index.html";
  files: DeployFile[];
  fileCount: number;
  totalBytes: number;
  sourceLabel: string;
};

export type DeployMode = "guest" | "user";

export type DeployLimits = {
  maxFiles: number;
  maxFileBytes: number;
  maxDeployBytes: number;
};

export type StoredDeployConfig = {
  api?: string;
  token?: string;
  tokenApi?: string;
  email?: string;
  session?: boolean;
  sessionApi?: string;
  emailVerified?: boolean;
  planKey?: string;
  anonymousToken?: string;
  anonymousTokenApi?: string;
  anonymousSessionExpiresAt?: string;
  lastAnonymousSite?: string;
  localDeployments?: LocalDeploymentRecord[];
};

export type StorageAdapter = {
  read(): Promise<StoredDeployConfig>;
  write(config: StoredDeployConfig): Promise<void>;
};

export type ApiClientOptions = {
  api?: string;
  source: DropSource;
  storage: StorageAdapter;
  fetcher?: typeof fetch;
};

export type LoginResult = {
  token?: string;
  user: {
    email: string;
    emailVerified?: boolean;
    planKey?: string;
  };
  created?: boolean;
  session?: boolean;
};

export type UsageOverview = {
  user?: Record<string, unknown>;
  plan?: { key: string; name: string; description?: string; priceLabel?: string };
  usage?: Record<string, number>;
  limits?: Record<string, number>;
  remaining?: Record<string, number>;
  emailVerified?: boolean;
  guidance?: Record<string, unknown>;
  upgrade?: Record<string, unknown>;
  contact?: Record<string, string>;
};

export type ApiTokenSummary = {
  id: string;
  name: string;
  source?: string;
  createdAt?: string;
  lastUsedAt?: string | null;
  expiresAt?: string | null;
  revokedAt?: string | null;
  active?: boolean;
};

export type WebSessionSummary = {
  id: string;
  createdAt?: string;
  lastUsedAt?: string | null;
  expiresAt?: string;
  revokedAt?: string | null;
  current?: boolean;
};

export type DeployResult = {
  ok: true;
  site: string;
  url: string;
  version?: number;
  fileCount?: number;
  totalBytes?: number;
  temporary?: boolean;
  anonymous?: boolean;
  expiresAt?: string;
  claimable?: boolean;
};

export type ClaimResult = {
  ok: true;
  site: string;
  url: string;
  claimed: true;
  owner: {
    id?: string;
    email: string;
  };
};

export type ProjectSummary = {
  projectId?: string;
  site: string;
  domain: string;
  url: string;
  ownerUserId?: string | null;
  ownerEmail?: string | null;
  anonymousSessionId?: string | null;
  originalAnonymousSessionId?: string | null;
  temporary?: boolean;
  expiresAt?: string | null;
  claimedAt?: string | null;
  version?: number | null;
  fileCount?: number | null;
  totalBytes?: number | null;
  createdAt?: string;
  updatedAt?: string;
  deployedAt?: string | null;
};

export type DeploymentSummary = {
  deploymentId: string;
  site: string;
  domain: string;
  url: string;
  version: number;
  entrypoint: string;
  fileCount: number;
  totalBytes: number;
  createdAt: string;
};

export type FileSummary = {
  path: string;
  contentType: string;
  size: number;
  sha256?: string | null;
};

export type RenameProjectResult = {
  ok: true;
  oldSite: string;
  site: string;
  url: string;
  copiedObjects?: number;
  deletedObjects?: number;
};

export type TeardownProjectResult = {
  ok: true;
  site: string;
  deletedDeployments: number;
  deletedObjects: number;
};

export type AnonymousSession = {
  token: string;
  expiresAt: string;
};

export type LocalDeploymentSource = "web-drop" | "extension-paste" | "extension-scan" | "extension-selection" | "cli" | "unknown";

export type LocalDeploymentRecord = {
  id: string;
  site: string;
  domain: string;
  url: string;
  title?: string;
  source: LocalDeploymentSource;
  sourceLabel?: string;
  fileCount?: number;
  totalBytes?: number;
  temporary: boolean;
  expiresAt?: string;
  createdAt: string;
  claimedAt?: string;
  ownerEmail?: string;
};

export type LocalDeploymentInput = {
  source: LocalDeploymentSource;
  title?: string;
  sourceLabel?: string;
};

export class DropHereError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly body?: unknown;

  constructor(message: string, code = "drophere_error", status?: number, body?: unknown) {
    super(message);
    this.name = "DropHereError";
    this.code = code;
    this.status = status;
    this.body = body;
  }
}
