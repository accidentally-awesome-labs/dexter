import path from "node:path";
import fs from "fs-extra";
import type { SoakStatus } from "./soak-types.js";
import { loadSoakTrends, type SoakTrendsArtifact, type SoakWindowMetrics } from "./soak-trends.js";
import { loadSoakSchedulePolicy, type SoakWarningThresholds } from "./soak-schedule-policy.js";

export type SoakReliabilitySeverity = "info" | "warning" | "critical";
export type SoakReliabilityStatus = "healthy" | "degraded" | "critical";

export interface SoakReliabilityWarning {
  id: string;
  severity: SoakReliabilitySeverity;
  message: string;
  metric: string;
  current: number | boolean;
  previous?: number | boolean;
  delta?: number;
  threshold: number | string;
}

export interface MetricDelta {
  current: number;
  previous: number | null;
  delta: number | null;
}

export interface SoakReliabilitySnapshot {
  rolling100PassRate: number;
  rolling100FailedCycles: number;
  rolling100AvgDurationMs: number;
  consecutiveFailures: number;
  currentStreak: number;
  latestCyclePassed: boolean | null;
  dailyPassRate: number | null;
  dailyWindowKey: string | null;
  topStepFailure: string | null;
  topStepFailureCount: number;
}

export interface SoakReliabilityReport {
  schemaVersion: "1.0";
  generatedAt: string;
  comparedToGeneratedAt: string | null;
  reliabilityStatus: SoakReliabilityStatus;
  deltas: {
    rolling100PassRate: MetricDelta;
    rolling100FailedCycles: MetricDelta;
    rolling100AvgDurationMs: MetricDelta;
    dailyPassRate: MetricDelta | null;
    consecutiveFailures: MetricDelta;
  };
  latestCycle: {
    passed: boolean | null;
    previousPassed: boolean | null;
    currentStreak: number;
    streakDelta: number | null;
  };
  warnings: SoakReliabilityWarning[];
  snapshot: SoakReliabilitySnapshot;
}

export function soakReliabilityJsonPath(rootDir: string): string {
  return path.join(rootDir, "artifacts", "release", "SOAK_RELIABILITY.json");
}

export function soakReliabilityMarkdownPath(rootDir: string): string {
  return path.join(rootDir, "artifacts", "release", "SOAK_RELIABILITY.md");
}

