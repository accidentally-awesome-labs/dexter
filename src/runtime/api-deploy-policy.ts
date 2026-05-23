import { createDeploymentProvider } from "../providers/deployment/factory.js";

export function shouldRequireApiDeployFromEnv(): boolean {
  const explicit = process.env.DEXTER_REQUIRE_API_DEPLOY?.trim();
  if (explicit === "true") {
    return true;
  }
  if (explicit === "false") {
    return false;
  }
  return Boolean(process.env.DEXTER_COOLIFY_API_URL?.trim() && process.env.DEXTER_COOLIFY_TOKEN?.trim());
}

export function hasCoolifyBridgeConfigured(): boolean {
  return Boolean(process.env.DEXTER_COOLIFY_API_URL?.trim() && process.env.DEXTER_COOLIFY_TOKEN?.trim());
}

export function coolifyProviderAvailable(): boolean {
  return createDeploymentProvider("coolify") !== null;
}
