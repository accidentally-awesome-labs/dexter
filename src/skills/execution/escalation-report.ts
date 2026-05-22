import path from "node:path";
import fs from "fs-extra";
import type { ExecutionResult } from "../../protocols/types.js";
import {
  buildRegressionRemediation,
  loadRegressionRemediationPolicy,
  writeRegressionPreventionIndex,
  type RegressionRemediation,
} from "../../verification/regression-prevention.js";

export interface EscalationReportItem {
  taskId: string;
  status: ExecutionResult["status"];
  failureReason?: ExecutionResult["failureReason"];
  attempts?: number;
  target: "operator" | "planner";
  reason: string;
  action: string;
  failureClass: string;
  remediation: RegressionRemediation;
}

export interface EscalationReport {
  generatedAt: string;
  totalTasks: number;
  requiredEscalations: number;
  requiredByTarget: Record<"operator" | "planner", number>;
  items: EscalationReportItem[];
}

export async function buildEscalationReport(results: ExecutionResult[], rootDir: string): Promise<EscalationReport> {
  const policy = await loadRegressionRemediationPolicy(rootDir);
  const items = results
    .filter((result) => result.escalation?.required && result.escalation.target !== "none")
    .map((result) => {
      const remediation = buildRegressionRemediation(policy, {
        failureReason: result.failureReason,
        escalationReason: result.escalation!.reason,
      });
      return {
        taskId: result.taskId,
        status: result.status,
        failureReason: result.failureReason,
        attempts: result.attempts,
        target: result.escalation!.target as "operator" | "planner",
        reason: result.escalation!.reason,
        action: result.escalation!.action,
        failureClass: remediation.failureClass,
        remediation,
      };
    });

  return {
    generatedAt: new Date().toISOString(),
    totalTasks: results.length,
    requiredEscalations: items.length,
    requiredByTarget: {
      operator: items.filter((item) => item.target === "operator").length,
      planner: items.filter((item) => item.target === "planner").length,
    },
    items,
  };
}

function buildMarkdown(report: EscalationReport): string {
  return [
    "# Escalations",
    "",
    `Generated at: ${report.generatedAt}`,
    `Total tasks: ${report.totalTasks}`,
    `Required escalations: ${report.requiredEscalations}`,
    `- Operator: ${report.requiredByTarget.operator}`,
    `- Planner: ${report.requiredByTarget.planner}`,
    "",
    "## Required escalation items",
    ...(report.items.length === 0
      ? ["- None"]
      : report.items.flatMap((item) => [
          `- task=${item.taskId} target=${item.target} status=${item.status} class=${item.failureClass} reason=${item.reason} action=${item.action}`,
          `  retry: ${item.remediation.retryGuidance}`,
          ...(item.remediation.replanSuggestions.length > 0
            ? [`  replan: ${item.remediation.replanSuggestions.join("; ")}`]
            : []),
        ])),
    "",
  ].join("\n");
}

export async function writeEscalationReport(
  rootDir: string,
  runDir: string,
  results: ExecutionResult[],
): Promise<{ jsonPath: string; markdownPath: string; runPath: string; requiredEscalations: number }> {
  const report = await buildEscalationReport(results, rootDir);
  const policy = await loadRegressionRemediationPolicy(rootDir);
  await writeRegressionPreventionIndex(rootDir, policy, report.generatedAt);
  const executionDir = path.join(rootDir, "artifacts", "execution");
  await fs.ensureDir(executionDir);
  const jsonPath = path.join(executionDir, "ESCALATIONS.json");
  const markdownPath = path.join(executionDir, "ESCALATIONS.md");
  const runPath = path.join(runDir, "escalations.json");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(markdownPath, buildMarkdown(report));
  await fs.writeJson(runPath, report, { spaces: 2 });
  return {
    jsonPath,
    markdownPath,
    runPath,
    requiredEscalations: report.requiredEscalations,
  };
}
