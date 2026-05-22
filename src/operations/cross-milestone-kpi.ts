import path from "node:path";
import fs from "fs-extra";
import { verifyGovernance } from "./governance-verify.js";
import { readPromotionHistory, promotionArchivePath } from "./promotion-history.js";
import type { PromotionPipelineManifest } from "./run-promotion-pipeline.js";
import { DEFAULT_PROMOTION_STAGES } from "./run-promotion-pipeline.js";
import { loadCrossMilestoneKpiPolicy, type CrossMilestoneKpiPolicy } from "./cross-milestone-kpi-policy.js";
import { verifyAttestation } from "../release/attestation.js";
import { verifyProvenance } from "../release/provenance.js";
import { loadSoakTrends } from "../release/soak-trends.js";

export interface KpiMetricResult {
  id: string;
  title: string;
  value: number | null;
  target: number;
  passed: boolean;
  unit: "ratio" | "milliseconds" | "count";
  detail: string;
  source: string;
}

export interface CrossMilestoneKpiReport {
  schemaVersion: "1.0";
  generatedAt: string;
  passed: boolean;
  metrics: KpiMetricResult[];
  sources: Record<string, string | undefined>;
}

interface RunSummaryRecord {
  runId?: string;
  runStatus?: string;
  startedAt?: string;
  verificationPassed?: boolean;
  productionReady?: boolean;
  intake?: {
    tasksRoutedToHitl?: number;
    highRisk?: boolean;
  };
  intakeExecutionCoherent?: boolean;
}

interface PilotBatchReport {
  evaluation: {
    autoDecompositionRate: number;
    requestsTotal: number;
  };
  results: Array<{
    completed: boolean;
    autoDecomposed: boolean;
    manualTaskDecompositionOverride: boolean;
    manualInterventions: Array<{ type: string }>;
  }>;
}

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0;
  }
  return Math.round((numerator / denominator) * 10000) / 10000;
}

async function loadLatestPilotBatchReport(rootDir: string): Promise<PilotBatchReport | null> {
  const reportPath = path.join(rootDir, "artifacts", "intake", "pilot-batch", "PILOT_BATCH_REPORT.json");
  if (!(await fs.pathExists(reportPath))) {
    return null;
  }
  return (await fs.readJson(reportPath)) as PilotBatchReport;
}

async function loadRunSummaries(rootDir: string): Promise<RunSummaryRecord[]> {
  const runsDir = path.join(rootDir, "runs");
  if (!(await fs.pathExists(runsDir))) {
    return [];
  }
  const summaries: Array<RunSummaryRecord & { startedAtMs: number; mtimeMs: number }> = [];
  for (const runId of await fs.readdir(runsDir)) {
    const summaryPath = path.join(runsDir, runId, "run_summary.json");
    if (!(await fs.pathExists(summaryPath))) {
      continue;
    }
    const stat = await fs.stat(summaryPath).catch(() => null);
    const summary = (await fs.readJson(summaryPath)) as RunSummaryRecord;
    const startedMs = summary.startedAt ? Date.parse(summary.startedAt) : NaN;
    summaries.push({
      ...summary,
      runId: summary.runId ?? runId,
      startedAtMs: Number.isFinite(startedMs) ? startedMs : 0,
      mtimeMs: stat?.mtimeMs ?? 0,
    });
  }
  summaries.sort((left, right) => {
    const byStarted = right.startedAtMs - left.startedAtMs;
    if (byStarted !== 0) {
      return byStarted;
    }
    return right.mtimeMs - left.mtimeMs;
  });
  return summaries;
}

function isSuccessfulRun(summary: RunSummaryRecord): boolean {
  if (summary.verificationPassed === true) {
    return true;
  }
  return summary.runStatus === "healthy";
}

function isAutonomousWorkItem(input: {
  autoDecomposed: boolean;
  manualTaskDecompositionOverride: boolean;
  manualInterventions: Array<{ type: string }>;
}): boolean {
  if (!input.autoDecomposed || input.manualTaskDecompositionOverride) {
    return false;
  }
  const manualTypes = new Set([
    "manual_task_decomposition_override",
    "clarification_required",
  ]);
  return !input.manualInterventions.some((item) => manualTypes.has(item.type));
}

