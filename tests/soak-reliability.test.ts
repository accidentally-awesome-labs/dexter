import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { loadSoakSchedulePolicy } from "../src/release/soak-schedule-policy.js";
import {
  buildSoakReliabilityReport,
  buildSoakReliabilitySnapshot,
  countConsecutiveFailures,
  evaluateSoakReliabilityWarnings,
  updateSoakReliability,
} from "../src/release/soak-reliability.js";
import { buildSoakTrends } from "../src/release/soak-trends.js";
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
  const currentStreak = history.reduceRight((streak, item) => (item.passed ? streak + 1 : 0), 0);
  return {
    schemaVersion: "1.0",
    targetStreak: 3,
    currentStreak,
    longestStreak: currentStreak,
    totalCycles: history.length,
    gateSatisfied: false,
    history,
  };
}

describe("soak reliability", () => {
  it("counts consecutive failures from latest history", () => {
    const status = statusFromHistory([
      cycle("2026-05-19T10:00:00.000Z", true),
      cycle("2026-05-20T10:00:00.000Z", false, "unit-tests"),
      cycle("2026-05-21T10:00:00.000Z", false, "unit-tests"),
    ]);
    expect(countConsecutiveFailures(status)).toBe(2);
  });

  it("emits warnings for pass-rate drop and consecutive failures", async () => {
    const policy = await loadSoakSchedulePolicy(process.cwd());
    const status = statusFromHistory([
      cycle("2026-05-19T10:00:00.000Z", true),
      cycle("2026-05-20T10:00:00.000Z", true),
      cycle("2026-05-21T10:00:00.000Z", false, "unit-tests"),
      cycle("2026-05-21T11:00:00.000Z", false, "unit-tests"),
    ]);
    const trends = buildSoakTrends(status);
    const previousSnapshot = buildSoakReliabilitySnapshot(
      buildSoakTrends(
        statusFromHistory([
          cycle("2026-05-19T10:00:00.000Z", true),
          cycle("2026-05-20T10:00:00.000Z", true),
          cycle("2026-05-21T09:00:00.000Z", true),
        ]),
      ),
      statusFromHistory([cycle("2026-05-21T09:00:00.000Z", true)]),
    );
    const snapshot = buildSoakReliabilitySnapshot(trends, status);
    const warnings = evaluateSoakReliabilityWarnings(snapshot, previousSnapshot, policy.warningThresholds);
    expect(warnings.some((warning) => warning.id === "rolling100-pass-rate-drop")).toBe(true);
    expect(warnings.some((warning) => warning.id === "consecutive-failures-warn")).toBe(true);
  });

  it("writes reliability artifact with run-to-run deltas", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-soak-reliability-"));
    const policy = await loadSoakSchedulePolicy(process.cwd());
    await fs.ensureDir(path.join(rootDir, "docs", "operations"));
    await fs.writeJson(path.join(rootDir, "docs", "operations", "SOAK_SCHEDULE_POLICY.json"), policy, { spaces: 2 });

    const status = statusFromHistory([
      cycle("2026-05-19T10:00:00.000Z", true),
      cycle("2026-05-20T10:00:00.000Z", true),
      cycle("2026-05-21T09:00:00.000Z", true),
    ]);
    const trends = buildSoakTrends(status);
    await fs.ensureDir(path.join(rootDir, "artifacts", "release"));
    await fs.writeJson(path.join(rootDir, "artifacts", "release", "SOAK_STATUS.json"), status);
    await fs.writeJson(path.join(rootDir, "artifacts", "release", "SOAK_TRENDS.json"), trends);

    const first = await updateSoakReliability(rootDir, { trends, status });
    const secondStatus = statusFromHistory([
      ...status.history,
      cycle("2026-05-21T10:00:00.000Z", false, "unit-tests"),
      cycle("2026-05-21T11:00:00.000Z", false, "unit-tests"),
    ]);
    const secondTrends = buildSoakTrends(secondStatus, { previous: trends });
    const second = await updateSoakReliability(rootDir, { trends: secondTrends, status: secondStatus });

    expect(first.report.reliabilityStatus).toBe("healthy");
    expect(second.report.comparedToGeneratedAt).toBe(first.report.generatedAt);
    expect(second.report.deltas.rolling100PassRate.delta).not.toBeNull();
    expect(second.report.warnings.length).toBeGreaterThan(0);
    await fs.remove(rootDir);
  });

  it("marks reliability critical when pass-rate floor is breached", () => {
    const policyThresholds = {
      rolling100PassRateDropMin: 0.05,
      rolling100PassRateFloor: 0.9,
      consecutiveFailuresWarn: 2,
      consecutiveFailuresCritical: 3,
      avgDurationIncreasePct: 0.25,
      dailyPassRateDropMin: 0.1,
      stepFailureSpikeMin: 2,
    };
    const status = statusFromHistory(
      Array.from({ length: 10 }, (_, index) =>
        cycle(`2026-05-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`, index < 2),
      ),
    );
    const trends = buildSoakTrends(status);
    const report = buildSoakReliabilityReport({
      trends,
      status,
      previousReport: null,
      thresholds: policyThresholds,
    });
    expect(report.reliabilityStatus).toBe("critical");
    expect(report.warnings.some((warning) => warning.id === "rolling100-pass-rate-floor")).toBe(true);
  });
});
