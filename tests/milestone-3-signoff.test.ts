import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { generateMilestone3Signoff } from "../src/operations/milestone-3-signoff.js";
import { buildSoakTrends } from "../src/release/soak-trends.js";
import type { SoakCycleResult, SoakStatus } from "../src/release/soak-types.js";

function passCycle(at: string): SoakCycleResult {
  return {
    at,
    passed: true,
    durationMs: 100,
    steps: [{ name: "unit-tests", command: "npm run test:unit", exitCode: 0, durationMs: 100 }],
  };
}

describe("milestone 3 signoff", () => {
  it("passes when 30+ consecutive soak passes and reliability gates are satisfied", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-m3-signoff-"));
    await fs.copy(path.join(process.cwd(), "docs/operations"), path.join(rootDir, "docs/operations"));
    await fs.copy(path.join(process.cwd(), "docs/specs"), path.join(rootDir, "docs/specs"));
    await fs.copy(path.join(process.cwd(), "global-memory"), path.join(rootDir, "global-memory"));

    const history = Array.from({ length: 32 }, (_, index) =>
      passCycle(`2026-05-${String((index % 28) + 1).padStart(2, "0")}T10:00:00.000Z`),
    );
    const status: SoakStatus = {
      schemaVersion: "1.0",
      targetStreak: 30,
      currentStreak: 32,
      longestStreak: 32,
      totalCycles: 32,
      gateSatisfied: true,
      lastCyclePassed: true,
      history,
    };

    await fs.ensureDir(path.join(rootDir, "artifacts/release"));
    await fs.writeJson(path.join(rootDir, "artifacts/release/SOAK_STATUS.json"), status);
    await fs.writeJson(path.join(rootDir, "artifacts/release/SOAK_TRENDS.json"), buildSoakTrends(status));
    await fs.writeJson(path.join(rootDir, "artifacts/release/SOAK_RELIABILITY.json"), {
      schemaVersion: "1.0",
      generatedAt: new Date().toISOString(),
      comparedToGeneratedAt: null,
      reliabilityStatus: "healthy",
      deltas: {
        rolling100PassRate: { current: 1, previous: null, delta: null },
        rolling100FailedCycles: { current: 0, previous: null, delta: null },
        rolling100AvgDurationMs: { current: 100, previous: null, delta: null },
        dailyPassRate: null,
        consecutiveFailures: { current: 0, previous: null, delta: null },
      },
      latestCycle: { passed: true, previousPassed: true, currentStreak: 32, streakDelta: null },
      warnings: [],
      snapshot: {
        rolling100PassRate: 1,
        rolling100FailedCycles: 0,
        rolling100AvgDurationMs: 100,
        consecutiveFailures: 0,
        currentStreak: 32,
        latestCyclePassed: true,
        dailyPassRate: 1,
        dailyWindowKey: "2026-05-01",
        topStepFailure: null,
        topStepFailureCount: 0,
      },
    });

    await fs.ensureDir(path.join(rootDir, "artifacts/verification"));
    await fs.writeFile(path.join(rootDir, "artifacts/verification/FAILURE_TAXONOMY.md"), "# Failure Taxonomy\n");
    await fs.writeJson(path.join(rootDir, "artifacts/verification/FAILURE_TAXONOMY.json"), {
      schemaVersion: "1.0",
      generatedAt: new Date().toISOString(),
      totalFailures: 0,
      unmappedCount: 0,
      allMapped: true,
      classSummaries: [],
      records: [],
    });

    for (let i = 0; i < 5; i += 1) {
      const runDir = path.join(rootDir, "runs", `run-${i}`);
      await fs.ensureDir(runDir);
      await fs.writeJson(path.join(runDir, "run_summary.json"), {
        runId: `run-${i}`,
        project: "dexter",
        durationMs: 1000,
        verificationPassed: true,
        deployed: true,
        memoryLessonsRetrieved: 1,
        tasksTotal: 1,
        tasksPassed: 1,
      });
    }
    await fs.ensureDir(path.join(rootDir, "artifacts/execution"));
    await fs.writeJson(path.join(rootDir, "artifacts/execution/ESCALATION_STATE.json"), {
      generatedAt: new Date().toISOString(),
      items: [],
    });

    const report = await generateMilestone3Signoff(rootDir);
    const failed = report.gates.filter((gate) => !gate.passed);
    expect(failed, failed.map((gate) => `${gate.id}: ${gate.detail}`).join("; ")).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.soak.maxConsecutivePasses).toBeGreaterThanOrEqual(30);
    await fs.remove(rootDir);
  });
});
