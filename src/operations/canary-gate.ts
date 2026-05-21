import path from "node:path";
import fs from "fs-extra";
import type { DeploymentHealthReport } from "../runtime/deployment-health.js";
import { evaluateSloRollbackTriggers, loadSloThresholds } from "./slo-rollback.js";

export interface CanaryMetrics {
  errorRate5xx: number;
  p95LatencyMs: number;
  errorBudgetBurnMultiple: number;
}

export interface CanaryGateCheck {
  name: string;
  passed: boolean;
  actual: number;
  threshold: number;
}

export interface CanaryGateResult {
  schemaVersion: "1.0";
  generatedAt: string;
  environment: "canary";
  passed: boolean;
  burnState: "healthy" | "warn" | "breach";
  prodPromotionAllowed: boolean;
  metrics: CanaryMetrics;
  checks: CanaryGateCheck[];
  healthValidation?: DeploymentHealthReport;
}

interface CanarySloPolicy {
  thresholds: {
    errorRate5xxMax: number;
    p95LatencyMsMax: number;
    errorBudgetBurnMultipleMax: number;
  };
  artifactTtlHours: number;
}

const artifactJsonPath = (rootDir: string) => path.join(rootDir, "artifacts", "release", "CANARY_GATE_RESULT.json");
const artifactMarkdownPath = (rootDir: string) => path.join(rootDir, "artifacts", "release", "CANARY_GATE_RESULT.md");

async function loadCanarySloPolicy(rootDir: string): Promise<CanarySloPolicy> {
  const policyPath = path.join(rootDir, "docs", "operations", "CANARY_SLO_POLICY.json");
  if (!(await fs.pathExists(policyPath))) {
    return {
      thresholds: {
        errorRate5xxMax: 0.02,
        p95LatencyMsMax: 1200,
        errorBudgetBurnMultipleMax: 2,
      },
      artifactTtlHours: 24,
    };
  }
  const policy = (await fs.readJson(policyPath)) as CanarySloPolicy;
  return policy;
}

function burnStateFromMetrics(metrics: CanaryMetrics, thresholds: CanarySloPolicy["thresholds"]): "healthy" | "warn" | "breach" {
  if (
    metrics.errorRate5xx > thresholds.errorRate5xxMax ||
    metrics.p95LatencyMs > thresholds.p95LatencyMsMax ||
    metrics.errorBudgetBurnMultiple > thresholds.errorBudgetBurnMultipleMax
  ) {
    return "breach";
  }
  const warnErrorRate = thresholds.errorRate5xxMax * 0.75;
  const warnLatency = thresholds.p95LatencyMsMax * 0.85;
  const warnBurn = thresholds.errorBudgetBurnMultipleMax * 0.75;
  if (
    metrics.errorRate5xx > warnErrorRate ||
    metrics.p95LatencyMs > warnLatency ||
    metrics.errorBudgetBurnMultiple > warnBurn
  ) {
    return "warn";
  }
  return "healthy";
}

export function metricsFromHealthReport(health: DeploymentHealthReport): CanaryMetrics {
  if (health.skipped || health.checks.length === 0) {
    return {
      errorRate5xx: 0,
      p95LatencyMs: 0,
      errorBudgetBurnMultiple: 0,
    };
  }
  const failed = health.checks.filter((item) => item.status === "fail").length;
  const durations = health.checks.map((item) => item.durationMs).sort((a, b) => a - b);
  const p95Index = Math.max(0, Math.ceil(durations.length * 0.95) - 1);
  return {
    errorRate5xx: failed / health.checks.length,
    p95LatencyMs: durations[p95Index] ?? 0,
    errorBudgetBurnMultiple: failed > 0 ? 1.5 : 0.5,
  };
}

export function metricsFromEnv(): CanaryMetrics | null {
  const errorRateRaw = process.env.DEXTER_CANARY_ERROR_RATE_5XX;
  const p95Raw = process.env.DEXTER_CANARY_P95_LATENCY_MS;
  const burnRaw = process.env.DEXTER_CANARY_ERROR_BUDGET_BURN;
  if (!errorRateRaw && !p95Raw && !burnRaw) {
    return null;
  }
  return {
    errorRate5xx: Number(errorRateRaw ?? "0"),
    p95LatencyMs: Number(p95Raw ?? "0"),
    errorBudgetBurnMultiple: Number(burnRaw ?? "0"),
  };
}

export async function metricsFromSnapshotFile(snapshotPath: string): Promise<CanaryMetrics> {
  const snapshot = (await fs.readJson(snapshotPath)) as Partial<CanaryMetrics>;
  return {
    errorRate5xx: Number(snapshot.errorRate5xx ?? 0),
    p95LatencyMs: Number(snapshot.p95LatencyMs ?? 0),
    errorBudgetBurnMultiple: Number(snapshot.errorBudgetBurnMultiple ?? 0),
  };
}

