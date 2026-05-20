import type { DeploymentProvider } from "./types.js";
import { CoolifyApiProvider } from "./coolify-api.js";

export function createDeploymentProvider(): DeploymentProvider | null {
  const endpoint = process.env.DEXTER_CONTROL_PLANE_ENDPOINT;
  const token = process.env.DEXTER_CONTROL_PLANE_TOKEN;
  if (!endpoint || !token) {
    return null;
  }

  return new CoolifyApiProvider(endpoint, token);
}
