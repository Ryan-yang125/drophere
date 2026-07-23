export function formatBytes(value: number): string {
  if (!Number.isFinite(value)) return "0 B";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB"];
  let amount = value / 1024;
  for (const unit of units) {
    if (amount < 1024 || unit === "GB") return `${amount.toFixed(amount >= 10 ? 1 : 2)} ${unit}`;
    amount /= 1024;
  }
  return `${value} B`;
}

export function formatExpiry(value?: string): string {
  if (!value) return "自动过期";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function quotaLabel(key: string): string {
  const labels: Record<string, string> = {
    filesRemaining: "文件数",
    fileBytesRemaining: "单文件大小",
    deployBytesRemaining: "网站大小",
    anonymousDeploysThisHourRemaining: "本小时匿名发布次数",
    anonymousDeploysTodayRemaining: "今日匿名发布次数",
    anonymousActiveProjectsRemaining: "临时网站数量",
  };
  return labels[key] ?? key;
}

export function friendlyApiMessage(status: number, body: any): string {
  if (body?.error === "anonymous_custom_slug_requires_login") return "登录后才能自定义 DropHere 域名。";
  if (body?.error === "site_taken") return "这个 DropHere 域名已经被占用，请换一个。";
  if (body?.error === "reserved_site_slug") return "这个 DropHere 域名属于系统保留名，请换一个。";
  if (body?.error === "invalid_site_slug") return "域名只能使用小写字母、数字和连字符。";
  if (body?.error === "anonymous_project_requires_claim") return "请先把这个临时网站归属到账号，再修改域名。";
  if (body?.error === "anonymous_hourly_deploy_quota_exceeded") return "本小时游客发布次数已用完。登录后可以继续发布，或稍后再试。";
  if (body?.error === "anonymous_daily_deploy_quota_exceeded") return "这个网络今天的游客发布次数已用完。登录后可以继续发布。";
  if (body?.error === "anonymous_active_project_quota_exceeded") return "本机临时网站数量已满。请先归属到账号，或删除旧的临时网站后再试。";
  if (body?.error === "daily_deploy_quota_exceeded") return "今天的账号发布次数已用完，请明天再试，或联系小红书 krishimtech。";
  if (body?.error === "project_daily_deploy_quota_exceeded") return "这个网站今天的发布次数已用完，请明天再试，或联系小红书 krishimtech。";
  if (body?.error === "storage_quota_exceeded") return "账号存储空间不足，请删除旧网站或联系小红书 krishimtech。";
  if (body?.error === "file_too_large") return "有文件超过大小限制，请压缩后再发布。";
  if (body?.error === "deployment_too_large") return "这次发布的网站太大，请减少文件或压缩资源后再试。";
  if (body?.error === "too_many_files") return "这次发布的文件太多，请减少文件数量后再试。";
  if (body?.error === "anonymous_token_mismatch") return "这个临时网站不属于当前浏览器的游客会话，请在发布它的浏览器里归属到账号。";
  if (body?.error === "anonymous_project_expired") return "这个临时网站已经过期，不能再归属到账号。";
  if (body?.error === "user_required") return "请先登录账号再继续。";
  if (body?.error === "missing_site") return "请填写要使用的子域名。";
  if (body?.error === "site_asset_missing") return "网站文件暂时不可用，请稍后重试。";
  if (body?.error === "entrypoint_missing") return "文件夹或 zip 里需要有顶层 index.html。单个 HTML 文件可以直接上传。";
  if (status === 401) return "登录状态已失效，请重新登录后再发布。";
  if (status === 429) return "发布太频繁了，请稍后重试，或登录后继续发布。";
  if (body?.message) return String(body.message);
  return body?.error ? String(body.error) : `Request failed with HTTP ${status}.`;
}
