import { describe, expect, it } from "vitest";
import {
  buildFlakyQuarantineReport,
  buildQuarantineEntries,
  resolveTestRunExitCode,
} from "../src/verification/flaky-quarantine.js";
import {
  isRegressionCriticalTest,
  type FlakyQuarantinePolicy,
} from "../src/verification/flaky-quarantine-policy.js";
import type { FlakyDetectionReport } from "../src/verification/test-telemetry.js";

const policy: FlakyQuarantinePolicy = {
  schemaVersion: "1.0",
  regressionCriticalPatterns: ["tests/promotion-gate.test.ts"],
  manualQuarantine: [],
  manualNeverQuarantine: [],
};

function flakyReport(candidates: FlakyDetectionReport["candidates"]): FlakyDetectionReport {
  return {
    schemaVersion: "1.0",
    generatedAt: "2026-05-21T00:00:00.000Z",
    policy: { minObservations: 5, highConfidenceThreshold: 0.7 },
    totalTrackedTests: candidates.length,
    flakyCandidateCount: candidates.filter((item) => item.flaky).length,
    highConfidenceFlakyCount: candidates.filter((item) => item.flaky).length,
    candidates,
  };
}

describe("flaky quarantine", () => {
  it("keeps regression-critical flaky tests blocking", () => {
    const entries = buildQuarantineEntries(
      flakyReport([
        {
          testId: "tests/promotion-gate.test.ts::blocks prod",
          file: "tests/promotion-gate.test.ts",
          name: "blocks prod",
          passCount: 3,
          failCount: 3,
          skipCount: 0,
          totalObservations: 6,
          flipRate: 1,
          confidence: 0.9,
          flaky: true,
          stable: false,
        },
        {
          testId: "tests/widget.test.ts::sometimes",
          file: "tests/widget.test.ts",
          name: "sometimes",
          passCount: 3,
          failCount: 3,
          skipCount: 0,
          totalObservations: 6,
          flipRate: 1,
          confidence: 0.9,
          flaky: true,
          stable: false,
        },
      ]),
      policy,
    );

    const critical = entries.find((item) => item.file.includes("promotion-gate"));
    const regular = entries.find((item) => item.file.includes("widget"));
    expect(critical?.quarantined).toBe(false);
    expect(critical?.blocking).toBe(true);
    expect(regular?.quarantined).toBe(true);
    expect(regular?.blocking).toBe(false);
  });

  it("does not mask failures for quarantined tests but keeps regression-critical failures blocking", () => {
    const entries = buildQuarantineEntries(
      flakyReport([
        {
          testId: "tests/promotion-gate.test.ts::blocks prod",
          file: "tests/promotion-gate.test.ts",
          name: "blocks prod",
          passCount: 2,
          failCount: 3,
          skipCount: 0,
          totalObservations: 5,
          flipRate: 1,
          confidence: 0.8,
          flaky: true,
          stable: false,
        },
        {
          testId: "tests/widget.test.ts::sometimes",
          file: "tests/widget.test.ts",
          name: "sometimes",
          passCount: 2,
          failCount: 3,
          skipCount: 0,
          totalObservations: 5,
          flipRate: 1,
          confidence: 0.8,
          flaky: true,
          stable: false,
        },
      ]),
      policy,
    );

    const summary = resolveTestRunExitCode(
      1,
      [
        {
          testId: "tests/promotion-gate.test.ts::blocks prod",
          file: "tests/promotion-gate.test.ts",
          name: "blocks prod",
          status: "failed",
          durationMs: 1,
        },
        {
          testId: "tests/widget.test.ts::sometimes",
          file: "tests/widget.test.ts",
          name: "sometimes",
          status: "failed",
          durationMs: 1,
        },
      ],
      entries,
    );

    expect(summary.quarantinedFailureCount).toBe(1);
    expect(summary.blockingFailureCount).toBe(1);
    expect(summary.effectiveExitCode).toBe(1);
  });

  it("allows effective pass when only quarantined non-critical tests fail", () => {
    const entries = buildQuarantineEntries(
      flakyReport([
        {
          testId: "tests/widget.test.ts::sometimes",
          file: "tests/widget.test.ts",
          name: "sometimes",
          passCount: 2,
          failCount: 3,
          skipCount: 0,
          totalObservations: 5,
          flipRate: 1,
          confidence: 0.8,
          flaky: true,
          stable: false,
        },
      ]),
      policy,
    );

    const summary = resolveTestRunExitCode(
      1,
      [
        {
          testId: "tests/widget.test.ts::sometimes",
          file: "tests/widget.test.ts",
          name: "sometimes",
          status: "failed",
          durationMs: 1,
        },
      ],
      entries,
    );

    expect(summary.effectiveExitCode).toBe(0);
    expect(summary.quarantinedFailureCount).toBe(1);
  });

  it("marks regression-critical tests via policy patterns", () => {
    expect(
      isRegressionCriticalTest(
        { testId: "tests/promotion-gate.test.ts::x", file: "tests/promotion-gate.test.ts" },
        policy,
      ),
    ).toBe(true);
    expect(isRegressionCriticalTest({ testId: "tests/widget.test.ts::x", file: "tests/widget.test.ts" }, policy)).toBe(
      false,
    );
  });

  it("builds quarantine report visible in artifacts", () => {
    const report = buildFlakyQuarantineReport(
      flakyReport([
        {
          testId: "tests/widget.test.ts::sometimes",
          file: "tests/widget.test.ts",
          name: "sometimes",
          passCount: 2,
          failCount: 3,
          skipCount: 0,
          totalObservations: 5,
          flipRate: 1,
          confidence: 0.8,
          flaky: true,
          stable: false,
        },
      ]),
      policy,
      {
        vitestExitCode: 1,
        effectiveExitCode: 0,
        failedTotal: 1,
        quarantinedFailureCount: 1,
        blockingFailureCount: 0,
        quarantinedFailures: ["tests/widget.test.ts::sometimes"],
        blockingFailures: [],
      },
    );

    expect(report.quarantinedCount).toBe(1);
    expect(report.entries[0]?.quarantined).toBe(true);
    expect(report.lastRun?.effectiveExitCode).toBe(0);
  });
});
