import path from "node:path";
import fs from "fs-extra";
import { buildMetricsReport } from "../metrics/aggregator.js";
import {
  buildRegressionRemediation,
  loadRegressionRemediationPolicy,
} from "../verification/regression-prevention.js";
import type { FailureClassSummary, FailureTaxonomyReport } from "../verification/failure-taxonomy.js";
import { resolveFailureTaxonomyReport } from "../verification/failure-taxonomy.js";
import {
  loadReliabilityKpiPolicy,
  type MitigationOwner,
  type MitigationPriority,
  type ReliabilityKpiPolicy,
} from "./reliability-kpi-policy.js";
import { loadSoakReliabilityReport, type SoakReliabilityReport } from "./soak-reliability.js";
import { loadSoakTrends, type SoakTrendsArtifact } from "./soak-trends.js";
import { loadSoakStatus } from "./run-soak-cycle.js";
import type { SoakCycleResult } from "./soak-types.js";

export type ReliabilityRiskTrend = "stable" | "increasing" | "new";

export interface ReliabilityKpiMetrics {
  soakPassRate: number;
  soakPassRateDelta: number | null;
  consecutiveSoakFailures: number;
  soakRepeatFailureRate: number;
  runRepeatFailureRate: number;
  runReadinessPassRate: number;
  reliabilityStatus: string;
  gatesPassed: boolean;
}

export interface ReliabilityTopRisk {
  rank: number;
  taxonomyClass: string;
  title: string;
  severity: string;
  count: number;
  share: number;
  trend: ReliabilityRiskTrend;
}

export interface MitigationBacklogItem {
  priority: MitigationPriority;
  failureClass: string;
  title: string;
  owner: MitigationOwner;
  rationale: string;
  actions: string[];
}

export interface ReliabilityKpiReport {
  schemaVersion: "1.0";
  generatedAt: string;
  window: {
    rolling100CycleCount: number;
    runTelemetryCount: number;
  };
  kpi: ReliabilityKpiMetrics;
  topRisks: ReliabilityTopRisk[];
  mitigationBacklog: MitigationBacklogItem[];
  sources: {
    soakTrendsPath: string;
    soakReliabilityPath: string;
    failureTaxonomyPath: string;
    dogfoodMetricsPath: string;
  };
}

export function reliabilityKpiJsonPath(rootDir: string): string {
  return path.join(rootDir, "artifacts", "release", "RELIABILITY_KPI.json");
}

export function reliabilityKpiMarkdownPath(rootDir: string): string {
  return path.join(rootDir, "artifacts", "release", "RELIABILITY_KPI.md");
}

function failedStepName(cycle: SoakCycleResult): string {
  const failed = cycle.steps.find((step) => step.exitCode !== 0);
  return failed?.name ?? "unknown";
}

export function computeSoakRepeatFailureRate(cycles: SoakCycleResult[]): number {
  if (cycles.length < 2) {
    return 0;
  }
  let repeatPairs = 0;
  let consecutiveFailPairs = 0;
  for (let index = 1; index < cycles.length; index += 1) {
    const previous = cycles[index - 1]!;
    const current = cycles[index]!;
    if (!previous.passed && !current.passed) {
      consecutiveFailPairs += 1;
      if (failedStepName(previous) === failedStepName(current)) {
        repeatPairs += 1;
      }
    }
  }
  return consecutiveFailPairs === 0 ? 0 : Math.round((repeatPairs / consecutiveFailPairs) * 1000) / 1000;
}

function inferRiskTrend(
  taxonomyClass: string,
  currentCount: number,
  previousReport: ReliabilityKpiReport | null,
): ReliabilityRiskTrend {
  if (!previousReport) {
    return currentCount > 0 ? "new" : "stable";
  }
  const previous = previousReport.topRisks.find((risk) => risk.taxonomyClass === taxonomyClass);
  if (!previous) {
    return currentCount > 0 ? "new" : "stable";
  }
  if (currentCount > previous.count) {
    return "increasing";
  }
  return "stable";
}

function mapSeverityToPriority(
  severity: string,
  policy: ReliabilityKpiPolicy,
): MitigationPriority {
  const key = severity as keyof ReliabilityKpiPolicy["severityToPriority"];
  return policy.severityToPriority[key] ?? "P2";
}

function resolveOwner(failureClass: string, policy: ReliabilityKpiPolicy): MitigationOwner {
  return policy.mitigationOwners[failureClass] ?? "operator";
}

