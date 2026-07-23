import type { DeployLimits } from "./types";

export const DEFAULT_API = "https://api.drophere.page";
export const BASE_DOMAIN = "drophere.page";

export const GUEST_LIMITS: DeployLimits = {
  maxFiles: 200,
  maxFileBytes: 2 * 1024 * 1024,
  maxDeployBytes: 10 * 1024 * 1024,
};

export const USER_LIMITS: DeployLimits = {
  maxFiles: 1000,
  maxFileBytes: 5 * 1024 * 1024,
  maxDeployBytes: 25 * 1024 * 1024,
};

export const stageLabels: Record<string, string> = {
  idle: "选择文件",
  collecting: "读取文件中",
  ready: "准备发布",
  naming: "填写域名",
  publishing: "发布中",
  published: "发布成功",
  claiming: "归属账号中",
  claimed: "已归属",
  error: "需要处理",
};
