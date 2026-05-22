import path from "node:path";
import fs from "fs-extra";
import { writeOpsStatusArtifact } from "./ops-status.js";
import { buildResumeCheck } from "./run-selector.js";
import { evaluateAlertEvents, loadAlertRules } from "../operations/alert-routing.js";

export type TriageMode = "blocked" | "degraded";

interface ReplanSummary {
  stoppedReason?: string;
  maxWaves?: number;
  waves?: Array<{ wave: number; unresolvedAfterWave: number }>;
}

interface EscalationItem {
  key: string;
  status: string;
  target: string;
  priority?: string;
  reason: string;
  lastRunId?: string;
}

export interface RunTriageFinding {
  severity: "info" | "warn" | "critical";
  category: string;
  message: string;
}

export interface RunTriageReport {
  schemaVersion: "1.0";
  generatedAt: string;
  mode: TriageMode;
  runId: string;
  runStatus: string;
  diagnosisSummary: string;
  findings: RunTriageFinding[];
  resume: {
    allowed: boolean;
    reasons: string[];
  };
  ops: {
    jsonPath: string;
    markdownPath: string;
    unresolvedCount: number;
    sloState: string;
    queueDepth: number;
    escalationStale: boolean;
  };
  alerts: {
    matchedRules: string[];
  };
  replan: {
    stoppedReason: string | null;
    maxWaves: number | null;
    unresolvedAfterLastWave: number | null;
  };
  unresolvedEscalations: Array<{
    key: string;
    target: string;
    reason: string;
    priority: string;
  }>;
  nextSteps: string[];
  suggestedCommands: string[];
}

function uniqueCommands(commands: string[]): string[] {
  return [...new Set(commands)];
}

function buildDiagnosisSummary(input: {
  mode: TriageMode;
  runStatus: string;
  findings: RunTriageFinding[];
  resumeAllowed: boolean;
}): string {
  const critical = input.findings.filter((finding) => finding.severity === "critical").length;
  const warn = input.findings.filter((finding) => finding.severity === "warn").length;
  if (input.mode === "blocked") {
    return `Blocked run (${input.runStatus}): ${critical} critical and ${warn} warning finding(s). Resume ${input.resumeAllowed ? "allowed" : "blocked"}.`;
  }
  return `Degraded run (${input.runStatus}): ${critical} critical and ${warn} warning finding(s). Resume ${input.resumeAllowed ? "allowed" : "blocked"}.`;
}

