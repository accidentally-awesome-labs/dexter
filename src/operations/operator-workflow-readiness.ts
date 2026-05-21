import path from "node:path";
import fs from "fs-extra";
import { generateGoNoGoDecision } from "../release/generate-go-no-go.js";
import { buildResumeCheck } from "../core/run-selector.js";
import { findLatestRunId } from "../core/run-selector.js";
import { readPromotionHistory } from "./promotion-history.js";

export interface OperatorWorkflowReadiness {
  schemaVersion: "1.0";
  generatedAt: string;
  ready: boolean;
  releaseDecision: "GO" | "NO-GO";
  resumeAllowed: boolean;
  promotionCount: number;
  unresolvedEscalations: number;
  recommendedCommands: string[];
  artifacts: {
    opsStatus?: string;
    promotionHistory?: string;
    governanceVerification?: string;
    promotionRepeatability?: string;
  };
}

const reportJsonPath = (rootDir: string) =>
  path.join(rootDir, "artifacts", "release", "OPERATOR_WORKFLOW_READINESS.json");

export async function writeOperatorWorkflowReadiness(rootDir: string): Promise<OperatorWorkflowReadiness> {
  const decision = await generateGoNoGoDecision(rootDir);
  const latestRunId = await findLatestRunId(rootDir);
  const resume = latestRunId ? await buildResumeCheck(rootDir, latestRunId) : null;
  const history = await readPromotionHistory(rootDir);

  const opsStatusPath = path.join(rootDir, "artifacts", "execution", "OPS_STATUS.json");
  const governancePath = path.join(rootDir, "artifacts", "release", "GOVERNANCE_VERIFICATION.json");
  const repeatabilityPath = path.join(rootDir, "artifacts", "release", "PROMOTION_REPEATABILITY.json");
  const historyPath = path.join(rootDir, "artifacts", "release", "PROMOTION_HISTORY.json");

  const recommendedCommands = [
    "npm run ops:status",
    "npm run resume:check -- --latest true --output table",
    "npm run release:decision",
    "npm run governance:verify -- --minimum-promotions 3",
    "npm run promotion:pipeline",
  ];

  const ready =
    decision.decision === "GO" &&
    decision.unresolvedEscalations === 0 &&
    (resume?.resumeAllowed ?? true) &&
    history.promotions.length >= 3;

  const report: OperatorWorkflowReadiness = {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    ready,
    releaseDecision: decision.decision,
    resumeAllowed: resume?.resumeAllowed ?? true,
    promotionCount: history.promotions.length,
    unresolvedEscalations: decision.unresolvedEscalations,
    recommendedCommands,
    artifacts: {
      opsStatus: (await fs.pathExists(opsStatusPath)) ? opsStatusPath : undefined,
      promotionHistory: (await fs.pathExists(historyPath)) ? historyPath : undefined,
      governanceVerification: (await fs.pathExists(governancePath)) ? governancePath : undefined,
      promotionRepeatability: (await fs.pathExists(repeatabilityPath)) ? repeatabilityPath : undefined,
    },
  };

  await fs.ensureDir(path.dirname(reportJsonPath(rootDir)));
  await fs.writeJson(reportJsonPath(rootDir), report, { spaces: 2 });
  await fs.writeFile(
    path.join(rootDir, "artifacts", "release", "OPERATOR_WORKFLOW_READINESS.md"),
    [
      "# Operator Workflow Readiness",
      "",
      `Generated at: ${report.generatedAt}`,
      `Ready: ${report.ready}`,
      `Release decision: ${report.releaseDecision}`,
      `Resume allowed: ${report.resumeAllowed}`,
      `Promotion count: ${report.promotionCount}`,
      `Unresolved escalations: ${report.unresolvedEscalations}`,
      "",
      "## Recommended Commands",
      ...report.recommendedCommands.map((cmd) => `- ${cmd}`),
      "",
    ].join("\n"),
  );

  return report;
}
