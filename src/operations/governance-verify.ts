import path from "node:path";
import fs from "fs-extra";
import { listEscalationLifecycle } from "../supervisor/escalation-lifecycle.js";
import { DEFAULT_PROMOTION_STAGES } from "./run-promotion-pipeline.js";
import { readPromotionHistory, promotionArchivePath } from "./promotion-history.js";
import type { PromotionPipelineManifest } from "./run-promotion-pipeline.js";

interface RbacPolicy {
  constraints: {
    waiverMetadataRequired: string[];
    disallowExpiredWaivers: boolean;
  };
}

export interface GovernanceCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface GovernanceVerificationReport {
  schemaVersion: "1.0";
  generatedAt: string;
  passed: boolean;
  checks: GovernanceCheck[];
}

const reportJsonPath = (rootDir: string) => path.join(rootDir, "artifacts", "release", "GOVERNANCE_VERIFICATION.json");
const reportMarkdownPath = (rootDir: string) => path.join(rootDir, "artifacts", "release", "GOVERNANCE_VERIFICATION.md");

async function loadRbacPolicy(rootDir: string): Promise<RbacPolicy> {
  const policyPath = path.join(rootDir, "docs", "operations", "RBAC_POLICY.json");
  return (await fs.readJson(policyPath)) as RbacPolicy;
}

async function verifyEscalationWaivers(rootDir: string, requiredFields: string[]): Promise<GovernanceCheck[]> {
  const checks: GovernanceCheck[] = [];
  const statePath = path.join(rootDir, "artifacts", "execution", "ESCALATION_STATE.json");
  if (!(await fs.pathExists(statePath))) {
    checks.push({
      name: "escalation_state_present",
      passed: true,
      detail: "No escalation state file; treated as no unresolved governance debt.",
    });
    return checks;
  }

  const lifecycle = await listEscalationLifecycle({ rootDir, unresolvedOnly: false });
  const waived = lifecycle.items.filter((item) => item.status === "waived");
  const unresolved = lifecycle.items.filter((item) => item.status === "open" || item.status === "in_progress");
  const unresolvedOperatorHigh = unresolved.filter((item) => item.target === "operator" && item.priority === "high");

  for (const item of waived) {
    const missing = requiredFields.filter((field) => {
      const waiver = item.waiver as Record<string, string> | undefined;
      return !waiver?.[field]?.trim();
    });
    checks.push({
      name: `waiver_metadata_${item.key}`,
      passed: missing.length === 0,
      detail:
        missing.length === 0
          ? "Waiver metadata complete."
          : `Missing waiver fields: ${missing.join(", ")}`,
    });
    if (item.waiver?.expiresAt) {
      const expired = Date.parse(item.waiver.expiresAt) <= Date.now();
      checks.push({
        name: `waiver_expiry_${item.key}`,
        passed: !expired,
        detail: expired ? "Waiver is expired." : "Waiver expiry is in the future.",
      });
    }
  }

  checks.push({
    name: "unresolved_operator_high",
    passed: unresolvedOperatorHigh.length === 0,
    detail:
      unresolvedOperatorHigh.length === 0
        ? "No unresolved operator-high escalations."
        : `${unresolvedOperatorHigh.length} unresolved operator-high escalations remain.`,
  });

  checks.push({
    name: "unresolved_escalations",
    passed: unresolved.length === 0,
    detail:
      unresolved.length === 0
        ? "No unresolved escalations."
        : `${unresolved.length} unresolved escalations remain.`,
  });

  return checks;
}

async function verifyPromotionConsistency(rootDir: string, minimumPromotions: number): Promise<GovernanceCheck[]> {
  const checks: GovernanceCheck[] = [];
  const history = await readPromotionHistory(rootDir);

  checks.push({
    name: "promotion_history_count",
    passed: history.promotions.length >= minimumPromotions,
    detail: `Promotion history contains ${history.promotions.length} entries (required >= ${minimumPromotions}).`,
  });

  const expectedStages = DEFAULT_PROMOTION_STAGES.map((stage) => stage.environment);
  const expectedRoles = DEFAULT_PROMOTION_STAGES.map((stage) => stage.approverRole);

  for (const entry of history.promotions) {
    const archivePath = promotionArchivePath(rootDir, entry.promotionId);
    if (!(await fs.pathExists(archivePath))) {
      checks.push({
        name: `promotion_archive_${entry.promotionId}`,
        passed: false,
        detail: `Archived manifest missing: ${archivePath}`,
      });
      continue;
    }
    const manifest = (await fs.readJson(archivePath)) as PromotionPipelineManifest;
    const stageEnvs = manifest.stages.map((stage) => stage.environment);
    const stageRoles = manifest.stages.map((stage) => stage.approverRole);
    const stagesMatch =
      stageEnvs.length === expectedStages.length && stageEnvs.every((env, idx) => env === expectedStages[idx]);
    const rolesMatch =
      stageRoles.length === expectedRoles.length && stageRoles.every((role, idx) => role === expectedRoles[idx]);

    checks.push({
      name: `promotion_stage_policy_${entry.promotionId}`,
      passed: stagesMatch && rolesMatch,
      detail: stagesMatch && rolesMatch
        ? "Stage order and approver roles match policy."
        : `Stage/role mismatch. stages=${stageEnvs.join("->")}, roles=${stageRoles.join(",")}`,
    });
    checks.push({
      name: `promotion_audit_trail_${entry.promotionId}`,
      passed: manifest.audit.eventsDelta > 0 && manifest.audit.pipelineActions.length >= 3,
      detail: `Audit delta=${manifest.audit.eventsDelta}, actions=${manifest.audit.pipelineActions.length}`,
    });
  }

  return checks;
}

export async function verifyGovernance(options: {
  rootDir: string;
  minimumPromotions?: number;
}): Promise<GovernanceVerificationReport> {
  const rbac = await loadRbacPolicy(options.rootDir);
  const checks: GovernanceCheck[] = [
    ...(await verifyEscalationWaivers(options.rootDir, rbac.constraints.waiverMetadataRequired)),
    ...(await verifyPromotionConsistency(options.rootDir, options.minimumPromotions ?? 1)),
  ];
  const passed = checks.every((check) => check.passed);
  const report: GovernanceVerificationReport = {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    passed,
    checks,
  };

  await fs.ensureDir(path.dirname(reportJsonPath(options.rootDir)));
  await fs.writeJson(reportJsonPath(options.rootDir), report, { spaces: 2 });
  await fs.writeFile(
    reportMarkdownPath(options.rootDir),
    [
      "# Governance Verification",
      "",
      `Generated at: ${report.generatedAt}`,
      `Passed: ${report.passed}`,
      "",
      "## Checks",
      ...report.checks.map((check) => `- [${check.passed ? "x" : " "}] ${check.name}: ${check.detail}`),
      "",
    ].join("\n"),
  );

  return report;
}
