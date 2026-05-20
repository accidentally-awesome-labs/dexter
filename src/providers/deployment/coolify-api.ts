import type { DeploymentAction, DeploymentProvider, DeploymentRequest, DeploymentResponse } from "./types.js";

export interface HttpDeploymentProviderConfig {
  endpoint: string;
  token: string;
  deployPath?: string;
  rollbackPath?: string;
}

export class CoolifyApiProvider implements DeploymentProvider {
  private readonly endpoint: string;
  private readonly token: string;
  private readonly actionPath: Record<DeploymentAction, string>;

  constructor(config: HttpDeploymentProviderConfig) {
    this.endpoint = config.endpoint.replace(/\/$/, "");
    this.token = config.token;
    this.actionPath = {
      deploy: config.deployPath ?? "/deploy",
      rollback: config.rollbackPath ?? "/rollback",
    };
  }

  async execute(request: DeploymentRequest): Promise<DeploymentResponse | null> {
    if (!this.endpoint || !this.token || !this.actionPath[request.action]) {
      return null;
    }

    const actionPath = this.actionPath[request.action].startsWith("/")
      ? this.actionPath[request.action]
      : `/${this.actionPath[request.action]}`;
    const response = await fetch(`${this.endpoint}${actionPath}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        provider: request.provider,
        appName: request.appName,
        action: request.action,
        requestedAt: new Date().toISOString(),
        authorizationToken: request.authorizationToken ?? null,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      id?: string;
      deploymentId?: string;
      rollbackId?: string;
      revision?: string;
      status?: "ok";
      [key: string]: unknown;
    };
    const id = payload.id ?? payload.deploymentId ?? payload.rollbackId ?? `${request.provider}-${request.appName}-${request.action}`;
    return {
      id,
      status: "ok",
      revision: payload.revision,
      raw: payload,
    };
  }
}
