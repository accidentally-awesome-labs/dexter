import path from "node:path";
import fs from "fs-extra";
import { writeOpsStatusArtifact } from "../core/ops-status.js";
import { findLatestRunId } from "../core/run-selector.js";
import { generateGoNoGoDecision } from "../release/generate-go-no-go.js";
import { verifyGovernance } from "./governance-verify.js";
import { assertPromotionAllowed } from "./promotion-gate.js";
import { appendAuditLogEvent } from "./audit-log.js";

export interface ReleaseCommandCenterStep {
  id: string;
  status: "pass" | "fail" | "warn";
  detail: string;
}

export interface ReleaseCommandCenterReport {
  schemaVersion: "1.0";
  generatedAt: string;
  readyForPromotion: boolean;
  releaseDecision: "GO" | "NO-GO";
  governancePassed: boolean;
  unresolvedEscalations: number;
  waiverSummary: { waived: number; open: number; inProgress: number };
  promotionAuth: {
    stagingAllowed: boolean;
    prodAllowed: boolean;
    detail: string;
  };
  steps: ReleaseCommandCenterStep[];
  recommendedCommands: string[];
  artifacts: {
    opsStatus?: string;
    releaseDecision?: string;
    governanceVerification?: string;
    auditLog?: string;
    reportJson: string;
    reportMarkdown: string;
  };
}

const reportJsonPath = (rootDir: string) =>
  path.join(rootDir, "artifacts", "release", "RELEASE_COMMAND_CENTER.json");
const reportMarkdownPath = (rootDir: string) =>
  path.join(rootDir, "artifacts", "release", "RELEASE_COMMAND_CENTER.md");

async function readEscalationSummary(rootDir: string): Promise<{
  unresolved: number;
  waived: number;
  open: number;
  inProgress: number;
}> {
  const statePath = path.join(rootDir, "artifacts", "execution", "ESCALATION_STATE.json");
  if (!(await fs.pathExists(statePath))) {
    return { unresolved: 0, waived: 0, open: 0, inProgress: 0 };
  }
  const items = ((await fs.readJson(statePath)) as { items?: Array<{ status: string }> }).items ?? [];
  const open = items.filter((item) => item.status === "open").length;
  const inProgress = items.filter((item) => item.status === "in_progress").length;
  const waived = items.filter((item) => item.status === "waived").length;
  return {
    unresolved: open + inProgress,
    waived,
    open,
    inProgress,
  };
}

