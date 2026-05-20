import type { DeploymentProvider, DeploymentProviderId } from "./types.js";
import { CoolifyApiProvider } from "./coolify-api.js";

interface ProviderEnvConfig {
  endpoint?: string;
  token?: string;
  deployPath?: string;
  rollbackPath?: string;
}

function readProviderConfig(provider: DeploymentProviderId): ProviderEnvConfig {
  const upper = provider.toUpperCase();
  return {
    endpoint:
      process.env[`DEXTER_${upper}_API_URL`] ??
      process.env[`DEXTER_${upper}_ENDPOINT`] ??
      (provider === "coolify" ? process.env.DEXTER_CONTROL_PLANE_ENDPOINT : undefined),
    token:
      process.env[`DEXTER_${upper}_TOKEN`] ??
      process.env[`DEXTER_${upper}_API_TOKEN`] ??
      (provider === "coolify" ? process.env.DEXTER_CONTROL_PLANE_TOKEN : undefined),
    deployPath: process.env[`DEXTER_${upper}_DEPLOY_PATH`] ?? process.env.DEXTER_CONTROL_PLANE_DEPLOY_PATH,
    rollbackPath: process.env[`DEXTER_${upper}_ROLLBACK_PATH`] ?? process.env.DEXTER_CONTROL_PLANE_ROLLBACK_PATH,
  };
}

export function createDeploymentProvider(provider: DeploymentProviderId): DeploymentProvider | null {
  const config = readProviderConfig(provider);
  if (!config.endpoint || !config.token) {
    return null;
  }

  return new CoolifyApiProvider({
    endpoint: config.endpoint,
    token: config.token,
    deployPath: config.deployPath,
    rollbackPath: config.rollbackPath,
  });
}
