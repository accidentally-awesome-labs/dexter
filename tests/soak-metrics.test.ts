import { describe, expect, it } from "vitest";
import {
  evaluateWeeklyPassRateTrend,
  maxConsecutivePassStreak,
  trailingConsecutivePassStreak,
} from "../src/release/soak-metrics.js";
import { buildSoakTrends } from "../src/release/soak-trends.js";
import type { SoakCycleResult, SoakStatus } from "../src/release/soak-types.js";

function cycle(at: string, passed: boolean): SoakCycleResult {
  return {
    at,
    passed,
    durationMs: 100,
    steps: [{ name: "unit-tests", command: "npm run test:unit", exitCode: passed ? 0 : 1, durationMs: 100 }],
  };
}

describe("soak metrics", () => {
  it("computes max and trailing consecutive pass streaks", () => {
    const history = [
      cycle("2026-05-19T10:00:00.000Z", true),
      cycle("2026-05-20T10:00:00.000Z", false),
      cycle("2026-05-21T09:00:00.000Z", true),
      cycle("2026-05-21T10:00:00.000Z", true),
      cycle("2026-05-21T11:00:00.000Z", true),
    ];
    expect(maxConsecutivePassStreak(history)).toBe(3);
    expect(trailingConsecutivePassStreak(history)).toBe(3);
  });

  it("evaluates weekly pass-rate trend as non-declining", () => {
    const status: SoakStatus = {
      schemaVersion: "1.0",
      targetStreak: 1,
      currentStreak: 1,
      longestStreak: 1,
      totalCycles: 4,
      gateSatisfied: true,
      history: [
        cycle("2026-05-12T10:00:00.000Z", true),
        cycle("2026-05-12T11:00:00.000Z", false),
        cycle("2026-05-19T10:00:00.000Z", true),
        cycle("2026-05-19T11:00:00.000Z", true),
      ],
    };
    const trends = buildSoakTrends(status);
    const trend = evaluateWeeklyPassRateTrend(trends);
    expect(trend.passed).toBe(true);
    expect(trend.latestPassRate).not.toBeNull();
  });
});