export async function resolveCanaryMetrics(options: {
  rootDir: string;
  healthValidation: DeploymentHealthReport;
  snapshotPath?: string;
}): Promise<CanaryMetrics> {
  if (options.snapshotPath) {
    return metricsFromSnapshotFile(options.snapshotPath);
  }
  const fromEnv = metricsFromEnv();
  if (fromEnv) {
    return fromEnv;
  }
  return metricsFromHealthReport(options.healthValidation);
}

export async function evaluateCanaryGate(
  rootDir: string,
  metrics: CanaryMetrics,
  healthValidation?: DeploymentHealthReport,
): Promise<CanaryGateResult> {
  const policy = await loadCanarySloPolicy(rootDir);
  const sloPolicy = await loadSloThresholds(rootDir);
  const sloEvaluation = evaluateSloRollbackTriggers(metrics, sloPolicy, healthValidation);
  const checks: CanaryGateCheck[] = [
    {
      name: "error_rate_5xx",
      passed: metrics.errorRate5xx <= policy.thresholds.errorRate5xxMax,
      actual: metrics.errorRate5xx,
      threshold: policy.thresholds.errorRate5xxMax,
    },
    {
      name: "p95_latency_ms",
      passed: metrics.p95LatencyMs <= policy.thresholds.p95LatencyMsMax,
      actual: metrics.p95LatencyMs,
      threshold: policy.thresholds.p95LatencyMsMax,
    },
    {
      name: "error_budget_burn_multiple",
      passed: metrics.errorBudgetBurnMultiple <= policy.thresholds.errorBudgetBurnMultipleMax,
      actual: metrics.errorBudgetBurnMultiple,
      threshold: policy.thresholds.errorBudgetBurnMultipleMax,
    },
  ];
  const burnState = burnStateFromMetrics(metrics, policy.thresholds);
  const healthPassed = healthValidation ? healthValidation.passed : true;
  const passed = !sloEvaluation.triggered && healthPassed && burnState !== "breach";

  return {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    environment: "canary",
    passed,
    burnState,
    prodPromotionAllowed: passed,
    metrics,
    checks,
    healthValidation,
  };
}

export async function writeCanaryGateArtifact(
  rootDir: string,
  result: CanaryGateResult,
): Promise<{ jsonPath: string; markdownPath: string }> {
  const jsonPath = artifactJsonPath(rootDir);
  const markdownPath = artifactMarkdownPath(rootDir);
  await fs.ensureDir(path.dirname(jsonPath));
  await fs.writeJson(jsonPath, result, { spaces: 2 });
  await fs.writeFile(
    markdownPath,
    [
      "# Canary Gate Result",
      "",
      `Generated at: ${result.generatedAt}`,
      `Passed: ${result.passed}`,
      `Burn state: ${result.burnState}`,
      `Prod promotion allowed: ${result.prodPromotionAllowed}`,
      "",
      "## Metrics",
      `- 5xx error rate: ${result.metrics.errorRate5xx}`,
      `- p95 latency (ms): ${result.metrics.p95LatencyMs}`,
      `- Error budget burn multiple: ${result.metrics.errorBudgetBurnMultiple}`,
      "",
      "## Checks",
      ...result.checks.map(
        (check) =>
          `- ${check.name}: ${check.passed ? "PASS" : "FAIL"} (actual=${check.actual}, threshold=${check.threshold})`,
      ),
      "",
    ].join("\n"),
  );
  return { jsonPath, markdownPath };
}

export async function readCanaryGateStatus(rootDir: string): Promise<{
  present: boolean;
  passed: boolean;
  prodPromotionAllowed: boolean;
  expired: boolean;
  burnState?: "healthy" | "warn" | "breach";
  generatedAt?: string;
  result?: CanaryGateResult;
}> {
  const jsonPath = artifactJsonPath(rootDir);
  if (!(await fs.pathExists(jsonPath))) {
    return {
      present: false,
      passed: false,
      prodPromotionAllowed: false,
      expired: true,
    };
  }
  const result = (await fs.readJson(jsonPath)) as CanaryGateResult;
  const policy = await loadCanarySloPolicy(rootDir);
  const generatedAtMs = Date.parse(result.generatedAt);
  const ttlMs = policy.artifactTtlHours * 60 * 60 * 1000;
  const expired = !Number.isFinite(generatedAtMs) || Date.now() - generatedAtMs > ttlMs;
  const passed = result.passed && !expired;
  return {
    present: true,
    passed,
    prodPromotionAllowed: passed && result.prodPromotionAllowed,
    expired,
    burnState: result.burnState,
    generatedAt: result.generatedAt,
    result,
  };
}
