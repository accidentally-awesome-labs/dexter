import path from "node:path";
import fs from "fs-extra";
import { buildMetricsReport } from "../metrics/aggregator.js";

interface GoNoGoThresholds {
  readinessPassRate: number;
  memoryHitRate: number;
  repeatedFailureRateMax: number;
  avgTimeToReadyMsMax: number;
}

const thresholds: GoNoGoThresholds = {
  readinessPassRate: 0.95,
  memoryHitRate: 0.8,
  repeatedFailureRateMax: 0.05,
  avgTimeToReadyMsMax: 5000,
};

interface MetricsSnapshot {
  totalRuns: number;
  readinessPassRate: number;
  memoryHitRate: number;
  repeatedFailureRate: number;
  avgTimeToReadyMs: number;
}

interface EscalationStateItem {
  key: string;
  status: "open" | "in_progress" | "resolved" | "waived";
  target: "operator" | "planner";
  priority: "high" | "medium";
  reason: string;
}

interface EscalationState {
  items: EscalationStateItem[];
}

interface ReplanWavesSummary {
  stoppedReason?: string;
}

interface ReplanOutcomeWaiver {
  approvedBy: string;
  reason: string;
  outcomes: string[];
  expiresAt?: string;
}

async function readUnresolvedEscalations(rootDir: string): Promise<EscalationStateItem[]> {
  const statePath = path.join(rootDir, "artifacts", "execution", "ESCALATION_STATE.json");
  if (!(await fs.pathExists(statePath))) {
    return [];
  }
  const state = (await fs.readJson(statePath)) as EscalationState;
  return state.items.filter((item) => item.status === "open" || item.status === "in_progress");
}

async function readLatestReplanOutcome(rootDir: string): Promise<string | null> {
  const runsDir = path.join(rootDir, "runs");
  if (!(await fs.pathExists(runsDir))) {
    return null;
  }
  const runIds = await fs.readdir(runsDir);
  let latestRunDir: string | null = null;
  let latestSummaryMtime = 0;
  for (const runId of runIds) {
    const runDir = path.join(runsDir, runId);
    const summaryPath = path.join(runDir, "run_summary.json");
    if (!(await fs.pathExists(summaryPath))) {
      continue;
    }
    const stat = await fs.stat(summaryPath);
    const mtime = stat.mtimeMs;
    if (mtime > latestSummaryMtime) {
      latestSummaryMtime = mtime;
      latestRunDir = runDir;
    }
  }
  if (!latestRunDir) {
    return null;
  }
  const replanPath = path.join(latestRunDir, "replan_waves_summary.json");
  if (!(await fs.pathExists(replanPath))) {
    return null;
  }
  const replan = (await fs.readJson(replanPath)) as ReplanWavesSummary;
  return replan.stoppedReason ?? null;
}

async function readReplanOutcomeWaiver(rootDir: string): Promise<ReplanOutcomeWaiver | null> {
  const waiverPath = path.join(rootDir, "artifacts", "execution", "REPLAN_OUTCOME_WAIVER.json");
  if (!(await fs.pathExists(waiverPath))) {
    return null;
  }
  const waiver = (await fs.readJson(waiverPath)) as Partial<ReplanOutcomeWaiver>;
  if (!waiver.approvedBy || !waiver.reason || !Array.isArray(waiver.outcomes)) {
    return null;
  }
  if (waiver.expiresAt) {
    const expires = Date.parse(waiver.expiresAt);
    if (Number.isFinite(expires) && expires < Date.now()) {
      return null;
    }
  }
  return {
    approvedBy: waiver.approvedBy,
    reason: waiver.reason,
    outcomes: waiver.outcomes,
    expiresAt: waiver.expiresAt,
  };
}