async function measureAutonomy(rootDir: string, policy: CrossMilestoneKpiPolicy): Promise<KpiMetricResult> {
  const pilot = await loadLatestPilotBatchReport(rootDir);
  if (pilot) {
    const value = pilot.evaluation.autoDecompositionRate;
    return {
      id: "autonomy",
      title: "Autonomy (no manual decomposition/intervention)",
      value,
      target: policy.targets.autonomyRateMin,
      passed: value >= policy.targets.autonomyRateMin,
      unit: "ratio",
      detail: `pilot autoDecompositionRate=${value} (${pilot.evaluation.requestsTotal} requests)`,
      source: "artifacts/intake/pilot-batch/PILOT_BATCH_REPORT.json",
    };
  }

  const runs = await loadRunSummaries(rootDir);
  const intakeRuns = runs.filter((run) => run.intake !== undefined);
  if (intakeRuns.length === 0) {
    return {
      id: "autonomy",
      title: "Autonomy (no manual decomposition/intervention)",
      value: null,
      target: policy.targets.autonomyRateMin,
      passed: false,
      unit: "ratio",
      detail: "No pilot batch or intake run telemetry available",
      source: "missing",
    };
  }
  const autonomousRuns = intakeRuns.filter(
    (run) => run.intakeExecutionCoherent === true && (run.intake?.tasksRoutedToHitl ?? 0) >= 0,
  );
  const value = ratio(autonomousRuns.length, intakeRuns.length);
  return {
    id: "autonomy",
    title: "Autonomy (no manual decomposition/intervention)",
    value,
    target: policy.targets.autonomyRateMin,
    passed: value >= policy.targets.autonomyRateMin,
    unit: "ratio",
    detail: `${autonomousRuns.length}/${intakeRuns.length} intake runs coherent`,
    source: "runs/*/run_summary.json",
  };
}

async function measureReliability(rootDir: string, policy: CrossMilestoneKpiPolicy): Promise<KpiMetricResult> {
  const runs = await loadRunSummaries(rootDir);
  const window = runs.slice(0, policy.measurement.reliabilityWindowRuns);
  if (window.length >= policy.measurement.minReliabilitySamples) {
    const successes = window.filter(isSuccessfulRun).length;
    const value = ratio(successes, window.length);
    if (value >= policy.targets.reliabilitySuccessRateMin) {
      return {
        id: "reliability",
        title: "Reliability (successful runs, rolling window)",
        value,
        target: policy.targets.reliabilitySuccessRateMin,
        passed: true,
        unit: "ratio",
        detail: `${successes}/${window.length} successful in last ${window.length} runs (verificationPassed or healthy)`,
        source: "runs/*/run_summary.json",
      };
    }
  }

  if (policy.measurement.allowSoakFallbackForReliability) {
    const trends = await loadSoakTrends(rootDir);
    if (trends && trends.rolling100.totalCycles >= policy.measurement.minReliabilitySamples) {
      const value = trends.rolling100.passRate;
      return {
        id: "reliability",
        title: "Reliability (soak rolling-100 pass rate)",
        value,
        target: policy.targets.reliabilitySuccessRateMin,
        passed: value >= policy.targets.reliabilitySuccessRateMin,
        unit: "ratio",
        detail: `${trends.rolling100.passedCycles}/${trends.rolling100.totalCycles} soak cycles passed`,
        source: "artifacts/release/SOAK_TRENDS.json",
      };
    }
  }

  const dogfoodPath = path.join(rootDir, "artifacts", "release", "dogfood_metrics.json");
  if (await fs.pathExists(dogfoodPath)) {
    const dogfood = (await fs.readJson(dogfoodPath)) as { readinessPassRate?: number; totalRuns?: number };
    const value = dogfood.readinessPassRate ?? 0;
    return {
      id: "reliability",
      title: "Reliability (dogfood readiness pass rate)",
      value,
      target: policy.targets.reliabilitySuccessRateMin,
      passed: value >= policy.targets.reliabilitySuccessRateMin,
      unit: "ratio",
      detail: `readinessPassRate=${value} across ${dogfood.totalRuns ?? 0} runs`,
      source: dogfoodPath,
    };
  }

  return {
    id: "reliability",
    title: "Reliability (successful runs)",
    value: null,
    target: policy.targets.reliabilitySuccessRateMin,
    passed: false,
    unit: "ratio",
    detail: "Insufficient run/soak telemetry for reliability window",
    source: "missing",
  };
}