function roundRate(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function metricDelta(current: number, previous: number | null): MetricDelta {
  return {
    current,
    previous,
    delta: previous === null ? null : roundRate(current - previous),
  };
}

export function countConsecutiveFailures(status: SoakStatus | null): number {
  if (!status || status.history.length === 0) {
    return 0;
  }
  let count = 0;
  for (let index = status.history.length - 1; index >= 0; index -= 1) {
    if (status.history[index]?.passed) {
      break;
    }
    count += 1;
  }
  return count;
}

function topStepFailure(metrics: SoakWindowMetrics): { step: string | null; count: number } {
  const entries = Object.entries(metrics.stepFailureCounts);
  if (entries.length === 0) {
    return { step: null, count: 0 };
  }
  const [step, count] = entries.sort((left, right) => right[1] - left[1])[0]!;
  return { step, count };
}

export function buildSoakReliabilitySnapshot(
  trends: SoakTrendsArtifact,
  status: SoakStatus | null,
): SoakReliabilitySnapshot {
  const dailyLatest = trends.daily.at(-1);
  const topFailure = topStepFailure(trends.rolling100);
  const latestCycle = status?.history.at(-1);
  return {
    rolling100PassRate: trends.rolling100.passRate,
    rolling100FailedCycles: trends.rolling100.failedCycles,
    rolling100AvgDurationMs: trends.rolling100.avgDurationMs,
    consecutiveFailures: countConsecutiveFailures(status),
    currentStreak: status?.currentStreak ?? 0,
    latestCyclePassed: latestCycle?.passed ?? status?.lastCyclePassed ?? null,
    dailyPassRate: dailyLatest?.passRate ?? null,
    dailyWindowKey: dailyLatest?.windowKey ?? null,
    topStepFailure: topFailure.step,
    topStepFailureCount: topFailure.count,
  };
}

export function evaluateSoakReliabilityWarnings(
  snapshot: SoakReliabilitySnapshot,
  previous: SoakReliabilitySnapshot | null,
  thresholds: SoakWarningThresholds,
): SoakReliabilityWarning[] {
  const warnings: SoakReliabilityWarning[] = [];

  if (snapshot.rolling100PassRate < thresholds.rolling100PassRateFloor) {
    warnings.push({
      id: "rolling100-pass-rate-floor",
      severity: "critical",
      message: `Rolling-100 pass rate ${snapshot.rolling100PassRate} is below floor ${thresholds.rolling100PassRateFloor}.`,
      metric: "rolling100.passRate",
      current: snapshot.rolling100PassRate,
      threshold: thresholds.rolling100PassRateFloor,
    });
  }

  if (previous) {
    const passRateDrop = previous.rolling100PassRate - snapshot.rolling100PassRate;
    if (passRateDrop >= thresholds.rolling100PassRateDropMin) {
      warnings.push({
        id: "rolling100-pass-rate-drop",
        severity: "warning",
        message: `Rolling-100 pass rate dropped by ${roundRate(passRateDrop)} since last reliability snapshot.`,
        metric: "rolling100.passRate",
        current: snapshot.rolling100PassRate,
        previous: previous.rolling100PassRate,
        delta: roundRate(-passRateDrop),
        threshold: thresholds.rolling100PassRateDropMin,
      });
    }

    if (
      previous.rolling100AvgDurationMs > 0 &&
      snapshot.rolling100AvgDurationMs > previous.rolling100AvgDurationMs * (1 + thresholds.avgDurationIncreasePct)
    ) {
      warnings.push({
        id: "rolling100-duration-spike",
        severity: "warning",
        message: `Rolling-100 average duration increased beyond ${thresholds.avgDurationIncreasePct * 100}% threshold.`,
        metric: "rolling100.avgDurationMs",
        current: snapshot.rolling100AvgDurationMs,
        previous: previous.rolling100AvgDurationMs,
        delta: snapshot.rolling100AvgDurationMs - previous.rolling100AvgDurationMs,
        threshold: thresholds.avgDurationIncreasePct,
      });
    }

    if (
      snapshot.dailyPassRate !== null &&
      previous.dailyPassRate !== null &&
      previous.dailyPassRate - snapshot.dailyPassRate >= thresholds.dailyPassRateDropMin
    ) {
      warnings.push({
        id: "daily-pass-rate-drop",
        severity: "warning",
        message: `Latest daily pass rate dropped by ${roundRate(previous.dailyPassRate - snapshot.dailyPassRate)}.`,
        metric: "daily.passRate",
        current: snapshot.dailyPassRate,
        previous: previous.dailyPassRate,
        delta: roundRate(snapshot.dailyPassRate - previous.dailyPassRate),
        threshold: thresholds.dailyPassRateDropMin,
      });
    }

    if (
      snapshot.topStepFailure &&
      snapshot.topStepFailureCount >= thresholds.stepFailureSpikeMin &&
      snapshot.topStepFailureCount > previous.topStepFailureCount
    ) {
      warnings.push({
        id: "step-failure-spike",
        severity: "warning",
        message: `Step "${snapshot.topStepFailure}" failures increased to ${snapshot.topStepFailureCount}.`,
        metric: "rolling100.stepFailureCounts",
        current: snapshot.topStepFailureCount,
        previous: previous.topStepFailureCount,
        delta: snapshot.topStepFailureCount - previous.topStepFailureCount,
        threshold: thresholds.stepFailureSpikeMin,
      });
    }
  }

  if (snapshot.consecutiveFailures >= thresholds.consecutiveFailuresCritical) {
    warnings.push({
      id: "consecutive-failures-critical",
      severity: "critical",
      message: `${snapshot.consecutiveFailures} consecutive soak failures detected.`,
      metric: "consecutiveFailures",
      current: snapshot.consecutiveFailures,
      threshold: thresholds.consecutiveFailuresCritical,
    });
  } else if (snapshot.consecutiveFailures >= thresholds.consecutiveFailuresWarn) {
    warnings.push({
      id: "consecutive-failures-warn",
      severity: "warning",
      message: `${snapshot.consecutiveFailures} consecutive soak failures detected.`,
      metric: "consecutiveFailures",
      current: snapshot.consecutiveFailures,
      threshold: thresholds.consecutiveFailuresWarn,
    });
  }

  return warnings;
}

function deriveReliabilityStatus(warnings: SoakReliabilityWarning[]): SoakReliabilityStatus {
  if (warnings.some((warning) => warning.severity === "critical")) {
    return "critical";
  }
  if (warnings.some((warning) => warning.severity === "warning")) {
    return "degraded";
  }
  return "healthy";
}

export function buildSoakReliabilityReport(input: {
  trends: SoakTrendsArtifact;
  status: SoakStatus | null;
  previousReport: SoakReliabilityReport | null;
  thresholds: SoakWarningThresholds;
  generatedAt?: string;
}): SoakReliabilityReport {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const snapshot = buildSoakReliabilitySnapshot(input.trends, input.status);
  const previousSnapshot = input.previousReport?.snapshot ?? null;
  const warnings = evaluateSoakReliabilityWarnings(snapshot, previousSnapshot, input.thresholds);
  const previousCyclePassed = previousSnapshot?.latestCyclePassed ?? null;

  return {
    schemaVersion: "1.0",
    generatedAt,
    comparedToGeneratedAt: input.previousReport?.generatedAt ?? null,
    reliabilityStatus: deriveReliabilityStatus(warnings),
    deltas: {
      rolling100PassRate: metricDelta(snapshot.rolling100PassRate, previousSnapshot?.rolling100PassRate ?? null),
      rolling100FailedCycles: metricDelta(
        snapshot.rolling100FailedCycles,
        previousSnapshot?.rolling100FailedCycles ?? null,
      ),
      rolling100AvgDurationMs: metricDelta(
        snapshot.rolling100AvgDurationMs,
        previousSnapshot?.rolling100AvgDurationMs ?? null,
      ),
      dailyPassRate:
        snapshot.dailyPassRate === null
          ? null
          : metricDelta(snapshot.dailyPassRate, previousSnapshot?.dailyPassRate ?? null),
      consecutiveFailures: metricDelta(
        snapshot.consecutiveFailures,
        previousSnapshot?.consecutiveFailures ?? null,
      ),
    },
    latestCycle: {
      passed: snapshot.latestCyclePassed,
      previousPassed: previousCyclePassed,
      currentStreak: input.status?.currentStreak ?? 0,
      streakDelta:
        previousSnapshot === null
          ? null
          : (input.status?.currentStreak ?? 0) - previousSnapshot.currentStreak,
    },
    warnings,
    snapshot,
  };
}

function reliabilityMarkdown(report: SoakReliabilityReport): string {
  return [
    "# Soak Reliability",
    "",
    `Generated at: ${report.generatedAt}`,
    `Compared to: ${report.comparedToGeneratedAt ?? "none"}`,
    `Status: ${report.reliabilityStatus}`,
    "",
    "## Rolling-100 Deltas",
    `- Pass rate: ${report.deltas.rolling100PassRate.current} (delta ${report.deltas.rolling100PassRate.delta ?? "n/a"})`,
    `- Failed cycles: ${report.deltas.rolling100FailedCycles.current} (delta ${report.deltas.rolling100FailedCycles.delta ?? "n/a"})`,
    `- Avg duration (ms): ${report.deltas.rolling100AvgDurationMs.current} (delta ${report.deltas.rolling100AvgDurationMs.delta ?? "n/a"})`,
    `- Consecutive failures: ${report.deltas.consecutiveFailures.current} (delta ${report.deltas.consecutiveFailures.delta ?? "n/a"})`,
    "",
    "## Latest Cycle",
    `- Passed: ${String(report.latestCycle.passed)}`,
    `- Previous passed: ${String(report.latestCycle.previousPassed)}`,
    `- Current streak: ${report.latestCycle.currentStreak}`,
    "",
    "## Warnings",
    ...(report.warnings.length === 0
      ? ["- None"]
      : report.warnings.map(
          (warning) => `- [${warning.severity}] ${warning.id}: ${warning.message}`,
        )),
    "",
  ].join("\n");
}

export async function loadSoakReliabilityReport(rootDir: string): Promise<SoakReliabilityReport | null> {
  const file = soakReliabilityJsonPath(rootDir);
  if (!(await fs.pathExists(file))) {
    return null;
  }
  return (await fs.readJson(file)) as SoakReliabilityReport;
}

export async function updateSoakReliability(
  rootDir: string,
  options?: { trends?: SoakTrendsArtifact; status?: SoakStatus },
): Promise<{ jsonPath: string; markdownPath: string; report: SoakReliabilityReport }> {
  const policy = await loadSoakSchedulePolicy(rootDir);
  const trends = options?.trends ?? (await loadSoakTrends(rootDir));
  if (!trends) {
    throw new Error("SOAK_TRENDS.json is required before computing reliability deltas.");
  }
  const statusPath = path.join(rootDir, "artifacts", "release", "SOAK_STATUS.json");
  const status =
    options?.status ??
    ((await fs.pathExists(statusPath)) ? ((await fs.readJson(statusPath)) as SoakStatus) : null);
  const previousReport = await loadSoakReliabilityReport(rootDir);
  const report = buildSoakReliabilityReport({
    trends,
    status,
    previousReport,
    thresholds: policy.warningThresholds,
  });
  const jsonPath = soakReliabilityJsonPath(rootDir);
  const markdownPath = soakReliabilityMarkdownPath(rootDir);
  await fs.ensureDir(path.dirname(jsonPath));
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(markdownPath, reliabilityMarkdown(report));
  return { jsonPath, markdownPath, report };
}

export async function loadSoakReliabilitySummary(rootDir: string): Promise<{
  present: boolean;
  reliabilityStatus: SoakReliabilityStatus | null;
  warningCount: number;
  criticalWarningCount: number;
  rolling100PassRate: number | null;
  passRateDelta: number | null;
  consecutiveFailures: number | null;
  artifactPath: string;
}> {
  const report = await loadSoakReliabilityReport(rootDir);
  if (!report) {
    return {
      present: false,
      reliabilityStatus: null,
      warningCount: 0,
      criticalWarningCount: 0,
      rolling100PassRate: null,
      passRateDelta: null,
      consecutiveFailures: null,
      artifactPath: soakReliabilityJsonPath(rootDir),
    };
  }
  return {
    present: true,
    reliabilityStatus: report.reliabilityStatus,
    warningCount: report.warnings.length,
    criticalWarningCount: report.warnings.filter((warning) => warning.severity === "critical").length,
    rolling100PassRate: report.deltas.rolling100PassRate.current,
    passRateDelta: report.deltas.rolling100PassRate.delta,
    consecutiveFailures: report.deltas.consecutiveFailures.current,
    artifactPath: soakReliabilityJsonPath(rootDir),
  };
}
