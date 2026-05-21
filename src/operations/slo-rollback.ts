import path from "node:path";
import fs from "fs-extra";
import type { ControlPlaneAdapter } from "../runtime/control-plane.js";
import type { DeploymentHealthReport } from "../runtime/deployment-health.js";
import type { CanaryMetrics } from "./canary-gate.js";
import { appendAuditLogEvent } from "./audit-log.js";

export type SloBreachKind = "error-rate" | "latency" | "burn";

export interface SloThresholds {
  errorRate5xxMax: number;
  p95LatencyMsMax: number;
  errorBudgetBurnMultipleMax: number;
}

export interface SloRollbackTriggerResult {
  trigger: "error_rate_breach" | "latency_breach" | "error_budget_burn_breach" | "smoke_test_failure";
  metric: string;
  actual: number;
  threshold: number;
  evaluationWindowMinutes: number;
}

export interface SloRollbackEvaluation {
  triggered: boolean;
  triggers: SloRollbackTriggerResult[];
  metrics: CanaryMetrics;
}

export interface SloRollbackExecution {
  triggered: true;
  rollbackId: string;
  rollbackMode: "api" | "hook" | "simulated";
  triggers: SloRollbackTriggerResult[];
  reason: string;
}

interface SloPolicyFile {
  thresholds: SloThresholds;
  evaluationWindowMinutes?: {
    errorRate?: number;
    latency?: number;
    errorBudget?: number;
  };
}

const artifactJsonPath = (rootDir: string) => path.join(rootDir, "artifacts", "release", "SLO_ROLLBACK_RESULT.json");
const artifactMarkdownPath = (rootDir: string) => path.join(rootDir, "artifacts", "release", "SLO_ROLLBACK_RESULT.md");

export async function loadSloThresholds(rootDir: string): Promise<{
  thresholds: SloThresholds;
  evaluationWindowMinutes: { errorRate: number; latency: number; errorBudget: number };
}> {
  const policyPath = path.join(rootDir, "docs", "operations", "CANARY_SLO_POLICY.json");
  if (!(await fs.pathExists(policyPath))) {
    return {
      thresholds: {
        errorRate5xxMax: 0.02,
        p95LatencyMsMax: 1200,
        errorBudgetBurnMultipleMax: 2,
      },
      evaluationWindowMinutes: { errorRate: 5, latency: 10, errorBudget: 30 },
    };
  }
  const policy = (await fs.readJson(policyPath)) as SloPolicyFile;
  return {
    thresholds: policy.thresholds,
    evaluationWindowMinutes: {
      errorRate: policy.evaluationWindowMinutes?.errorRate ?? 5,
      latency: policy.evaluationWindowMinutes?.latency ?? 10,
      errorBudget: policy.evaluationWindowMinutes?.errorBudget ?? 30,
    },
  };
}

export function simulatedBreachMetrics(kind: SloBreachKind): CanaryMetrics {
  if (kind === "error-rate") {
    return { errorRate5xx: 0.05, p95LatencyMs: 500, errorBudgetBurnMultiple: 1 };
  }
  if (kind === "latency") {
    return { errorRate5xx: 0, p95LatencyMs: 2500, errorBudgetBurnMultiple: 1 };
  }
  return { errorRate5xx: 0, p95LatencyMs: 500, errorBudgetBurnMultiple: 3 };
}