export async function buildRunTriage(rootDir: string, runId: string, mode: TriageMode): Promise<RunTriageReport> {
  const runDir = path.join(rootDir, "runs", runId);
  const ops = await writeOpsStatusArtifact({ rootDir, runDir, runId });
  const dashboard = (await fs.readJson(ops.jsonPath)) as {
    runStatus?: string;
    unresolved?: { count?: number; keys?: string[] };
    slo?: { state?: string };
    queue?: { depth?: number };
    escalationAging?: { oldestUnresolved?: { bucket?: string } | null };
    nextCommands?: string[];
  };

  const resume = await buildResumeCheck(rootDir, runId);
  const rules = await loadAlertRules(rootDir);
  const alertEvents = evaluateAlertEvents(
    rules,
    {
      runId,
      runStatus: dashboard.runStatus ?? resume.runStatus,
      productionReady: (dashboard as { productionReady?: boolean }).productionReady,
      slo: dashboard.slo,
      queue: dashboard.queue as { backlogAging?: { stale?: number } },
      escalationAging: dashboard.escalationAging,
    },
    rootDir,
  );

  const replanPath = path.join(runDir, "replan_waves_summary.json");
  const replan = (await fs.pathExists(replanPath))
    ? ((await fs.readJson(replanPath)) as ReplanSummary)
    : null;
  const lastWave = replan?.waves?.[replan.waves.length - 1];

  const escalationStatePath = path.join(rootDir, "artifacts", "execution", "ESCALATION_STATE.json");
  const escalationItems: EscalationItem[] = (await fs.pathExists(escalationStatePath))
    ? (((await fs.readJson(escalationStatePath)) as { items?: EscalationItem[] }).items ?? []).filter(
        (item) => item.status === "open" || item.status === "in_progress",
      )
    : [];
  const runEscalations = escalationItems.filter((item) => item.lastRunId === runId || !item.lastRunId);
  const unresolvedEscalations = (runEscalations.length > 0 ? runEscalations : escalationItems).map((item) => ({
    key: item.key,
    target: item.target,
    reason: item.reason,
    priority: item.priority ?? "medium",
  }));

  const findings: RunTriageFinding[] = [];
  const runStatus = dashboard.runStatus ?? resume.runStatus;

  if (runStatus !== mode && runStatus !== "blocked" && mode === "blocked") {
    findings.push({
      severity: "warn",
      category: "run_status",
      message: `Latest ${mode} selector returned run with status=${runStatus}.`,
    });
  }
  if (runStatus === "blocked") {
    findings.push({
      severity: "critical",
      category: "run_status",
      message: "Run is blocked and requires operator intervention.",
    });
  } else if (runStatus === "degraded") {
    findings.push({
      severity: "warn",
      category: "run_status",
      message: "Run is degraded; review escalations and replan outcome before resume.",
    });
  }

  if (unresolvedEscalations.length > 0) {
    findings.push({
      severity: unresolvedEscalations.some((item) => item.target === "operator") ? "critical" : "warn",
      category: "escalations",
      message: `${unresolvedEscalations.length} unresolved escalation(s) remain.`,
    });
  }

  if (dashboard.slo?.state === "breach") {
    findings.push({
      severity: "critical",
      category: "slo",
      message: "SLO burn state is breach; hold promotion until recovery.",
    });
  } else if (dashboard.slo?.state === "warn") {
    findings.push({
      severity: "warn",
      category: "slo",
      message: "SLO burn state is warn; monitor before promoting.",
    });
  }

  if (dashboard.escalationAging?.oldestUnresolved?.bucket === "stale") {
    findings.push({
      severity: "warn",
      category: "escalation_aging",
      message: "Oldest unresolved escalation is stale.",
    });
  }

  if (replan?.stoppedReason === "max_waves") {
    findings.push({
      severity: "warn",
      category: "replan",
      message: `Replan stopped at max waves (${replan.maxWaves ?? "unknown"}).`,
    });
  }

  const nextSteps: string[] = [];
  if (mode === "blocked") {
    nextSteps.push("Review blocked-run triage findings and unresolved operator escalations.");
    nextSteps.push("Resolve or waive escalations, then rerun resume check.");
    if (!resume.resumeAllowed) {
      nextSteps.push("Do not resume until all blocking reasons are cleared.");
    } else {
      nextSteps.push("Resume the run once verification gates pass.");
    }
  } else {
    nextSteps.push("Inspect degraded replan outcome and planner escalations.");
    nextSteps.push("Clear medium-priority planner escalations or waive with metadata.");
    nextSteps.push("Re-run ops status after remediation.");
  }

  const suggestedCommands = uniqueCommands([
    ...(dashboard.nextCommands ?? []),
    ...resume.suggestedCommands,
    "npm run ops:status",
    "npm run alert:route",
    mode === "blocked"
      ? "npm run resume:check -- --latest-blocked true --triage true --output table"
      : "npm run resume:check -- --latest-degraded true --triage true --output table",
    mode === "blocked"
      ? "npm run run:resume -- --latest-blocked true"
      : "npm run run:resume -- --latest-degraded true",
    unresolvedEscalations.length > 0
      ? "npm run escalation:list -- --unresolved-only true --output table"
      : "npm run release:decision",
  ]);

  const report: RunTriageReport = {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    mode,
    runId,
    runStatus,
    diagnosisSummary: buildDiagnosisSummary({
      mode,
      runStatus,
      findings,
      resumeAllowed: resume.resumeAllowed,
    }),
    findings,
    resume: {
      allowed: resume.resumeAllowed,
      reasons: resume.reasons,
    },
    ops: {
      jsonPath: ops.jsonPath,
      markdownPath: ops.markdownPath,
      unresolvedCount: dashboard.unresolved?.count ?? unresolvedEscalations.length,
      sloState: dashboard.slo?.state ?? "unknown",
      queueDepth: dashboard.queue?.depth ?? 0,
      escalationStale: dashboard.escalationAging?.oldestUnresolved?.bucket === "stale",
    },
    alerts: {
      matchedRules: alertEvents.map((event) => event.ruleId),
    },
    replan: {
      stoppedReason: replan?.stoppedReason ?? null,
      maxWaves: replan?.maxWaves ?? null,
      unresolvedAfterLastWave: lastWave?.unresolvedAfterWave ?? null,
    },
    unresolvedEscalations,
    nextSteps,
    suggestedCommands,
  };

  const executionDir = path.join(rootDir, "artifacts", "execution");
  await fs.ensureDir(executionDir);
  const triagePath = path.join(executionDir, `TRIAGE_${mode.toUpperCase()}_${runId}.json`);
  await fs.writeJson(triagePath, report, { spaces: 2 });
  await fs.writeFile(
    path.join(executionDir, `TRIAGE_${mode.toUpperCase()}_${runId}.md`),
    [
      `# Run Triage (${mode})`,
      "",
      `Generated at: ${report.generatedAt}`,
      `Run: ${report.runId}`,
      `Status: ${report.runStatus}`,
      "",
      report.diagnosisSummary,
      "",
      "## Findings",
      ...(report.findings.length === 0
        ? ["- none"]
        : report.findings.map((finding) => `- [${finding.severity}] ${finding.category}: ${finding.message}`)),
      "",
      "## Next Steps",
      ...report.nextSteps.map((step) => `- ${step}`),
      "",
      "## Suggested Commands",
      ...report.suggestedCommands.map((cmd) => `- ${cmd}`),
      "",
    ].join("\n"),
  );

  return report;
}
