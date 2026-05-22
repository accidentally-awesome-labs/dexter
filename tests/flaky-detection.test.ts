import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import type { FlakyTestPolicy } from "../src/verification/flaky-test-policy.js";
import {
  appendTestRun,
  detectFlakyCandidates,
  ingestVitestReport,
  refreshFlakyCandidates,
  type TestRunRecord,
  type TestTelemetryStore,
} from "../src/verification/test-telemetry.js";

const testPolicy: FlakyTestPolicy = {
  schemaVersion: "1.0",
  minObservations: 5,
  minPasses: 1,
  minFails: 1,
  minFlipRate: 0.2,
  highConfidenceThreshold: 0.7,
  maxRunsRetained: 50,
  stablePassRateThreshold: 0.98,
};

function outcome(testId: string, status: "passed" | "failed"): TestRunRecord["results"][number] {
  const file = testId.includes("::") ? testId.split("::")[0] : `tests/${testId}.test.ts`;
  const name = testId.includes("::") ? testId.split("::").slice(1).join("::") : testId;
  return {
    testId,
    file,
    name,
    status,
    durationMs: 10,
  };
}

function buildStore(pattern: Array<"passed" | "failed">, testId: string): TestTelemetryStore {
  return {
    schemaVersion: "1.0",
    updatedAt: new Date().toISOString(),
    runs: pattern.map((status, index) => ({
      runId: `run-${index}`,
      at: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      source: "unit" as const,
      exitCode: status === "failed" ? 1 : 0,
      results: [outcome(testId, status)],
    })),
  };
}

describe("flaky test detection", () => {
  it("flags intermittent pass/fail tests at high confidence", () => {
    const store = buildStore(
      ["passed", "failed", "passed", "failed", "passed", "failed", "passed", "failed"],
      "flaky-test",
    );
    const report = detectFlakyCandidates(store, testPolicy);
    const candidate = report.candidates.find((item) => item.testId.includes("flaky-test"));
    expect(candidate?.flaky).toBe(true);
    expect(candidate?.confidence ?? 0).toBeGreaterThanOrEqual(testPolicy.highConfidenceThreshold);
  });

  it("does not mark consistently passing tests as high-confidence flaky", () => {
    const store = buildStore(Array.from({ length: 8 }, () => "passed" as const), "stable-test");
    const report = detectFlakyCandidates(store, testPolicy);
    const candidate = report.candidates.find((item) => item.testId.includes("stable-test"));
    expect(candidate?.flaky).toBe(false);
    expect(candidate?.stable).toBe(true);
    expect(candidate?.confidence ?? 1).toBeLessThan(testPolicy.highConfidenceThreshold);
  });

  it("ingests vitest json output into telemetry and writes flaky artifacts", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-flaky-"));
    await fs.ensureDir(path.join(rootDir, "docs", "operations"));
    for (const name of ["FLAKY_TEST_POLICY.json", "FLAKY_QUARANTINE_POLICY.json"]) {
      await fs.copy(
        path.join(process.cwd(), "docs", "operations", name),
        path.join(rootDir, "docs", "operations", name),
      );
    }

    const reportPath = path.join(rootDir, "artifacts", "verification", "vitest-last.json");
    await fs.ensureDir(path.dirname(reportPath));
    await fs.writeJson(reportPath, {
      success: true,
      testResults: [
        {
          name: "/tmp/sample.test.ts",
          assertionResults: [
            { fullName: "suite > passes", status: "passed", duration: 1 },
            { fullName: "suite > fails sometimes", status: "failed", duration: 2 },
          ],
        },
      ],
    });

    await ingestVitestReport(rootDir, { reportPath, exitCode: 0 });
    const intermittentId = "/tmp/sample.test.ts::suite > fails sometimes";
    const stableId = "/tmp/sample.test.ts::suite > passes";
    for (let i = 0; i < 4; i += 1) {
      await appendTestRun(
        rootDir,
        {
          runId: `synthetic-${i}`,
          at: new Date(Date.UTC(2026, 1, i + 1)).toISOString(),
          source: "unit",
          exitCode: i % 2,
          results: [
            outcome(intermittentId, i % 2 === 0 ? "passed" : "failed"),
            outcome(stableId, "passed"),
          ],
        },
        testPolicy,
      );
    }

    const flaky = await refreshFlakyCandidates(rootDir);
    const flakyPath = path.join(rootDir, "artifacts", "verification", "FLAKY_CANDIDATES.json");
    expect(await fs.pathExists(flakyPath)).toBe(true);
    const intermittent = flaky.candidates.find((item) => item.name.includes("fails sometimes"));
    const stable = flaky.candidates.find((item) => item.name.includes("passes"));
    expect(intermittent?.flaky).toBe(true);
    expect(stable?.flaky).toBe(false);
  });
});
