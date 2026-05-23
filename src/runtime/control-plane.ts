import type { DeployAuthorization } from "../deploy/authorization.js";
import {
  consumeDeployNonce,
  isDeployAuthorizationRevoked,
  verifyDeployAuthorization,
  verifyDeployAuthorizationPolicy,
  verifyDeployAuthorizationScope,
} from "../deploy/authorization.js";
import path from "node:path";
import fs from "fs-extra";
import { spawn } from "node:child_process";
import { createDeploymentProvider } from "../providers/deployment/factory.js";
import { loadDeployManifest } from "../release/deploy-manifest.js";

export interface ControlPlaneAdapter {
  id: "coolify" | "dokploy" | "dokku";
  deploy(
    appName: string,
    authorization: DeployAuthorization,
    scope: { environment: string; tenantId: string },
  ): Promise<{ deploymentId: string; status: "ok"; mode: "api" | "hook" | "simulated" }>;
  rollback(appName: string): Promise<{ rollbackId: string; status: "ok"; mode: "api" | "hook" | "simulated" }>;
}

class BaseAdapter implements ControlPlaneAdapter {
  constructor(
    public id: "coolify" | "dokploy" | "dokku",
    private readonly rootDir: string,
  ) {}

  private async runApi(
    action: "deploy" | "rollback",
    appName: string,
    authorizationToken?: string,
    deployOptions?: {
      deployTag?: string;
      force?: boolean;
      image?: string;
      tag?: string;
      syncManifestImage?: boolean;
    },
  ): Promise<string | null> {
    const provider = createDeploymentProvider(this.id);
    if (!provider) {
      return null;
    }
    const response = await provider.execute({
      action,
      appName,
      provider: this.id,
      authorizationToken,
      deployTag: deployOptions?.deployTag,
      force: deployOptions?.force,
      image: deployOptions?.image,
      tag: deployOptions?.tag,
      syncManifestImage: deployOptions?.syncManifestImage,
    });
    if (!response) {
      return null;
    }
    return response.id;
  }

  private async runHook(hook: "deploy" | "rollback", appName: string): Promise<boolean> {
    const script = path.join(this.rootDir, "infra", this.id, "hooks", `${hook}.sh`);
    if (!(await fs.pathExists(script))) {
      return false;
    }

    const result = await new Promise<number>((resolve) => {
      const child = spawn("sh", [script, appName], { stdio: "ignore" });
      child.on("close", (code) => resolve(code ?? 1));
    });
    return result === 0;
  }

  async deploy(
    appName: string,
    authorization: DeployAuthorization,
    scope: { environment: string; tenantId: string },
  ): Promise<{ deploymentId: string; status: "ok"; mode: "api" | "hook" | "simulated" }> {
    if (!verifyDeployAuthorization(appName, authorization)) {
      throw new Error("Invalid deployment authorization.");
    }
    if (!verifyDeployAuthorizationScope(authorization, {
      environment: scope.environment,
      controlPlane: this.id,
      tenantId: scope.tenantId,
    })) {
      throw new Error("Deployment authorization scope mismatch.");
    }
    const policyOk = await verifyDeployAuthorizationPolicy(this.rootDir, authorization, scope.environment);
    if (!policyOk) {
      throw new Error("Deployment authorization policy check failed.");
    }
    const revoked = await isDeployAuthorizationRevoked(this.rootDir, authorization);
    if (revoked) {
      throw new Error("Deployment authorization has been revoked.");
    }
    const nonceOk = await consumeDeployNonce(this.rootDir, authorization);
    if (!nonceOk) {
      throw new Error("Deployment authorization nonce replay detected.");
    }

    const authToken = Buffer.from(JSON.stringify(authorization)).toString("base64");
    const manifest = await loadDeployManifest();
    const useManifest = process.env.DEXTER_DEPLOY_USE_MANIFEST_TAG === "true";
    const syncManifest = process.env.DEXTER_DEPLOY_SYNC_MANIFEST === "true" || useManifest;
    const apiId = await this.runApi("deploy", appName, authToken, {
      deployTag: useManifest ? manifest?.deployTag : undefined,
      force: manifest?.coolify.force ?? true,
      image: syncManifest ? manifest?.image : undefined,
      tag: syncManifest ? manifest?.deployTag : undefined,
      syncManifestImage: syncManifest && Boolean(manifest?.image && manifest?.deployTag),
    });
    if (apiId) {
      return {
        deploymentId: apiId,
        status: "ok",
        mode: "api",
      };
    }

    const usedHook = await this.runHook("deploy", appName);
    return {
      deploymentId: `${this.id}-${appName}-deploy`,
      status: "ok",
      mode: usedHook ? "hook" : "simulated",
    };
  }

  async rollback(appName: string): Promise<{ rollbackId: string; status: "ok"; mode: "api" | "hook" | "simulated" }> {
    const apiId = await this.runApi("rollback", appName);
    if (apiId) {
      return {
        rollbackId: apiId,
        status: "ok",
        mode: "api",
      };
    }

    const usedHook = await this.runHook("rollback", appName);
    return {
      rollbackId: `${this.id}-${appName}-rollback`,
      status: "ok",
      mode: usedHook ? "hook" : "simulated",
    };
  }
}

export function createControlPlaneAdapter(
  rootDir: string,
  id: "coolify" | "dokploy" | "dokku",
): ControlPlaneAdapter {
  return new BaseAdapter(id, rootDir);
}
