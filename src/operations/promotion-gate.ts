import path from "node:path";
import fs from "fs-extra";
import { verifyDeployAuthorizationPolicy } from "../deploy/authorization.js";
import type { DeployAuthorization } from "../deploy/authorization.js";
import { readCanaryGateStatus } from "./canary-gate.js";

type ApproverRole = "operator" | "release-manager" | "security" | "observer";

interface RbacPolicy {
  roles: Record<
    ApproverRole,
    {
      canApprovePromotion: string[];
    }
  >;
  promotionApprovalPolicy: Record<
    string,
    {
      requiredApprovers: ApproverRole[];
      minimumCount: number;
    }
  >;
}

interface DeployAuthPolicy {
  allowCrossEnvironment: boolean;
  allowedTransitions: Array<{ from: string; to: string }>;
  controlPlaneByEnvironment: Record<string, Array<"coolify" | "dokploy" | "dokku">>;
}

const DEFAULT_SOURCE_BY_TARGET: Record<string, string> = {
  staging: "dev",
  canary: "staging",
  prod: "canary",
  production: "canary",
};

export function normalizeEnvironment(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "development") {
    return "dev";
  }
  if (normalized === "production") {
    return "prod";
  }
  return normalized;
}

function defaultSourceEnvironment(targetEnvironment: string): string {
  const target = normalizeEnvironment(targetEnvironment);
  return DEFAULT_SOURCE_BY_TARGET[target] ?? target;
}

async function loadRbacPolicy(rootDir: string): Promise<RbacPolicy> {
  const policyPath = path.join(rootDir, "docs", "operations", "RBAC_POLICY.json");
  if (!(await fs.pathExists(policyPath))) {
    throw new Error(`RBAC policy not found: ${policyPath}`);
  }
  return (await fs.readJson(policyPath)) as RbacPolicy;
}

async function loadDeployAuthPolicy(rootDir: string): Promise<DeployAuthPolicy> {
  const policyPath = path.join(rootDir, "docs", "specs", "DEPLOY_AUTH_POLICY.json");
  if (!(await fs.pathExists(policyPath))) {
    throw new Error(`Deploy auth policy not found: ${policyPath}`);
  }
  return (await fs.readJson(policyPath)) as DeployAuthPolicy;
}

function resolveApproverRole(options: {
  approverRole?: string;
  approvedBy?: string;
  targetEnvironment: string;
}): ApproverRole {
  const explicit = options.approverRole?.trim().toLowerCase();
  if (explicit && ["operator", "release-manager", "security", "observer"].includes(explicit)) {
    return explicit as ApproverRole;
  }
  const approvedBy = (options.approvedBy ?? "").toLowerCase();
  if (approvedBy.includes("security")) {
    return "security";
  }
  if (approvedBy.includes("release")) {
    return "release-manager";
  }
  if (approvedBy.includes("operator") || approvedBy.includes("ops")) {
    return "operator";
  }
  const target = normalizeEnvironment(options.targetEnvironment);
  if (target === "staging" || target === "dev") {
    return "operator";
  }
  return "release-manager";
}

export async function assertPromotionAllowed(options: {
  rootDir: string;
  targetEnvironment: string;
  sourceEnvironment?: string;
  controlPlane: "coolify" | "dokploy" | "dokku";
  approvedBy: string;
  approverRole?: string;
  tenantId?: string;
}): Promise<{
  sourceEnvironment: string;
  targetEnvironment: string;
  approverRole: ApproverRole;
}> {
  const targetEnvironment = normalizeEnvironment(options.targetEnvironment);
  const sourceEnvironment = normalizeEnvironment(
    options.sourceEnvironment ?? defaultSourceEnvironment(targetEnvironment),
  );
  const approverRole = resolveApproverRole({
    approverRole: options.approverRole,
    approvedBy: options.approvedBy,
    targetEnvironment,
  });

  const rbac = await loadRbacPolicy(options.rootDir);
  const rolePolicy = rbac.roles[approverRole];
  if (!rolePolicy) {
    throw new Error(`Unknown approver role: ${approverRole}`);
  }
  if (!rolePolicy.canApprovePromotion.map(normalizeEnvironment).includes(targetEnvironment)) {
    throw new Error(
      `Promotion blocked by RBAC: role ${approverRole} cannot approve promotion to ${targetEnvironment}.`,
    );
  }

  const promotionPolicy = rbac.promotionApprovalPolicy[targetEnvironment];
  if (!promotionPolicy) {
    throw new Error(`Promotion blocked: no RBAC promotion policy defined for ${targetEnvironment}.`);
  }
  if (!promotionPolicy.requiredApprovers.includes(approverRole)) {
    throw new Error(
      `Promotion blocked by RBAC: ${targetEnvironment} requires one of [${promotionPolicy.requiredApprovers.join(", ")}].`,
    );
  }

  const deployPolicy = await loadDeployAuthPolicy(options.rootDir);
  const transitionAllowed = deployPolicy.allowedTransitions.some(
    (transition) =>
      normalizeEnvironment(transition.from) === sourceEnvironment &&
      normalizeEnvironment(transition.to) === targetEnvironment,
  );
  if (sourceEnvironment !== targetEnvironment && !transitionAllowed) {
    throw new Error(
      `Promotion blocked: transition ${sourceEnvironment} -> ${targetEnvironment} is not allowed by deploy auth policy.`,
    );
  }

  const allowedControlPlanes = deployPolicy.controlPlaneByEnvironment[targetEnvironment] ?? [];
  if (!allowedControlPlanes.includes(options.controlPlane)) {
    throw new Error(
      `Promotion blocked: control plane ${options.controlPlane} is not authorized for ${targetEnvironment}.`,
    );
  }

  if (targetEnvironment === "prod") {
    const canaryGate = await readCanaryGateStatus(options.rootDir);
    if (!canaryGate.present) {
      throw new Error("Promotion blocked: canary gate artifact is missing. Promote to canary and pass SLO gates first.");
    }
    if (canaryGate.expired) {
      throw new Error("Promotion blocked: canary gate artifact expired. Re-run canary promotion and SLO evaluation.");
    }
    if (!canaryGate.prodPromotionAllowed) {
      throw new Error("Promotion blocked: canary gates failed. Resolve canary SLO breaches before prod promotion.");
    }
  }

  return {
    sourceEnvironment,
    targetEnvironment,
    approverRole,
  };
}

export async function verifyPromotionAuthPolicy(
  rootDir: string,
  auth: DeployAuthorization,
  targetEnvironment: string,
): Promise<boolean> {
  return verifyDeployAuthorizationPolicy(rootDir, auth, normalizeEnvironment(targetEnvironment));
}