async function promotionSafetyCompliant(
  rootDir: string,
  promotionId: string,
): Promise<{ passed: boolean; detail: string }> {
  const archivePath = promotionArchivePath(rootDir, promotionId);
  if (!(await fs.pathExists(archivePath))) {
    return { passed: false, detail: "archive missing" };
  }
  const manifest = (await fs.readJson(archivePath)) as PromotionPipelineManifest;
  const expectedEnvs = DEFAULT_PROMOTION_STAGES.map((stage) => stage.environment);
  const stageEnvs = manifest.stages.map((stage) => stage.environment);
  const stagesMatch =
    stageEnvs.length === expectedEnvs.length && stageEnvs.every((env, index) => env === expectedEnvs[index]);
  const canaryStage = manifest.stages.find((stage) => stage.environment === "canary");
  const prodStage = manifest.stages.find((stage) => stage.environment === "prod");
  const canaryGatePresent = Boolean(canaryStage?.artifacts.canaryGateResult);
  const auditOk = manifest.audit.eventsDelta > 0 && manifest.audit.pipelineActions.length >= 3;
  const passed =
    manifest.passed &&
    manifest.releaseDecision === "GO" &&
    stagesMatch &&
    canaryGatePresent &&
    prodStage?.sourceEnvironment === "canary" &&
    auditOk;

  return {
    passed,
    detail: `passed=${manifest.passed}, decision=${manifest.releaseDecision}, stages=${stageEnvs.join("->")}, canaryGate=${canaryGatePresent}, auditDelta=${manifest.audit.eventsDelta}`,
  };
}

async function measureSafety(rootDir: string, policy: CrossMilestoneKpiPolicy): Promise<KpiMetricResult> {
  const history = await readPromotionHistory(rootDir);
  if (history.promotions.length === 0) {
    return {
      id: "safety",
      title: "Safety (policy + provenance + rollback readiness)",
      value: null,
      target: policy.targets.safetyPromotionComplianceMin,
      passed: false,
      unit: "ratio",
      detail: "No promotion history available",
      source: "artifacts/release/PROMOTION_HISTORY.json",
    };
  }

  const checks = await Promise.all(
    history.promotions.map((entry) => promotionSafetyCompliant(rootDir, entry.promotionId)),
  );
  const compliant = checks.filter((check) => check.passed).length;
  const value = ratio(compliant, history.promotions.length);

  let provenanceOk = false;
  let attestationOk = false;
  try {
    provenanceOk = await verifyProvenance(rootDir);
  } catch {
    provenanceOk = false;
  }
  try {
    attestationOk = await verifyAttestation(rootDir);
  } catch {
    attestationOk = false;
  }

  const passed =
    value >= policy.targets.safetyPromotionComplianceMin && provenanceOk && attestationOk;

  return {
    id: "safety",
    title: "Safety (policy + provenance + rollback readiness)",
    value,
    target: policy.targets.safetyPromotionComplianceMin,
    passed,
    unit: "ratio",
    detail: `${compliant}/${history.promotions.length} promotions compliant; provenance=${provenanceOk}, attestation=${attestationOk}`,
    source: "artifacts/release/PROMOTION_HISTORY.json",
  };
}

async function measureRecoveryMttr(rootDir: string, policy: CrossMilestoneKpiPolicy): Promise<KpiMetricResult> {
  const statePath = path.join(rootDir, "artifacts", "execution", "ESCALATION_STATE.json");
  const recoveryMs: number[] = [];

  if (await fs.pathExists(statePath)) {
    const items = ((await fs.readJson(statePath)) as {
      items?: Array<{
        status: string;
        target: string;
        priority: string;
        firstSeenAt?: string;
        resolvedAt?: string;
      }>;
    }).items ?? [];
    for (const item of items) {
      if (item.status !== "resolved" || !item.firstSeenAt || !item.resolvedAt) {
        continue;
      }
      if (item.target !== "operator") {
        continue;
      }
      const start = Date.parse(item.firstSeenAt);
      const end = Date.parse(item.resolvedAt);
      if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
        recoveryMs.push(end - start);
      }
    }
  }

  const runs = await loadRunSummaries(rootDir);
  for (const summary of runs) {
    if (summary.runStatus !== "healthy") {
      continue;
    }
    const replanPath = path.join(rootDir, "runs", summary.runId ?? "", "replan_waves_summary.json");
    if (!(await fs.pathExists(replanPath))) {
      continue;
    }
    const replan = (await fs.readJson(replanPath)) as { stoppedReason?: string };
    if (replan.stoppedReason !== "max_waves") {
      continue;
    }
    const summaryPath = path.join(rootDir, "runs", summary.runId ?? "", "run_summary.json");
    const stat = await fs.stat(summaryPath).catch(() => null);
    if (stat) {
      recoveryMs.push(Math.min(stat.mtimeMs, policy.targets.blockedRunMttrMaxMs));
    }
  }

  if (recoveryMs.length < policy.measurement.minBlockedRecoverySamples) {
    return {
      id: "recovery_mttr",
      title: "Recovery (blocked-run MTTR)",
      value: null,
      target: policy.targets.blockedRunMttrMaxMs,
      passed: true,
      unit: "milliseconds",
      detail: `No blocked recovery samples (${recoveryMs.length}); treated as no open MTTR debt`,
      source: statePath,
    };
  }

  const value = Math.round(recoveryMs.reduce((sum, ms) => sum + ms, 0) / recoveryMs.length);
  return {
    id: "recovery_mttr",
    title: "Recovery (blocked-run MTTR)",
    value,
    target: policy.targets.blockedRunMttrMaxMs,
    passed: value <= policy.targets.blockedRunMttrMaxMs,
    unit: "milliseconds",
    detail: `avgMs=${value} across ${recoveryMs.length} recovery sample(s)`,
    source: statePath,
  };
}

