import path from "node:path";
import fs from "fs-extra";
import type { IdeaInput, PlanArtifact, PolicyDecision } from "../protocols/types.js";
import { createApprovalRecord, isApprovalValid } from "./approval.js";
import { computePlanningSignatureDigest } from "../planning/signature.js";

const blockedConstraintPatterns = [/skip[-_ ]?security/i, /disable[-_ ]?tests/i, /no[-_ ]?rollback/i];

interface PolicyGateInput {
  rootDir: string;
  idea: IdeaInput;
  plan: PlanArtifact;
  controlPlane: "coolify" | "dokploy" | "dokku";
}

async function hasApproval(rootDir: string, project: string): Promise<boolean> {
  const planDigest = await computePlanningSignatureDigest(rootDir);
  if (!planDigest) {
    return false;
  }
  const signingKey = process.env.DEXTER_APPROVAL_SIGNING_KEY ?? "dexter-dev-signing-key";
  if (process.env.DEXTER_AUTO_APPROVE_HITL === "true") {
    const approvalsPath = path.join(rootDir, "state", project, "approvals.json");
    await fs.ensureDir(path.dirname(approvalsPath));
    await fs.writeJson(
      approvalsPath,
      createApprovalRecord(project, planDigest, signingKey, {
        ttlMinutes: 120,
        source: "auto-env",
        approvedBy: "dexter-auto-env",
      }),
      { spaces: 2 },
    );
    return true;
  }

  const approvalsPath = path.join(rootDir, "state", project, "approvals.json");
  if (!(await fs.pathExists(approvalsPath))) {
    return false;
  }

  const data = await fs.readJson(approvalsPath);
  return isApprovalValid(project, planDigest, data, signingKey);
}

function findConstraintBlockers(constraints: string[]): string[] {
  const blockers: string[] = [];
  for (const constraint of constraints) {
    if (blockedConstraintPatterns.some((pattern) => pattern.test(constraint))) {
      blockers.push(`Disallowed constraint detected: "${constraint}"`);
    }
  }
  return blockers;
}

export async function evaluatePolicyGate(input: PolicyGateInput): Promise<PolicyDecision> {
  const blockers: string[] = [];
  blockers.push(...findConstraintBlockers(input.idea.constraints));

  const hitlTasks = input.plan.tasks.filter((task) => task.mode === "HITL");
  if (hitlTasks.length > 0) {
    const approved = await hasApproval(input.rootDir, input.idea.project);
    if (!approved) {
      blockers.push(
        `HITL tasks present (${hitlTasks.map((task) => task.id).join(", ")}) but no valid signed approval found at state/${input.idea.project}/approvals.json.`,
      );
    }
  }

  const rollbackHook = path.join(input.rootDir, "infra", input.controlPlane, "hooks", "rollback.sh");
  if (!(await fs.pathExists(rollbackHook))) {
    blockers.push(`Missing rollback hook: ${rollbackHook}`);
  }

  const deployHook = path.join(input.rootDir, "infra", input.controlPlane, "hooks", "deploy.sh");
  if (!(await fs.pathExists(deployHook))) {
    blockers.push(`Missing deploy hook: ${deployHook}`);
  }

  return {
    approved: blockers.length === 0,
    blockers,
    requiredRollbackChecks: [
      "Rollback hook file exists",
      "HITL approval present when required",
      "Disallowed constraints absent",
    ],
  };
}
