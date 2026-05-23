import path from "node:path";
import fs from "fs-extra";
import type { EscalationReport } from "../skills/execution/escalation-report.js";
import {
  buildRegressionRemediation,
  loadRegressionRemediationPolicy,
  type RegressionRemediation,
} from "../verification/regression-prevention.js";

interface SupervisorActionItem {
  key: string;
  taskId: string;
  target: "operator" | "planner";
  priority: "high" | "medium";
  reason: string;
  action: string;
  failureReason?: string;
  attempts?: number;
  failureClass: string;
  remediation: RegressionRemediation;
}

interface SupervisorActionPlan {
  generatedAt: string;
  sourceEscalationsPath: string;
  totals: {
    required: number;
    operator: number;
    planner: number;
  };
  actions: SupervisorActionItem[];
}

type RunStatus = "healthy" | "degraded" | "blocked";

function mapPriority(reason: string): "high" | "medium" {
  if (reason === "cleanup_failed" || reason === "backend_unavailable") {
    return "high";
  }
  return "medium";
}

function toMarkdown(plan: SupervisorActionPlan): string {
  const operatorHighCount = plan.actions.filter((action) => action.target === "operator" && action.priority === "high").length;
  const runStatus = operatorHighCount > 0 ? "blocked" : plan.totals.required > 0 ? "degraded" : "healthy";
  return [
    "# Supervisor Actions",
    "",
    `Generated at: ${plan.generatedAt}`,
    `Source: ${plan.sourceEscalationsPath}`,
    `Required escalations: ${plan.totals.required}`,
    `- Operator: ${plan.totals.operator}`,
    `- Planner: ${plan.totals.planner}`,
    `Run status: ${runStatus}`,
    "",
    "## Actions",
    ...(plan.actions.length === 0
      ? ["- None"]
      : plan.actions.flatMap((action) => [
          `- [${action.priority}] task=${action.taskId} target=${action.target} class=${action.failureClass} reason=${action.reason} action=${action.action}`,
          `  retry: ${action.remediation.retryGuidance}`,
        ])),
    "",
  ].join("\n");
}

export async function routeEscalations(rootDir: string): Promise<{
  sourcePath: string;
  outputJsonPath: string;
  outputMarkdownPath: string;
  actionCount: number;
  operatorHighCount: number;
  requiredEscalations: number;
  runStatus: RunStatus;
}> {
  const sourcePath = path.join(rootDir, "artifacts", "execution", "ESCALATIONS.json");
  if (!(await fs.pathExists(sourcePath))) {
    throw new Error(`Escalations artifact not found: ${sourcePath}`);
  }
  const report = (await fs.readJson(sourcePath)) as EscalationReport;
  const remediationPolicy = await loadRegressionRemediationPolicy(rootDir);
  const actions: SupervisorActionItem[] = report.items.map((item) => {
    const failureClass =
      item.failureClass ??
      buildRegressionRemediation(remediationPolicy, { escalationReason: item.reason }).failureClass;
    const remediation =
      item.remediation ??
      buildRegressionRemediation(remediationPolicy, {
        failureClass,
        escalationReason: item.reason,
      });
    return {
      key: `${item.taskId}:${item.target}:${item.reason}`,
      taskId: item.taskId,
      target: item.target,
      priority: mapPriority(item.reason),
      reason: item.reason,
      action: item.action,
      failureReason: item.failureReason,
      attempts: item.attempts,
      failureClass,
      remediation,
    };
  });
  const plan: SupervisorActionPlan = {
    generatedAt: new Date().toISOString(),
    sourceEscalationsPath: sourcePath,
    totals: {
      required: report.requiredEscalations,
      operator: actions.filter((item) => item.target === "operator").length,
      planner: actions.filter((item) => item.target === "planner").length,
    },
    actions,
  };
  const operatorHighCount = actions.filter((action) => action.target === "operator" && action.priority === "high").length;
  const runStatus: RunStatus =
    operatorHighCount > 0 ? "blocked" : plan.totals.required > 0 ? "degraded" : "healthy";

  const executionDir = path.join(rootDir, "artifacts", "execution");
  await fs.ensureDir(executionDir);
  const outputJsonPath = path.join(executionDir, "SUPERVISOR_ACTIONS.json");
  const outputMarkdownPath = path.join(executionDir, "SUPERVISOR_ACTIONS.md");
  await fs.writeJson(outputJsonPath, plan, { spaces: 2 });
  await fs.writeFile(outputMarkdownPath, toMarkdown(plan));
  return {
    sourcePath,
    outputJsonPath,
    outputMarkdownPath,
    actionCount: actions.length,
    operatorHighCount,
    requiredEscalations: plan.totals.required,
    runStatus,
  };
}
