export type DeploymentAction = "deploy" | "rollback";

export interface DeploymentRequest {
  provider: "coolify" | "dokploy" | "dokku";
  appName: string;
  action: DeploymentAction;
  authorizationToken?: string;
}

export interface DeploymentResponse {
  id: string;
  status: "ok";
}

export interface DeploymentProvider {
  execute(request: DeploymentRequest): Promise<DeploymentResponse | null>;
}