function buildMitigationForClass(
  summary: FailureClassSummary,
  policy: ReliabilityKpiPolicy,
  remediationPolicy: Awaited<ReturnType<typeof loadRegressionRemediationPolicy>>,
  trend: ReliabilityRiskTrend,
): MitigationBacklogItem {
  const remediation = buildRegressionRemediation(remediationPolicy, { failureClass: summary.taxonomyClass });
  const priority = mapSeverityToPriority(summary.severity, policy);
  const owner = resolveOwner(summary.taxonomyClass, policy);
  const actions = [
    remediation.retryGuidance,
    ...remediation.replanSuggestions.slice(0, 2),
    ...remediation.regressionChecks.slice(0, 2),
  ];
  return {
    priority,
    failureClass: summary.taxonomyClass,
    title: summary.title,
    owner,
    rationale: `${summary.count} failures (${(summary.share * 100).toFixed(1)}% share), severity=${summary.severity}, trend=${trend}.`,
    actions,
  };
}

function evaluateKpiGates(metrics: ReliabilityKpiMetrics, policy: ReliabilityKpiPolicy): boolean {
  return (
    metrics.soakPassRate >= policy.rolling100MinPassRate &&
    metrics.soakRepeatFailureRate <= policy.maxSoakRepeatFailureRate &&
    metrics.runRepeatFailureRate <= policy.maxRunRepeatFailureRate &&
    metrics.reliabilityStatus !== "critical"
  );
}

export function buildReliabilityKpiReport(input: {
  policy: ReliabilityKpiPolicy;
  trends: SoakTrendsArtifact | null;
  soakReliability: SoakReliabilityReport | null;
  taxonomy: FailureTaxonomyReport;
  runMetrics: {
    totalRuns: number;
    readinessPassRate: number;
    repeatedFailureRate: number;
  };
  soakRepeatFailureRate: number;
  remediationPolicy: Awaited<ReturnType<typeof loadRegressionRemediationPolicy>>;
  previousReport: ReliabilityKpiReport | null;
  generatedAt?: string;
}): ReliabilityKpiReport {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const rolling = input.trends?.rolling100;
  const soakPassRate = rolling?.passRate ?? 0;
  const soakPassRateDelta = input.soakReliability?.deltas.rolling100PassRate.delta ?? null;
  const consecutiveSoakFailures = input.soakReliability?.deltas.consecutiveFailures.current ?? 0;
  const reliabilityStatus = input.soakReliability?.reliabilityStatus ?? "unknown";

  const topSummaries = input.taxonomy.classSummaries
    .filter((item) => item.taxonomyClass !== "unknown")
    .slice(0, input.policy.topFailureClassCount);

  const topRisks: ReliabilityTopRisk[] = topSummaries.map((summary, index) => ({
    rank: index + 1,
    taxonomyClass: summary.taxonomyClass,
    title: summary.title,
    severity: summary.severity,
    count: summary.count,
    share: summary.share,
    trend: inferRiskTrend(summary.taxonomyClass, summary.count, input.previousReport),
  }));

  const mitigationBacklog = topSummaries.map((summary) => {
    const trend = inferRiskTrend(summary.taxonomyClass, summary.count, input.previousReport);
    return buildMitigationForClass(summary, input.policy, input.remediationPolicy, trend);
  });

  const kpi: ReliabilityKpiMetrics = {
    soakPassRate,
    soakPassRateDelta,
    consecutiveSoakFailures,
    soakRepeatFailureRate: input.soakRepeatFailureRate,
    runRepeatFailureRate: input.runMetrics.repeatedFailureRate,
    runReadinessPassRate: input.runMetrics.readinessPassRate,
    reliabilityStatus,
    gatesPassed: false,
  };
  kpi.gatesPassed = evaluateKpiGates(kpi, input.policy);

  return {
    schemaVersion: "1.0",
    generatedAt,
    window: {
      rolling100CycleCount: input.trends?.query.rolling100CycleCount ?? 0,
      runTelemetryCount: input.runMetrics.totalRuns,
    },
    kpi,
    topRisks,
    mitigationBacklog,
    sources: {
      soakTrendsPath: "artifacts/release/SOAK_TRENDS.json",
      soakReliabilityPath: "artifacts/release/SOAK_RELIABILITY.json",
      failureTaxonomyPath: "artifacts/verification/FAILURE_TAXONOMY.json",
      dogfoodMetricsPath: "artifacts/release/dogfood_metrics.json",
    },
  };
}

