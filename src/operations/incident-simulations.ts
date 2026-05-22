import path from "node:path";
import fs from "fs-extra";
import { buildRunTriage } from "../core/run-triage.js";
import { routeAlertsFromOpsStatus } from "./alert-routing.js";
import { assertPromotionAllowed } from "./promotion-gate.js";
import {
  evaluateSloRollbackTriggers,
  loadSloThresholds,
  simulatedBreachMetrics,
  writeSloRollbackArtifact,
} from "./slo-rollback.js";

export interface IncidentSimulationResult {
  id: string;
  passed: boolean;
  detail: string;
  artifacts: string[];
}

export interface IncidentSimulationReport {
  schemaVersion: "1.0";
  generatedAt: string;
  passed: boolean;
  simulations: IncidentSimulationResult[];
}

async function ensureDocs(rootDir: string, sourceRoot: string): Promise<void> {
  const docsSource = path.join(sourceRoot, "docs");
  if (await fs.pathExists(docsSource)) {
    await fs.copy(docsSource, path.join(rootDir, "docs"));
  }
}

export async function simulateBlockedEscalationStorm(
  rootDir: string,
  sourceRoot: string,
): Promise<IncidentSimulationResult> {
  const runId = "sim-blocked";
  const runDir = path.join(rootDir, "runs", runId);
  const executionDir = path.join(rootDir, "artifacts", "execution");
  await fs.ensureDir(runDir);
  await fs.ensureDir(executionDir);
  await ensureDocs(rootDir, sourceRoot);

  await fs.writeJson(path.join(runDir, "run_summary.json"), {
    runId,
    runStatus: "blocked",
    productionReady: false,
    startedAt: new Date(Date.now() - 96 * 3_600_000).toISOString(),
  });
  await fs.writeJson(path.join(executionDir, "ESCALATION_STATE.json"), {
    generatedAt: new Date().toISOString(),
    items: [
      {
        key: "t1:operator:backend_unavailable",
        status: "open",
        target: "operator",
        priority: "high",
        reason: "backend_unavailable",
        lastRunId: runId,
      },
      {
        key: "t2:operator:cleanup_failed",
        status: "open",
        target: "operator",
        priority: "high",
        reason: "cleanup_failed",
        lastRunId: runId,
      },
    ],
  });

  const triage = await buildRunTriage(rootDir, runId, "blocked");
  const alerts = await routeAlertsFromOpsStatus({
    rootDir,
    dryRun: true,
    context: {
      runId,
      runStatus: "blocked",
      slo: { state: "healthy" },
      queue: { backlogAging: { stale: 1 } },
      escalationAging: { oldestUnresolved: { bucket: "stale" } },
    },
  });

  const passed =
    triage.unresolvedEscalations.length >= 2 &&
    triage.alerts.matchedRules.includes("run_blocked") &&
    alerts.matchedRules.length > 0;

  return {
    id: "blocked_escalation_storm",
    passed,
    detail: `triageEscalations=${triage.unresolvedEscalations.length}, alertRules=${alerts.matchedRules.join(",")}`,
    artifacts: [
      path.join(executionDir, `TRIAGE_BLOCKED_${runId}.json`),
      path.join(executionDir, "ALERT_ROUTING.json"),
    ],
  };
}

export async function simulateCanarySloBreach(
  rootDir: string,
  sourceRoot: string,
): Promise<IncidentSimulationResult> {
  await fs.ensureDir(path.join(rootDir, "artifacts", "release"));
  await ensureDocs(rootDir, sourceRoot);
  const policy = await loadSloThresholds(rootDir);
  const metrics = simulatedBreachMetrics("error-rate");
  const evaluation = evaluateSloRollbackTriggers(metrics, policy);
  const artifact = await writeSloRollbackArtifact(rootDir, {
    generatedAt: new Date().toISOString(),
    environment: "canary",
    appName: "dexter",
    evaluation,
    execution: {
      triggered: true,
      rollbackId: "sim-rollback-1",
      rollbackMode: "simulated",
      triggers: evaluation.triggers,
      reason: "simulated canary SLO breach",
    },
  });

  const alerts = await routeAlertsFromOpsStatus({
    rootDir,
    dryRun: true,
    context: {
      runId: "sim-canary",
      runStatus: "degraded",
      slo: { state: "breach" },
    },
  });

  const passed = evaluation.triggered && alerts.matchedRules.includes("slo_breach");
  return {
    id: "canary_slo_breach_rollback",
    passed,
    detail: `triggered=${evaluation.triggered}, alerts=${alerts.matchedRules.join(",")}`,
    artifacts: [artifact.jsonPath, path.join(rootDir, "artifacts", "execution", "ALERT_ROUTING.json")],
  };
}

export async function simulatePromotionPolicyGate(
  rootDir: string,
  sourceRoot: string,
): Promise<IncidentSimulationResult> {
  await ensureDocs(rootDir, sourceRoot);
  let blocked = false;
  let reason = "";
  try {
    await assertPromotionAllowed({
      rootDir,
      targetEnvironment: "prod",
      controlPlane: "coolify",
      approvedBy: "dexter-release-manager",
      approverRole: "release-manager",
    });
  } catch (error) {
    blocked = true;
    reason = error instanceof Error ? error.message : "blocked";
  }

  await routeAlertsFromOpsStatus({
    rootDir,
    dryRun: true,
    context: {
      runId: "sim-promotion",
      runStatus: "healthy",
      slo: { state: "warn" },
    },
  });

  const passed = blocked && reason.toLowerCase().includes("canary");
  return {
    id: "promotion_policy_gate",
    passed,
    detail: reason,
    artifacts: [path.join(rootDir, "artifacts", "execution", "ALERT_ROUTING.json")],
  };
}

export async function runIncidentSimulations(
  rootDir: string,
  sourceRoot: string,
): Promise<IncidentSimulationReport> {
  const simulations = [
    await simulateBlockedEscalationStorm(rootDir, sourceRoot),
    await simulateCanarySloBreach(rootDir, sourceRoot),
    await simulatePromotionPolicyGate(rootDir, sourceRoot),
  ];
  const report: IncidentSimulationReport = {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    passed: simulations.every((simulation) => simulation.passed),
    simulations,
  };
  const reportPath = path.join(rootDir, "artifacts", "release", "INCIDENT_SIMULATION_REPORT.json");
  await fs.ensureDir(path.dirname(reportPath));
  await fs.writeJson(reportPath, report, { spaces: 2 });
  return report;
}
