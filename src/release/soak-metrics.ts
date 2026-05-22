import type { SoakCycleResult, SoakStatus } from "./soak-types.js";
import type { SoakTrendsArtifact } from "./soak-trends.js";

export function maxConsecutivePassStreak(history: SoakCycleResult[]): number {
  let max = 0;
  let current = 0;
  for (const cycle of history) {
    if (cycle.passed) {
      current += 1;
      max = Math.max(max, current);
    } else {
      current = 0;
    }
  }
  return max;
}

export function trailingConsecutivePassStreak(history: SoakCycleResult[]): number {
  let count = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (!history[index]?.passed) {
      break;
    }
    count += 1;
  }
  return count;
}

export function recalculateSoakStatusFromHistory(
  history: SoakCycleResult[],
  targetStreak: number,
): Pick<
  SoakStatus,
  | "currentStreak"
  | "longestStreak"
  | "totalCycles"
  | "gateSatisfied"
  | "lastCycleAt"
  | "lastCyclePassed"
  | "lastFailureReason"
> {
  const totalCycles = history.length;
  const currentStreak = trailingConsecutivePassStreak(history);
  const longestStreak = maxConsecutivePassStreak(history);
  const last = history.at(-1);
  return {
    currentStreak,
    longestStreak,
    totalCycles,
    gateSatisfied: currentStreak >= targetStreak,
    lastCycleAt: last?.at,
    lastCyclePassed: last?.passed,
    lastFailureReason: last?.failureReason,
  };
}

export function pruneSoakHistoryAfter(
  history: SoakCycleResult[],
  cutoffIso: string,
): SoakCycleResult[] {
  const cutoffMs = Date.parse(cutoffIso);
  if (!Number.isFinite(cutoffMs)) {
    return history;
  }
  return history.filter((cycle) => Date.parse(cycle.at) < cutoffMs);
}

export function evaluateWeeklyPassRateTrend(trends: SoakTrendsArtifact | null): {
  passed: boolean;
  detail: string;
  latestPassRate: number | null;
  previousPassRate: number | null;
} {
  if (!trends || trends.weekly.length < 2) {
    return {
      passed: true,
      detail: "Insufficient weekly soak history; trend gate deferred.",
      latestPassRate: trends?.weekly.at(-1)?.passRate ?? null,
      previousPassRate: null,
    };
  }
  const latest = trends.weekly.at(-1)!;
  const previous = trends.weekly.at(-2)!;
  const passed = latest.passRate >= previous.passRate;
  return {
    passed,
    detail: `week ${previous.windowKey}=${previous.passRate} -> ${latest.windowKey}=${latest.passRate}`,
    latestPassRate: latest.passRate,
    previousPassRate: previous.passRate,
  };
}
