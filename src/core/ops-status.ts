import path from "node:path";
import fs from "fs-extra";

type EscalationStatus = "open" | "in_progress" | "resolved" | "waived";
type EscalationTarget = "operator" | "planner";
type EscalationPriority = "high" | "medium";
type RunStatus = "healthy" | "degraded" | "blocked" | "unknown";

interface RunSummary {
  runId?: string;
  runStatus?: string;
  productionReady?: boolean;
}

interface EscalationItem {
  key: string;
  status: EscalationStatus;
  target: EscalationTarget;
  priority: EscalationPriority;
  reason: string;
  lastRunId: string;
}

interface ReplanSummary {
  maxWaves?: number;
  stoppedReason?: string;
  waves?: Array<{
    wave: number;
    attempted: boolean;
    stalled: boolean;
    runStatusAfterWave: string;
    unresolvedAfterWave: number;
  }>;
}

export async function writeOpsStatusArtifact(options: {
  rootDir: string;
  runDir: string;
  runId: string;
}): Promise<{
  jsonPath: string;
  markdownPath: string;
}> {
  const { rootDir, runDir, runId } = options;
  const executionDir = path.join(rootDir, "artifacts", "execution");
  await fs.ensureDir(executionDir);

  const runSummaryPath = path.join(runDir, "run_summary.json");
  const runSummary: RunSummary | null = (await fs.pathExists(runSummaryPath))
    ? ((await fs.readJson(runSummaryPath)) as RunSummary)
    : null;

  const escalationStatePath = path.join(executionDir, "ESCALATION_STATE.json");
  const escalationItems: EscalationItem[] = (await fs.pathExists(escalationStatePath))
    ? (((await fs.readJson(escalationStatePath)) as { items?: EscalationItem[] }).items ?? [])
    : [];

  const unresolvedStatuses = new Set<EscalationStatus>(["open", "in_progress"]);
  const unresolvedAll = escalationItems.filter((item) => unresolvedStatuses.has(item.status));
  const unresolvedRun = unresolvedAll.filter((item) => item.lastRunId === runId);
  const unresolved = unresolvedRun.length > 0 ? unresolvedRun : unresolvedAll;

  const unresolvedOperatorHigh = unresolved.filter((item) => item.target === "operator" && item.priority === "high").length;
  const unresolvedPlanner = unresolved.filter((item) => item.target === "planner").length;

  const replanPath = path.join(runDir, "replan_waves_summary.json");
  const replan = (await fs.pathExists(replanPath)) ? ((await fs.readJson(replanPath)) as ReplanSummary) : null;

  const runStatus = (runSummary?.runStatus as RunStatus | undefined) ?? "unknown";
  const resumeAllowed = unresolved.length === 0 && runStatus === "healthy";

  const nextCommands: string[] = [];
  if (unresolved.length > 0) {
    nextCommands.push("npm run escalation:list -- --unresolved-only true --output table");
    nextCommands.push('npm run escalation:resolve -- --all-unresolved true --status resolved --note "resolved from ops dashboard"');
  }
  if (unresolvedOperatorHigh > 0) {
    nextCommands.push('npm run escalation:resolve -- --all-unresolved true --target operator --status resolved --note "operator escalation resolved"');
  }
  if (runStatus === "blocked") {
    nextCommands.push("npm run resume:check -- --latest-blocked true --output table");
    nextCommands.push("npm run run:resume -- --latest-blocked true");
  } else if (runStatus === "degraded") {
    nextCommands.push("npm run resume:check -- --latest-degraded true --output table");
    nextCommands.push("npm run run:resume -- --latest-degraded true");
  } else if (runStatus === "healthy") {
    nextCommands.push("npm run release:decision");
    nextCommands.push("npm run verify");
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    runId,
    runStatus,
    productionReady: runSummary?.productionReady ?? false,
    unresolved: {
      count: unresolved.length,
      operatorHigh: unresolvedOperatorHigh,
      planner: unresolvedPlanner,
      keys: unresolved.map((item) => item.key),
    },
    replan: replan
      ? {
          stoppedReason: replan.stoppedReason ?? "unknown",
          maxWaves: replan.maxWaves ?? null,
          attemptedWaves: replan.waves?.length ?? 0,
        }
      : null,
    resume: {
      allowed: resumeAllowed,
      reason: resumeAllowed ? "Run is healthy with no unresolved escalations." : "Resolve unresolved escalations before resuming.",
    },
    nextCommands,
  };

  const jsonPath = path.join(executionDir, "OPS_STATUS.json");
  const markdownPath = path.join(executionDir, "OPS_STATUS.md");
  await fs.writeJson(jsonPath, payload, { spaces: 2 });
  await fs.writeFile(
    markdownPath,
    [
      "# Ops Status",
      "",
      `Generated at: ${payload.generatedAt}`,
      `Run ID: ${payload.runId}`,
      `Run status: ${payload.runStatus}`,
      `Production ready: ${payload.productionReady}`,
      "",
      "## Unresolved Escalations",
      `- Count: ${payload.unresolved.count}`,
      `- Operator high: ${payload.unresolved.operatorHigh}`,
      `- Planner: ${payload.unresolved.planner}`,
      ...(payload.unresolved.keys.length > 0 ? payload.unresolved.keys.map((key) => `- key=${key}`) : ["- None"]),
      "",
      "## Replan",
      ...(payload.replan
        ? [
            `- Stopped reason: ${payload.replan.stoppedReason}`,
            `- Max waves: ${payload.replan.maxWaves ?? "none"}`,
            `- Attempted waves: ${payload.replan.attemptedWaves}`,
          ]
        : ["- No replan data for this run"]),
      "",
      "## Resume Readiness",
      `- Allowed: ${payload.resume.allowed}`,
      `- Reason: ${payload.resume.reason}`,
      "",
      "## Next Commands",
      ...(payload.nextCommands.length > 0 ? payload.nextCommands.map((cmd) => `- ${cmd}`) : ["- None"]),
      "",
    ].join("\n"),
  );

  await fs.writeJson(path.join(runDir, "ops_status_summary.json"), payload, { spaces: 2 });
  return { jsonPath, markdownPath };
}
