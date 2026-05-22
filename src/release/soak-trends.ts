import path from "node:path";
import fs from "fs-extra";
import type { SoakCycleResult, SoakStatus } from "./soak-types.js";

export type SoakTrendWindowType = "daily" | "weekly" | "rolling100";

export interface SoakWindowMetrics {
  windowType: SoakTrendWindowType;
  windowKey: string;
  periodStart: string;
  periodEnd: string;
  totalCycles: number;
  passedCycles: number;
  failedCycles: number;
  passRate: number;
  avgDurationMs: number;
  stepFailureCounts: Record<string, number>;
  lastUpdatedAt: string;
}

export interface SoakTrendsQueryIndex {
  dailyKeys: string[];
  weeklyKeys: string[];
  rolling100CycleCount: number;
}

export interface SoakTrendsArtifact {
  schemaVersion: "1.0";
  generatedAt: string;
  source: {
    statusPath: string;
    totalCyclesInSource: number;
    historyCyclesUsed: number;
  };
  rolling100: SoakWindowMetrics;
  daily: SoakWindowMetrics[];
  weekly: SoakWindowMetrics[];
  query: SoakTrendsQueryIndex;
}

export function soakTrendsPath(rootDir: string): string {
  return path.join(rootDir, "artifacts", "release", "SOAK_TRENDS.json");
}

function dailyKey(iso: string): string {
  return iso.slice(0, 10);
}

export function weeklyKey(iso: string): string {
  const date = new Date(iso);
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utc.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function failedStepName(cycle: SoakCycleResult): string | undefined {
  if (cycle.passed) {
    return undefined;
  }
  const failed = cycle.steps.find((step) => step.exitCode !== 0);
  return failed?.name ?? "unknown";
}

export function computeWindowMetrics(
  windowType: SoakTrendWindowType,
  windowKey: string,
  cycles: SoakCycleResult[],
  updatedAt: string,
): SoakWindowMetrics {
  const sorted = [...cycles].sort((left, right) => left.at.localeCompare(right.at));
  const totalCycles = sorted.length;
  const passedCycles = sorted.filter((cycle) => cycle.passed).length;
  const failedCycles = totalCycles - passedCycles;
  const stepFailureCounts: Record<string, number> = {};

  for (const cycle of sorted) {
    const step = failedStepName(cycle);
    if (step) {
      stepFailureCounts[step] = (stepFailureCounts[step] ?? 0) + 1;
    }
  }

  return {
    windowType,
    windowKey,
    periodStart: sorted[0]?.at ?? updatedAt,
    periodEnd: sorted[sorted.length - 1]?.at ?? updatedAt,
    totalCycles,
    passedCycles,
    failedCycles,
    passRate: totalCycles === 0 ? 0 : Math.round((passedCycles / totalCycles) * 1000) / 1000,
    avgDurationMs:
      totalCycles === 0
        ? 0
        : Math.round(sorted.reduce((sum, cycle) => sum + cycle.durationMs, 0) / totalCycles),
    stepFailureCounts,
    lastUpdatedAt: updatedAt,
  };
}

function groupCyclesByKey(
  cycles: SoakCycleResult[],
  keyFn: (iso: string) => string,
): Map<string, SoakCycleResult[]> {
  const groups = new Map<string, SoakCycleResult[]>();
  for (const cycle of cycles) {
    const key = keyFn(cycle.at);
    const bucket = groups.get(key) ?? [];
    bucket.push(cycle);
    groups.set(key, bucket);
  }
  return groups;
}

function metricsMapFromCycles(
  cycles: SoakCycleResult[],
  windowType: "daily" | "weekly",
  keyFn: (iso: string) => string,
  updatedAt: string,
): Map<string, SoakWindowMetrics> {
  const grouped = groupCyclesByKey(cycles, keyFn);
  const metrics = new Map<string, SoakWindowMetrics>();
  for (const [key, bucket] of grouped) {
    metrics.set(key, computeWindowMetrics(windowType, key, bucket, updatedAt));
  }
  return metrics;
}

function mergePreservedWindows(
  previous: SoakWindowMetrics[],
  current: Map<string, SoakWindowMetrics>,
): SoakWindowMetrics[] {
  const merged = new Map<string, SoakWindowMetrics>();
  for (const item of previous) {
    merged.set(item.windowKey, item);
  }
  for (const [key, item] of current) {
    merged.set(key, item);
  }
  return [...merged.values()].sort((left, right) => left.windowKey.localeCompare(right.windowKey));
}

export function buildSoakTrends(
  status: SoakStatus,
  options?: {
    generatedAt?: string;
    previous?: SoakTrendsArtifact | null;
    statusPath?: string;
  },
): SoakTrendsArtifact {
  const generatedAt = options?.generatedAt ?? new Date().toISOString();
  const history = [...status.history].sort((left, right) => left.at.localeCompare(right.at));
  const rollingCycles = history.slice(-100);
  const dailyCurrent = metricsMapFromCycles(history, "daily", dailyKey, generatedAt);
  const weeklyCurrent = metricsMapFromCycles(history, "weekly", weeklyKey, generatedAt);

  const daily = mergePreservedWindows(options?.previous?.daily ?? [], dailyCurrent);
  const weekly = mergePreservedWindows(options?.previous?.weekly ?? [], weeklyCurrent);
  const rolling100 = computeWindowMetrics(
    "rolling100",
    "rolling-100",
    rollingCycles,
    generatedAt,
  );

  return {
    schemaVersion: "1.0",
    generatedAt,
    source: {
      statusPath: options?.statusPath ?? "artifacts/release/SOAK_STATUS.json",
      totalCyclesInSource: status.totalCycles,
      historyCyclesUsed: history.length,
    },
    rolling100,
    daily,
    weekly,
    query: {
      dailyKeys: daily.map((item) => item.windowKey),
      weeklyKeys: weekly.map((item) => item.windowKey),
      rolling100CycleCount: rollingCycles.length,
    },
  };
}

export async function loadSoakTrends(rootDir: string): Promise<SoakTrendsArtifact | null> {
  const file = soakTrendsPath(rootDir);
  if (!(await fs.pathExists(file))) {
    return null;
  }
  return (await fs.readJson(file)) as SoakTrendsArtifact;
}

export async function updateSoakTrends(
  rootDir: string,
  status: SoakStatus,
): Promise<{ trendsPath: string; trends: SoakTrendsArtifact }> {
  const previous = await loadSoakTrends(rootDir);
  const trends = buildSoakTrends(status, {
    previous,
    statusPath: "artifacts/release/SOAK_STATUS.json",
  });
  const trendsPath = soakTrendsPath(rootDir);
  await fs.ensureDir(path.dirname(trendsPath));
  await fs.writeJson(trendsPath, trends, { spaces: 2 });
  return { trendsPath, trends };
}
