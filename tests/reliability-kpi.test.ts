import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { loadReliabilityKpiPolicy } from "../src/release/reliability-kpi-policy.js";
import {
  buildReliabilityKpiReport,
  computeSoakRepeatFailureRate,
  writeReliabilityKpiReport,
} from "../src/release/reliability-kpi.js";
import { buildSoakTrends } from "../src/release/soak-trends.js";
import { buildFailureTaxonomyReport } from "../src/verification/failure-taxonomy.js";
import { loadFailureTaxonomyPolicy } from "../src/verification/failure-taxonomy-policy.js";
import { loadRegressionPreventionPolicy } from "../src/verification/regression-prevention-policy.js";
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

describe("reliability kpi", () => {
  it("computes soak repeat-failure rate across consecutive failures", () => {
    const history = [
      cycle("2026-05-19T10:00:00.000Z", true),
      cycle("2026-05-20T10:00:00.000Z", false, "unit-tests"),
      cycle("2026-05-21T10:00:00.000Z", false, "unit-tests"),
      cycle("2026-05-21T11:00:00.000Z", false, "trust-gates"),
    ];
    expect(computeSoakRepeatFailureRate(history)).toBe(0.5);
  });

  it("builds top risks and prioritized mitigation backlog", async () => {
    const policy = await loadReliabilityKpiPolicy(process.cwd());
    const remediationPolicy = await loadRegressionPreventionPolicy(process.cwd());
    const taxonomyPolicy = await loadFailureTaxonomyPolicy(process.cwd());
    const status: SoakStatus = {
      schemaVersion: "1.0",
      targetStreak: 3,
      currentStreak: 0,
      longestStreak: 1,
      totalCycles: 4,
      gateSatisfied: false,
      history: [
        cycle("2026-05-19T10:00:00.000Z", true),
        cycle("2026-05-20T10:00:00.000Z", false, "unit-tests"),
        cycle("2026-05-21T10:00:00.000Z", false, "unit-tests"),
        cycle("2026-05-21T11:00:00.000Z", false, "unit-tests"),
      ],
    };
    const trends = buildSoakTrends(status);
    const taxonomy = buildFailureTaxonomyReport(
      [
        {
          source: "run.task",
          sourceId: "r1:t1",
          at: "2026-05-21T10:00:00.000Z",
          signal: "taskId=t1 status=failed failureReason=acceptance_failed",
        },
        {
          source: "soak",
          sourceId: "c1",
          at: "2026-05-21T11:00:00.000Z",
          signal: "unit-tests failed with exit code 1",
        },
        {
          source: "soak",
          sourceId: "c2",
          at: "2026-05-21T12:00:00.000Z",
          signal: "unit-tests failed with exit code 1",
        },
      ],
      taxonomyPolicy,
    );

    const report = buildReliabilityKpiReport({
      policy,
      trends,
      soakReliability: null,
      taxonomy,
      runMetrics: { totalRuns: 5, readinessPassRate: 0.8, repeatedFailureRate: 0.1 },
      soakRepeatFailureRate: computeSoakRepeatFailureRate(status.history),
      remediationPolicy,
      previousReport: null,
    });

    expect(report.topRisks.length).toBeGreaterThan(0);
    expect(report.topRisks.length).toBeLessThanOrEqual(policy.topFailureClassCount);
    expect(report.mitigationBacklog.length).toBe(report.topRisks.length);
    expect(report.mitigationBacklog[0]?.actions.length).toBeGreaterThan(0);
    expect(report.mitigationBacklog[0]?.priority).toBeDefined();
  });

  it("writes KPI artifacts under artifacts/release", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-reliability-kpi-"));
    for (const file of [
      "RELIABILITY_KPI_POLICY.json",
      "REGRESSION_PREVENTION_TEMPLATES.json",
      "FAILURE_TAXONOMY_POLICY.json",
      "SOAK_SCHEDULE_POLICY.json",
    ]) {
      await fs.ensureDir(path.join(rootDir, "docs", "operations"));
      await fs.copy(
        path.join(process.cwd(), "docs", "operations", file),
        path.join(rootDir, "docs", "operations", file),
      );
    }

    const status: SoakStatus = {
      schemaVersion: "1.0",
      targetStreak: 1,
      currentStreak: 1,
      longestStreak: 2,
      totalCycles: 3,
      gateSatisfied: true,
      history: [
        cycle("2026-05-19T10:00:00.000Z", true),
        cycle("2026-05-20T10:00:00.000Z", true),
        cycle("2026-05-21T10:00:00.000Z", true),
      ],
    };
    await fs.ensureDir(path.join(rootDir, "artifacts", "release"));
    await fs.writeJson(path.join(rootDir, "artifacts", "release", "SOAK_STATUS.json"), status);
    await fs.writeJson(path.join(rootDir, "artifacts", "release", "SOAK_TRENDS.json"), buildSoakTrends(status));

    const result = await writeReliabilityKpiReport(rootDir);
    expect(await fs.pathExists(result.jsonPath)).toBe(true);
    expect(await fs.pathExists(result.markdownPath)).toBe(true);
    expect(result.report.mitigationBacklog.length).toBeGreaterThanOrEqual(0);
    await fs.remove(rootDir);
  });
});