export async function loadReliabilityKpiReport(rootDir: string): Promise<ReliabilityKpiReport | null> {
  const file = reliabilityKpiJsonPath(rootDir);
  if (!(await fs.pathExists(file))) {
    return null;
  }
  return (await fs.readJson(file)) as ReliabilityKpiReport;
}

function renderReliabilityKpiMarkdown(report: ReliabilityKpiReport): string {
  return [
    "# Reliability KPI Review",
    "",
    `Generated at: ${report.generatedAt}`,
    `Rolling-100 soak cycles: ${report.window.rolling100CycleCount}`,
    `Run telemetry count: ${report.window.runTelemetryCount}`,
    "",
    "## KPI Snapshot",
    `- Soak pass rate (rolling-100): ${report.kpi.soakPassRate} (delta ${report.kpi.soakPassRateDelta ?? "n/a"})`,
    `- Consecutive soak failures: ${report.kpi.consecutiveSoakFailures}`,
    `- Soak repeat-failure rate: ${report.kpi.soakRepeatFailureRate}`,
    `- Run repeat-failure rate: ${report.kpi.runRepeatFailureRate}`,
    `- Run readiness pass rate: ${report.kpi.runReadinessPassRate}`,
    `- Soak reliability status: ${report.kpi.reliabilityStatus}`,
    `- KPI gates passed: ${report.kpi.gatesPassed ? "yes" : "no"}`,
    "",
    "## Top Reliability Risks",
    ...(report.topRisks.length === 0
      ? ["- None"]
      : report.topRisks.map(
          (risk) =>
            `- #${risk.rank} ${risk.taxonomyClass} (${risk.severity}): ${risk.title} — count=${risk.count}, share=${risk.share}, trend=${risk.trend}`,
        )),
    "",
    "## Mitigation Backlog",
    ...(report.mitigationBacklog.length === 0
      ? ["- None"]
      : report.mitigationBacklog.flatMap((item) => [
          `- [${item.priority}] ${item.failureClass} — owner=${item.owner}`,
          `  - Rationale: ${item.rationale}`,
          ...item.actions.map((action) => `  - Action: ${action}`),
        ])),
    "",
  ].join("\n");
}

export async function writeReliabilityKpiReport(rootDir: string): Promise<{
  jsonPath: string;
  markdownPath: string;
  report: ReliabilityKpiReport;
}> {
  const policy = await loadReliabilityKpiPolicy(rootDir);
  const remediationPolicy = await loadRegressionRemediationPolicy(rootDir);
  const trends = await loadSoakTrends(rootDir);
  const soakReliability = await loadSoakReliabilityReport(rootDir);
  const taxonomy = await resolveFailureTaxonomyReport(rootDir);
  const metrics = await buildMetricsReport(rootDir);
  const previousReport = await loadReliabilityKpiReport(rootDir);

  const status = await loadSoakStatus(rootDir, 10);
  const rollingCycles = status.history.slice(-100);
  const soakRepeatFailureRate = computeSoakRepeatFailureRate(rollingCycles);

  const report = buildReliabilityKpiReport({
    policy,
    trends,
    soakReliability,
    taxonomy: taxonomy.report,
    runMetrics: {
      totalRuns: metrics.report.totalRuns,
      readinessPassRate: metrics.report.readinessPassRate,
      repeatedFailureRate: metrics.report.repeatedFailureRate,
    },
    soakRepeatFailureRate,
    remediationPolicy,
    previousReport,
  });

  const jsonPath = reliabilityKpiJsonPath(rootDir);
  const markdownPath = reliabilityKpiMarkdownPath(rootDir);
  await fs.ensureDir(path.dirname(jsonPath));
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(markdownPath, renderReliabilityKpiMarkdown(report));

  return { jsonPath, markdownPath, report };
}

export async function loadReliabilityKpiSummary(rootDir: string): Promise<{
  present: boolean;
  gatesPassed: boolean;
  topRiskClass: string | null;
  mitigationCount: number;
  soakPassRate: number | null;
  artifactPath: string;
}> {
  const report = await loadReliabilityKpiReport(rootDir);
  if (!report) {
    return {
      present: false,
      gatesPassed: false,
      topRiskClass: null,
      mitigationCount: 0,
      soakPassRate: null,
      artifactPath: reliabilityKpiJsonPath(rootDir),
    };
  }
  return {
    present: true,
    gatesPassed: report.kpi.gatesPassed,
    topRiskClass: report.topRisks[0]?.taxonomyClass ?? null,
    mitigationCount: report.mitigationBacklog.length,
    soakPassRate: report.kpi.soakPassRate,
    artifactPath: reliabilityKpiJsonPath(rootDir),
  };
}