export async function runReleaseCommandCenter(
  rootDir: string,
  options?: { minimumPromotions?: number; actor?: string },
): Promise<ReleaseCommandCenterReport> {
  const steps: ReleaseCommandCenterStep[] = [];
  const minimumPromotions = options?.minimumPromotions ?? 2;
  const actor = options?.actor ?? "dexter-release-manager";

  const latestRunId = await findLatestRunId(rootDir);
  let opsStatusPath: string | undefined;
  if (latestRunId) {
    const ops = await writeOpsStatusArtifact({
      rootDir,
      runDir: path.join(rootDir, "runs", latestRunId),
      runId: latestRunId,
    });
    opsStatusPath = ops.jsonPath;
    steps.push({
      id: "ops_status",
      status: "pass",
      detail: `OPS_STATUS refreshed for ${latestRunId}`,
    });
  } else {
    steps.push({
      id: "ops_status",
      status: "warn",
      detail: "No runs found; OPS_STATUS not refreshed.",
    });
  }

  const decision = await generateGoNoGoDecision(rootDir);
  const releaseDecisionPath = path.join(rootDir, "artifacts", "release", "GO_NO_GO.json");
  steps.push({
    id: "release_decision",
    status: decision.decision === "GO" ? "pass" : "fail",
    detail: `decision=${decision.decision}, unresolved=${decision.unresolvedEscalations}`,
  });

  const escalationSummary = await readEscalationSummary(rootDir);
  steps.push({
    id: "escalation_inventory",
    status: escalationSummary.unresolved === 0 ? "pass" : "fail",
    detail: `open=${escalationSummary.open}, in_progress=${escalationSummary.inProgress}, waived=${escalationSummary.waived}`,
  });

  const governance = await verifyGovernance({ rootDir, minimumPromotions });
  const governancePath = path.join(rootDir, "artifacts", "release", "GOVERNANCE_VERIFICATION.json");
  steps.push({
    id: "governance_verify",
    status: governance.passed ? "pass" : "fail",
    detail: governance.checks.map((check) => `${check.name}=${check.passed}`).join("; "),
  });

  let stagingAllowed = false;
  let prodAllowed = false;
  let promotionDetail = "";
  try {
    await assertPromotionAllowed({
      rootDir,
      targetEnvironment: "staging",
      controlPlane: "coolify",
      approvedBy: actor,
      approverRole: "operator",
    });
    stagingAllowed = true;
  } catch (error) {
    promotionDetail = error instanceof Error ? error.message : "staging promotion blocked";
  }

  try {
    await assertPromotionAllowed({
      rootDir,
      targetEnvironment: "prod",
      controlPlane: "coolify",
      approvedBy: actor,
      approverRole: "release-manager",
    });
    prodAllowed = true;
    if (!promotionDetail) {
      promotionDetail = "staging and prod promotion checks passed policy gates";
    } else {
      promotionDetail = `${promotionDetail}; prod blocked`;
    }
  } catch (error) {
    const prodReason = error instanceof Error ? error.message : "prod promotion blocked";
    promotionDetail = promotionDetail ? `${promotionDetail}; ${prodReason}` : prodReason;
  }

  steps.push({
    id: "promotion_auth",
    status: prodAllowed ? "pass" : stagingAllowed ? "warn" : "fail",
    detail: promotionDetail,
  });

  const readyForPromotion =
    decision.decision === "GO" &&
    governance.passed &&
    escalationSummary.unresolved === 0 &&
    (prodAllowed || stagingAllowed);

  const recommendedCommands = [
    "npm run release:center",
    "npm run ops:status",
    "npm run release:decision",
    "npm run escalation:list -- --output table",
    `npm run governance:verify -- --minimum-promotions ${minimumPromotions}`,
    "npm run promotion:pipeline",
  ];
  if (!readyForPromotion) {
    recommendedCommands.unshift("npm run resume:check -- --latest true --triage true --output table");
  }

  const audit = await appendAuditLogEvent(rootDir, {
    actor,
    action: "release_command_center",
    scope: "release",
    reason: readyForPromotion ? "center_ready" : "center_blocked",
    runId: latestRunId ?? "",
    metadata: {
      releaseDecision: decision.decision,
      governancePassed: governance.passed,
      unresolvedEscalations: escalationSummary.unresolved,
      stagingAllowed,
      prodAllowed,
    },
  });

  const report: ReleaseCommandCenterReport = {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    readyForPromotion,
    releaseDecision: decision.decision,
    governancePassed: governance.passed,
    unresolvedEscalations: escalationSummary.unresolved,
    waiverSummary: {
      waived: escalationSummary.waived,
      open: escalationSummary.open,
      inProgress: escalationSummary.inProgress,
    },
    promotionAuth: {
      stagingAllowed,
      prodAllowed,
      detail: promotionDetail,
    },
    steps,
    recommendedCommands,
    artifacts: {
      opsStatus: opsStatusPath,
      releaseDecision: (await fs.pathExists(releaseDecisionPath)) ? releaseDecisionPath : undefined,
      governanceVerification: governancePath,
      auditLog: audit.path,
      reportJson: reportJsonPath(rootDir),
      reportMarkdown: reportMarkdownPath(rootDir),
    },
  };

  await fs.ensureDir(path.dirname(reportJsonPath(rootDir)));
  await fs.writeJson(reportJsonPath(rootDir), report, { spaces: 2 });
  await fs.writeFile(
    reportMarkdownPath(rootDir),
    [
      "# Release Command Center",
      "",
      `Generated at: ${report.generatedAt}`,
      `Ready for promotion: ${report.readyForPromotion}`,
      `Release decision: ${report.releaseDecision}`,
      `Governance passed: ${report.governancePassed}`,
      `Unresolved escalations: ${report.unresolvedEscalations}`,
      "",
      "## Steps",
      ...report.steps.map((step) => `- [${step.status}] ${step.id}: ${step.detail}`),
      "",
      "## Recommended Commands",
      ...report.recommendedCommands.map((cmd) => `- ${cmd}`),
      "",
    ].join("\n"),
  );

  return report;
}
