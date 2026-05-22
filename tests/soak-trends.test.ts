import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { buildSoakTrends, updateSoakTrends, weeklyKey } from "../src/release/soak-trends.js";
import type { SoakCycleResult, SoakStatus } from "../src/release/soak-types.js";

function cycle(at: string, passed: boolean, failedStep?: string): SoakCycleResult {
  const steps = [
    { name: "trust-gates", command: "npm run trust:gates", exitCode: 0, durationMs: 100 },
    { name: "unit-tests", command: "npm run test:unit", exitCode: passed ? 0 : 1, durationMs: 200 },
  ];
  if (!passed && failedStep) {
    const target = steps.find((step) => step.name === failedStep);
    if (target) {
      target.exitCode = 1;
    }
  }
  return {
    at,
    passed,
    durationMs: 300,
    steps,
    failureReason: passed ? undefined : `${failedStep ?? "unit-tests"} failed`,
  };
}

function statusFromHistory(history: SoakCycleResult[]): SoakStatus {
  return {
    schemaVersion: "1.0",
    targetStreak: 3,
    currentStreak: 0,
    longestStreak: 0,
    totalCycles: history.length,
    gateSatisfied: false,
    history,
  };
}

describe("soak trends", () => {
  it("computes daily, weekly, and rolling100 windows", () => {
    const history = [
      cycle("2026-05-19T10:00:00.000Z", true),
      cycle("2026-05-19T18:00:00.000Z", false, "unit-tests"),
      cycle("2026-05-20T09:00:00.000Z", true),
      cycle("2026-05-21T08:00:00.000Z", true),
    ];
    const trends = buildSoakTrends(statusFromHistory(history), {
      generatedAt: "2026-05-21T12:00:00.000Z",
    });

    expect(trends.rolling100.totalCycles).toBe(4);
    expect(trends.rolling100.passedCycles).toBe(3);
    expect(trends.rolling100.passRate).toBe(0.75);
    expect(trends.daily.map((item) => item.windowKey)).toEqual(["2026-05-19", "2026-05-20", "2026-05-21"]);
    expect(trends.weekly.some((item) => item.windowKey === weeklyKey("2026-05-19T10:00:00.000Z"))).toBe(
      true,
    );
    expect(trends.query.dailyKeys).toEqual(trends.daily.map((item) => item.windowKey));
  });

  it("preserves historical daily and weekly windows across updates", () => {
    const first = buildSoakTrends(
      statusFromHistory([cycle("2026-05-10T10:00:00.000Z", true), cycle("2026-05-11T10:00:00.000Z", false, "unit-tests")]),
      { generatedAt: "2026-05-11T12:00:00.000Z" },
    );
    const second = buildSoakTrends(
      statusFromHistory([cycle("2026-05-21T10:00:00.000Z", true)]),
      { generatedAt: "2026-05-21T12:00:00.000Z", previous: first },
    );

    expect(second.daily.map((item) => item.windowKey)).toEqual(["2026-05-10", "2026-05-11", "2026-05-21"]);
    expect(second.daily.find((item) => item.windowKey === "2026-05-10")?.totalCycles).toBe(1);
    expect(second.weekly.length).toBeGreaterThanOrEqual(first.weekly.length);
  });

  it("limits rolling window metrics to the latest 100 cycles", () => {
    const history = Array.from({ length: 120 }, (_, index) =>
      cycle(`2026-01-${String((index % 28) + 1).padStart(2, "0")}T10:00:00.000Z`, index % 5 !== 0),
    );
    const trends = buildSoakTrends(statusFromHistory(history));
    expect(trends.rolling100.totalCycles).toBe(100);
    expect(trends.query.rolling100CycleCount).toBe(100);
    expect(trends.source.historyCyclesUsed).toBe(120);
  });

  it("writes trend artifact after soak status update", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-soak-trends-"));
    const status: SoakStatus = {
      schemaVersion: "1.0",
      targetStreak: 1,
      currentStreak: 1,
      longestStreak: 1,
      totalCycles: 2,
      gateSatisfied: true,
      history: [cycle("2026-05-20T10:00:00.000Z", true), cycle("2026-05-21T10:00:00.000Z", false, "unit-tests")],
    };
    await fs.ensureDir(path.join(rootDir, "artifacts", "release"));
    await fs.writeJson(path.join(rootDir, "artifacts", "release", "SOAK_STATUS.json"), status);

    const first = await updateSoakTrends(rootDir, status);
    const second = await updateSoakTrends(rootDir, {
      ...status,
      totalCycles: 3,
      history: [...status.history, cycle("2026-05-21T11:00:00.000Z", true)],
    });

    expect(await fs.pathExists(first.trendsPath)).toBe(true);
    expect(second.trends.rolling100.totalCycles).toBe(3);
    expect(second.trends.daily.length).toBeGreaterThanOrEqual(first.trends.daily.length);
    const day21 = second.trends.daily.find((item) => item.windowKey === "2026-05-21");
    expect(day21?.totalCycles).toBe(2);
    expect(day21?.passedCycles).toBe(1);
  });
});
