import path from "node:path";
import fs from "fs-extra";

interface RunSummary {
  runId: string;
  project: string;
  durationMs: number;
  verificationPassed: boolean;
  deployed: boolean;
  memoryLessonsRetrieved: number;
  tasksTotal: number;
  tasksPassed: number;
}

function repeatedFailureRate(runs: RunSummary[]): number {
  if (runs.length < 2) {
    return 0;
  }
  const byProject = new Map<string, RunSummary[]>();
  for (const run of runs) {
    const items = byProject.get(run.project) ?? [];
    items.push(run);
    byProject.set(run.project, items);
  }

  let repeatFailureSignals = 0;
  let opportunities = 0;
  for (const projectRuns of byProject.values()) {
    const sorted = projectRuns.slice();
    for (let i = 1; i < sorted.length; i += 1) {
      opportunities += 1;
      if (!sorted[i - 1].verificationPassed && !sorted[i].verificationPassed) {
        repeatFailureSignals += 1;
      }
    }
  }
  return opportunities === 0 ? 0 : Number((repeatFailureSignals / opportunities).toFixed(4));
}

export async function buildMetricsReport(rootDir: string) {
  const runsDir = path.join(rootDir, "runs");
  await fs.ensureDir(runsDir);
  const entries = await fs.readdir(runsDir);
  const summaries: RunSummary[] = [];

  for (const entry of entries) {
    if (entry === "README.md") {
      continue;
    }
    const summaryPath = path.join(runsDir, entry, "run_summary.json");
    if (await fs.pathExists(summaryPath)) {
      summaries.push((await fs.readJson(summaryPath)) as RunSummary);
    }
  }

  const totalRuns = summaries.length;
  const readinessPassRate =
    totalRuns === 0
      ? 0
      : Number((summaries.filter((run) => run.verificationPassed).length / totalRuns).toFixed(4));
  const memoryHitRate =
    totalRuns === 0
      ? 0
      : Number((summaries.filter((run) => run.memoryLessonsRetrieved > 0).length / totalRuns).toFixed(4));
  const avgTimeToReadyMs =
    totalRuns === 0
      ? 0
      : Math.round(summaries.reduce((sum, run) => sum + run.durationMs, 0) / totalRuns);

  const report = {
    generatedAt: new Date().toISOString(),
    totalRuns,
    readinessPassRate,
    memoryHitRate,
    repeatedFailureRate: repeatedFailureRate(summaries),
    avgTimeToReadyMs,
    projects: Array.from(new Set(summaries.map((run) => run.project))).sort(),
  };

  const outputPath = path.join(rootDir, "artifacts", "release", "dogfood_metrics.json");
  await fs.ensureDir(path.dirname(outputPath));
  await fs.writeJson(outputPath, report, { spaces: 2 });
  return { outputPath, report };
}
