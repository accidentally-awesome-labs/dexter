import path from "node:path";
import fs from "fs-extra";
import type { OpsStatusPolicy } from "./ops-status-snapshot.js";

export interface RunSummaryCostInput {
  durationMs: number | null;
  explicitCostUsd: number | null;
  tasksTotal: number | null;
  tasksPassed: number | null;
  project: string | null;
}

export async function readRunSummaryCostInput(runDir: string): Promise<RunSummaryCostInput> {
  const summaryPath = path.join(runDir, "run_summary.json");
  if (!(await fs.pathExists(summaryPath))) {
    return {
      durationMs: null,
      explicitCostUsd: null,
      tasksTotal: null,
      tasksPassed: null,
      project: null,
    };
  }
  const summary = (await fs.readJson(summaryPath)) as {
    durationMs?: number;
    estimatedCostUsd?: number;
    tasksTotal?: number;
    tasksPassed?: number;
    project?: string;
  };
  return {
    durationMs: typeof summary.durationMs === "number" ? summary.durationMs : null,
    explicitCostUsd: typeof summary.estimatedCostUsd === "number" ? summary.estimatedCostUsd : null,
    tasksTotal: typeof summary.tasksTotal === "number" ? summary.tasksTotal : null,
    tasksPassed: typeof summary.tasksPassed === "number" ? summary.tasksPassed : null,
    project: summary.project ?? null,
  };
}

export async function readDogfoodBenchmark(rootDir: string): Promise<{
  present: boolean;
  avgTimeToReadyMs: number | null;
  totalRuns: number | null;
  path: string;
}> {
  const metricsPath = path.join(rootDir, "artifacts", "release", "dogfood_metrics.json");
  if (!(await fs.pathExists(metricsPath))) {
    return { present: false, avgTimeToReadyMs: null, totalRuns: null, path: metricsPath };
  }
  const metrics = (await fs.readJson(metricsPath)) as {
    avgTimeToReadyMs?: number;
    totalRuns?: number;
  };
  return {
    present: true,
    avgTimeToReadyMs: metrics.avgTimeToReadyMs ?? null,
    totalRuns: metrics.totalRuns ?? null,
    path: metricsPath,
  };
}

export function estimateCostUsd(input: {
  summary: RunSummaryCostInput;
  policy: OpsStatusPolicy;
  dogfoodAvgTimeToReadyMs: number | null;
}): {
  estimatedCostUsd: number | null;
  source: "run_summary.explicit" | "run_summary.duration" | "dogfood.benchmark" | "missing";
  degraded: boolean;
  degradationReasons: string[];
} {
  const reasons: string[] = [];
  if (input.summary.explicitCostUsd !== null) {
    return {
      estimatedCostUsd: input.summary.explicitCostUsd,
      source: "run_summary.explicit",
      degraded: false,
      degradationReasons: [],
    };
  }
  if (input.summary.durationMs !== null && input.summary.durationMs >= 0) {
    return {
      estimatedCostUsd: Number(
        ((input.summary.durationMs / 3_600_000) * input.policy.costModel.hourlyRateUsd).toFixed(4),
      ),
      source: "run_summary.duration",
      degraded: false,
      degradationReasons: [],
    };
  }
  if (input.dogfoodAvgTimeToReadyMs !== null && input.dogfoodAvgTimeToReadyMs > 0) {
    return {
      estimatedCostUsd: Number(
        ((input.dogfoodAvgTimeToReadyMs / 3_600_000) * input.policy.costModel.hourlyRateUsd).toFixed(4),
      ),
      source: "dogfood.benchmark",
      degraded: true,
      degradationReasons: ["run_summary.durationMs missing; used dogfood_metrics avgTimeToReadyMs benchmark"],
    };
  }
  if (input.summary.durationMs === null) {
    reasons.push("run_summary.durationMs missing");
  }
  if (input.dogfoodAvgTimeToReadyMs === null) {
    reasons.push("dogfood_metrics.json missing or empty");
  }
  return {
    estimatedCostUsd: null,
    source: "missing",
    degraded: true,
    degradationReasons: reasons,
  };
}