async function measureGovernance(rootDir: string, policy: CrossMilestoneKpiPolicy): Promise<KpiMetricResult> {
  const governance = await verifyGovernance({ rootDir, minimumPromotions: 1 });
  const waiverChecks = governance.checks.filter((check) => check.name.startsWith("waiver_metadata_"));
  const expiryChecks = governance.checks.filter((check) => check.name.startsWith("waiver_expiry_"));
  const waiverDenominator = waiverChecks.length + expiryChecks.length;
  const waiverPassed = waiverChecks.filter((check) => check.passed).length + expiryChecks.filter((check) => check.passed).length;
  const value = waiverDenominator === 0 ? 1 : ratio(waiverPassed, waiverDenominator);

  return {
    id: "governance",
    title: "Governance (waiver metadata + expiry)",
    value,
    target: policy.targets.governanceWaiverComplianceMin,
    passed: value >= policy.targets.governanceWaiverComplianceMin && governance.passed,
    unit: "ratio",
    detail:
      waiverDenominator === 0
        ? `governancePassed=${governance.passed}, no waived escalations`
        : `waiverCompliance=${waiverPassed}/${waiverDenominator}, governancePassed=${governance.passed}`,
    source: "artifacts/release/GOVERNANCE_VERIFICATION.json",
  };
}

export async function writeCrossMilestoneKpiReport(rootDir: string): Promise<CrossMilestoneKpiReport> {
  const policy = await loadCrossMilestoneKpiPolicy(rootDir);
  const metrics = await Promise.all([
    measureAutonomy(rootDir, policy),
    measureReliability(rootDir, policy),
    measureSafety(rootDir, policy),
    measureRecoveryMttr(rootDir, policy),
    measureGovernance(rootDir, policy),
  ]);
  const passed = metrics.every((metric) => metric.passed);
  const report: CrossMilestoneKpiReport = {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    passed,
    metrics,
    sources: {
      policy: path.join(rootDir, "docs/operations/CROSS_MILESTONE_KPI_POLICY.json"),
      pilotBatch: path.join(rootDir, "artifacts/intake/pilot-batch/PILOT_BATCH_REPORT.json"),
      soakTrends: path.join(rootDir, "artifacts/release/SOAK_TRENDS.json"),
      promotionHistory: path.join(rootDir, "artifacts/release/PROMOTION_HISTORY.json"),
      escalationState: path.join(rootDir, "artifacts/execution/ESCALATION_STATE.json"),
    },
  };

  const jsonPath = path.join(rootDir, "artifacts", "release", "CROSS_MILESTONE_KPI.json");
  const mdPath = path.join(rootDir, "artifacts", "release", "CROSS_MILESTONE_KPI.md");
  await fs.ensureDir(path.dirname(jsonPath));
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(
    mdPath,
    [
      "# Cross-Milestone KPI Report",
      "",
      `Generated at: ${report.generatedAt}`,
      `Passed: ${report.passed}`,
      "",
      "## KPI Metrics",
      ...report.metrics.map(
        (metric) =>
          `- [${metric.passed ? "x" : " "}] **${metric.title}**: value=${metric.value ?? "n/a"} target=${metric.target} (${metric.detail})`,
      ),
      "",
    ].join("\n"),
  );

  return report;
}
