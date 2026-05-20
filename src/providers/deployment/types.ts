export type DeploymentAction = "deploy" | "rollback";
export type DeploymentProviderId = "coolify" | "dokploy" | "dokku";

export interface DeploymentRequest {
  provider: DeploymentProviderId;
  appName: string;
  action: DeploymentAction;
  authorizationToken?: string;
}

export interface DeploymentResponse {
  id: string;
  status: "ok";
  revision?: string;
  raw?: Record<string, unknown>;
}

export interface DeploymentProvider {
  execute(request: DeploymentRequest): Promise<DeploymentResponse | null>;
}
