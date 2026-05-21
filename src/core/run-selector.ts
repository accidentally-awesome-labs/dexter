import path from "node:path";
import fs from "fs-extra";

interface RunSummary {
  runId?: string;
  runStatus?: string;
  startedAt?: string;
  productionReady?: boolean;
}

export async function findLatestRunId(rootDir: string): Promise<string | null> {
  const runsDir = path.join(rootDir, "runs");
  if (!(await fs.pathExists(runsDir))) {
    return null;
  }
  const entries = await fs.readdir(runsDir);
  const runs: Array<{ runId: string; startedAt: string; mtimeMs: number }> = [];
  for (const runId of entries) {
    const runPath = path.join(runsDir, runId);
    const stat = await fs.stat(runPath).catch(() => null);
    if (!stat?.isDirectory()) {
      continue;
    }
    const summaryPath = path.join(runPath, "run_summary.json");
    if (!(await fs.pathExists(summaryPath))) {
      continue;
    }
    const summary = (await fs.readJson(summaryPath)) as RunSummary;
    runs.push({
      runId,
      startedAt: summary.startedAt ?? "",
      mtimeMs: stat.mtimeMs,
    });
  }
  if (runs.length === 0) {
    return null;
  }
  runs.sort((a, b) => {
    const byStarted = b.startedAt.localeCompare(a.startedAt);
    if (byStarted !== 0) {
      return byStarted;
    }
    return b.mtimeMs - a.mtimeMs;
  });
  return runs[0]!.runId;
}

async function findLatestRunIdByStatus(rootDir: string, runStatus: "blocked" | "degraded"): Promise<string | null> {
  const runsDir = path.join(rootDir, "runs");
  if (!(await fs.pathExists(runsDir))) {
    return null;
  }
  const entries = await fs.readdir(runsDir);
  const matched: Array<{ runId: string; startedAt: string; mtimeMs: number }> = [];
  for (const runId of entries) {
    const runPath = path.join(runsDir, runId);
    const stat = await fs.stat(runPath).catch(() => null);
    if (!stat?.isDirectory()) {
      continue;
    }
    const summaryPath = path.join(runPath, "run_summary.json");
    if (!(await fs.pathExists(summaryPath))) {
      continue;
    }
    const summary = (await fs.readJson(summaryPath)) as RunSummary;
    if (summary.runStatus !== runStatus) {
      continue;
    }
    matched.push({
      runId,
      startedAt: summary.startedAt ?? "",
      mtimeMs: stat.mtimeMs,
    });
  }
  if (matched.length === 0) {
    return null;
  }
  matched.sort((a, b) => {
    const byStarted = b.startedAt.localeCompare(a.startedAt);
    if (byStarted !== 0) {
      return byStarted;
    }
    return b.mtimeMs - a.mtimeMs;
  });
  return matched[0]!.runId;
}

export async function findLatestBlockedRunId(rootDir: string): Promise<string | null> {
  return findLatestRunIdByStatus(rootDir, "blocked");
}

export async function findLatestDegradedRunId(rootDir: string): Promise<string | null> {
  return findLatestRunIdByStatus(rootDir, "degraded");
}

interface EscalationStateItem {
  key: string;
  status: "open" | "in_progress" | "resolved" | "waived";
  target: "operator" | "planner";
  reason: string;
}

export async function buildResumeCheck(rootDir: string, runId: string): Promise<{
  runId: string;
  runStatus: string;
  resumeAllowed: boolean;
  unresolvedEscalations: EscalationStateItem[];
  reasons: string[];
  suggestedCommands: string[];
}> {
  const runDir = path.join(rootDir, "runs", runId);
  const summaryPath = path.join(runDir, "run_summary.json");
  if (!(await fs.pathExists(summaryPath))) {
    throw new Error(`Run summary not found for ${runId}`);
  }
  const summary = (await fs.readJson(summaryPath)) as RunSummary;

  const statePath = path.join(rootDir, "artifacts", "execution", "ESCALATION_STATE.json");
  const unresolvedEscalations: EscalationStateItem[] = (await fs.pathExists(statePath))
    ? (((await fs.readJson(statePath)) as { items: EscalationStateItem[] }).items ?? []).filter(
        (item) => item.status === "open" || item.status === "in_progress",
      )
    : [];

  const reasons: string[] = [];
  const suggestedCommands: string[] = [];
  if (summary.runStatus === "blocked") {
    reasons.push("Run is blocked.");
  }
  if (unresolvedEscalations.length > 0) {
    reasons.push(`There are ${unresolvedEscalations.length} unresolved escalation(s).`);
    for (const item of unresolvedEscalations) {
      suggestedCommands.push(
        `npm run escalation:resolve -- --key "${item.key}" --status resolved --note "resolved during resume flow"`,
      );
    }
  }
  const resumeAllowed = reasons.length === 0;
  if (resumeAllowed) {
    suggestedCommands.push(`npm run run:resume -- --run-id ${runId}`);
  } else {
    suggestedCommands.push("npm run escalation:list -- --unresolved-only true");
  }

  return {
    runId,
    runStatus: summary.runStatus ?? "unknown",
    resumeAllowed,
    unresolvedEscalations,
    reasons,
    suggestedCommands,
  };
}