export function evaluateSloRollbackTriggers(
  metrics: CanaryMetrics,
  policy: {
    thresholds: SloThresholds;
    evaluationWindowMinutes: { errorRate: number; latency: number; errorBudget: number };
  },
  healthValidation?: DeploymentHealthReport,
): SloRollbackEvaluation {
  const triggers: SloRollbackTriggerResult[] = [];

  if (metrics.errorRate5xx > policy.thresholds.errorRate5xxMax) {
    triggers.push({
      trigger: "error_rate_breach",
      metric: "error_rate_5xx",
      actual: metrics.errorRate5xx,
      threshold: policy.thresholds.errorRate5xxMax,
      evaluationWindowMinutes: policy.evaluationWindowMinutes.errorRate,
    });
  }
  if (metrics.p95LatencyMs > policy.thresholds.p95LatencyMsMax) {
    triggers.push({
      trigger: "latency_breach",
      metric: "p95_latency_ms",
      actual: metrics.p95LatencyMs,
      threshold: policy.thresholds.p95LatencyMsMax,
      evaluationWindowMinutes: policy.evaluationWindowMinutes.latency,
    });
  }
  if (metrics.errorBudgetBurnMultiple > policy.thresholds.errorBudgetBurnMultipleMax) {
    triggers.push({
      trigger: "error_budget_burn_breach",
      metric: "error_budget_burn_multiple",
      actual: metrics.errorBudgetBurnMultiple,
      threshold: policy.thresholds.errorBudgetBurnMultipleMax,
      evaluationWindowMinutes: policy.evaluationWindowMinutes.errorBudget,
    });
  }
  if (healthValidation && !healthValidation.skipped && !healthValidation.passed) {
    triggers.push({
      trigger: "smoke_test_failure",
      metric: "health_check_failures",
      actual: healthValidation.checks.filter((item) => item.status === "fail").length,
      threshold: 0,
      evaluationWindowMinutes: 0,
    });
  }

  return {
    triggered: triggers.length > 0,
    triggers,
    metrics,
  };
}

export async function executePromotionRollback(options: {
  rootDir: string;
  adapter: ControlPlaneAdapter;
  appName: string;
  environment: string;
  actor: string;
  reason: string;
  triggers: SloRollbackTriggerResult[];
  requireApiMode?: boolean;
}): Promise<SloRollbackExecution> {
  const rollbackResult = await options.adapter.rollback(options.appName);
  await appendAuditLogEvent(options.rootDir, {
    actor: options.actor,
    action: "promotion_rollback",
    scope: options.environment,
    reason: options.reason,
    metadata: {
      appName: options.appName,
      rollbackMode: rollbackResult.mode,
      rollbackId: rollbackResult.rollbackId,
      triggers: options.triggers,
    },
  });
  if (options.requireApiMode && rollbackResult.mode !== "api") {
    throw new Error("SLO rollback failed API requirement: rollback mode is not API.");
  }
  return {
    triggered: true,
    rollbackId: rollbackResult.rollbackId,
    rollbackMode: rollbackResult.mode,
    triggers: options.triggers,
    reason: options.reason,
  };
}

export async function writeSloRollbackArtifact(
  rootDir: string,
  payload: {
    generatedAt: string;
    environment: string;
    appName: string;
    execution: SloRollbackExecution;
    evaluation: SloRollbackEvaluation;
  },
): Promise<{ jsonPath: string; markdownPath: string }> {
  const jsonPath = artifactJsonPath(rootDir);
  const markdownPath = artifactMarkdownPath(rootDir);
  await fs.ensureDir(path.dirname(jsonPath));
  await fs.writeJson(jsonPath, payload, { spaces: 2 });
  await fs.writeFile(
    markdownPath,
    [
      "# SLO Rollback Result",
      "",
      `Generated at: ${payload.generatedAt}`,
      `Environment: ${payload.environment}`,
      `App: ${payload.appName}`,
      `Reason: ${payload.execution.reason}`,
      `Rollback ID: ${payload.execution.rollbackId}`,
      `Rollback mode: ${payload.execution.rollbackMode}`,
      "",
      "## Triggers",
      ...payload.evaluation.triggers.map(
        (trigger) =>
          `- ${trigger.trigger}: actual=${trigger.actual}, threshold=${trigger.threshold}, window=${trigger.evaluationWindowMinutes}m`,
      ),
      "",
    ].join("\n"),
  );
  return { jsonPath, markdownPath };
}

export async function readSloRollbackStatus(rootDir: string): Promise<{
  present: boolean;
  triggered: boolean;
  artifactPath: string;
}> {
  const jsonPath = artifactJsonPath(rootDir);
  if (!(await fs.pathExists(jsonPath))) {
    return { present: false, triggered: false, artifactPath: jsonPath };
  }
  const payload = (await fs.readJson(jsonPath)) as { execution?: SloRollbackExecution };
  return {
    present: true,
    triggered: payload.execution?.triggered ?? false,
    artifactPath: jsonPath,
  };
}
