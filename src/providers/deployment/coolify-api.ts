import type { DeploymentProvider, DeploymentRequest, DeploymentResponse } from "./types.js";

export class CoolifyApiProvider implements DeploymentProvider {
  constructor(
    private readonly endpoint: string,
    private readonly token: string,
  ) {}

  async execute(request: DeploymentRequest): Promise<DeploymentResponse | null> {
    if (!this.endpoint || !this.token) {
      return null;
    }

    const response = await fetch(`${this.endpoint.replace(/\/$/, "")}/${request.action}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        provider: request.provider,
        appName: request.appName,
        authorizationToken: request.authorizationToken ?? null,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as { id?: string; status?: "ok" };
    return {
      id: payload.id ?? `${request.provider}-${request.appName}-${request.action}`,
      status: "ok",
    };
  }
}