function evaluate(report: MetricsSnapshot) {
  const checks = [
    {
      name: "Readiness pass rate",
      pass: report.readinessPassRate >= thresholds.readinessPassRate,
      value: report.readinessPassRate,
      threshold: `>= ${thresholds.readinessPassRate}`,
    },
    {
      name: "Memory hit rate",
      pass: report.memoryHitRate >= thresholds.memoryHitRate,
      value: report.memoryHitRate,
      threshold: `>= ${thresholds.memoryHitRate}`,
    },
    {
      name: "Repeated failure rate",
      pass: report.repeatedFailureRate <= thresholds.repeatedFailureRateMax,
      value: report.repeatedFailureRate,
      threshold: `<= ${thresholds.repeatedFailureRateMax}`,
    },
    {
      name: "Average time to ready (ms)",
      pass: report.avgTimeToReadyMs <= thresholds.avgTimeToReadyMsMax,
      value: report.avgTimeToReadyMs,
      threshold: `<= ${thresholds.avgTimeToReadyMsMax}`,
    },
  ];

  const go = checks.every((check) => check.pass);
  return { go, checks };
}

export async function generateGoNoGoDecision(rootDir: string): Promise<{
  outPath: string;
  decision: "GO" | "NO-GO";
  unresolvedEscalations: number;
  replanOutcome: string | null;
  replanGateWaived: boolean;
}> {
  const metrics = await buildMetricsReport(rootDir);
  const unresolvedEscalations = await readUnresolvedEscalations(rootDir);
  const replanOutcome = await readLatestReplanOutcome(rootDir);
  const replanWaiver = await readReplanOutcomeWaiver(rootDir);
  const replanGateOutcomes = new Set(["stalled", "max_waves"]);
  const replanGateFailed = replanOutcome ? replanGateOutcomes.has(replanOutcome) : false;
  const replanGateWaived =
    replanGateFailed && !!replanWaiver && replanWaiver.outcomes.includes(replanOutcome ?? "");
  const replanGatePassed = !replanGateFailed || replanGateWaived;
  const { go, checks } = evaluate(metrics.report);
  const escalationGatePassed = unresolvedEscalations.length === 0;
  const finalGo = go && escalationGatePassed && replanGatePassed;

  const lines = [
    "# GO_NO_GO",
    "",
    `Decision: **${finalGo ? "GO" : "NO-GO"}**`,
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    "## Metrics Snapshot",
    `- Total runs: ${metrics.report.totalRuns}`,
    `- Readiness pass rate: ${metrics.report.readinessPassRate}`,
    `- Memory hit rate: ${metrics.report.memoryHitRate}`,
    `- Repeated failure rate: ${metrics.report.repeatedFailureRate}`,
    `- Average time to ready (ms): ${metrics.report.avgTimeToReadyMs}`,
    "",
    "## Gate Criteria",
    ...checks.map((check) => `- [${check.pass ? "x" : " "}] ${check.name}: ${check.value} (${check.threshold})`),
    `- [${escalationGatePassed ? "x" : " "}] Unresolved required escalations: ${unresolvedEscalations.length} (must be 0)`,
    `- [${replanGatePassed ? "x" : " "}] Replan outcome: ${replanOutcome ?? "none"} (must not be stalled/max_waves unless waived)`,
    "",
    "## Unresolved Escalations",
    ...(unresolvedEscalations.length === 0
      ? ["- None"]
      : unresolvedEscalations.map(
          (item) => `- key=${item.key} status=${item.status} target=${item.target} priority=${item.priority} reason=${item.reason}`,
        )),
    "",
    "## Replan Outcome Waiver",
    ...(replanGateWaived && replanWaiver
      ? [
          `- approvedBy=${replanWaiver.approvedBy}`,
          `- reason=${replanWaiver.reason}`,
          `- outcomes=${replanWaiver.outcomes.join(",")}`,
          `- expiresAt=${replanWaiver.expiresAt ?? "none"}`,
        ]
      : ["- None"]),
    "",
    "## Notes",
    "- This decision is based on current run telemetry and gate thresholds.",
    "- Re-run pilot batch before final production promotion.",
  ];

  const outPath = path.join(rootDir, "artifacts", "release", "GO_NO_GO.md");
  await fs.ensureDir(path.dirname(outPath));
  await fs.writeFile(outPath, lines.join("\n"));

  return {
    outPath,
    decision: finalGo ? "GO" : "NO-GO",
    unresolvedEscalations: unresolvedEscalations.length,
    replanOutcome,
    replanGateWaived,
  };
}

async function main() {
  const rootDir = process.cwd();
  const result = await generateGoNoGoDecision(rootDir);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
