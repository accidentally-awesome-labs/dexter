import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import {
  buildFailureTaxonomyReport,
  classifyFailureSignal,
  collectFailureSignals,
  writeFailureTaxonomyReport,
} from "../src/verification/failure-taxonomy.js";
import { loadFailureTaxonomyPolicy } from "../src/verification/failure-taxonomy-policy.js";

describe("failure taxonomy", () => {
  it("maps known signals to canonical classes", async () => {
    const rootDir = process.cwd();
    const policy = await loadFailureTaxonomyPolicy(rootDir);

    expect(
      classifyFailureSignal(
        { source: "soak", sourceId: "c1", at: "2026-05-21T00:00:00.000Z", signal: "unit-tests failed with exit code 1" },
        policy,
      ).taxonomyClass,
    ).toBe("release.soak");

    expect(
      classifyFailureSignal(
        {
          source: "run.task",
          sourceId: "run-1:t1",
          at: "2026-05-21T00:00:00.000Z",
          signal: "taskId=t1 status=failed failureReason=acceptance_failed",
        },
        policy,
      ).taxonomyClass,
    ).toBe("execution.acceptance_failed");

    expect(
      classifyFailureSignal(
        {
          source: "run",
          sourceId: "run-1",
          at: "2026-05-21T00:00:00.000Z",
          signal: "runStatus=blocked productionReady=false unresolved escalation count=2",
        },
        policy,
      ).taxonomyClass,
    ).toBe("execution.hitl_blocked");
  });

  it("uses source fallbacks when no explicit rule matches", async () => {
    const policy = await loadFailureTaxonomyPolicy(process.cwd());
    const classified = classifyFailureSignal(
      {
        source: "promotion",
        sourceId: "p1",
        at: "2026-05-21T00:00:00.000Z",
        signal: "custom promotion anomaly",
      },
      policy,
    );
    expect(classified.taxonomyClass).toBe("release.promotion");
    expect(classified.mappedBy).toBe("fallback:promotion");
  });

  it("summarizes top classes by frequency", () => {
    const policy = {
      schemaVersion: "1.0" as const,
      classes: [
        { id: "release.soak", title: "Soak", severity: "high" as const },
        { id: "execution.command_failed", title: "Command", severity: "high" as const },
        { id: "unknown", title: "Unknown", severity: "low" as const },
      ],
      mappingRules: [
        { id: "soak", class: "release.soak", source: "soak", signalIncludes: ["exit code"] },
        {
          id: "cmd",
          class: "execution.command_failed",
          source: "run.task",
          signalIncludes: ["command_failed"],
        },
      ],
      sourceFallbacks: { soak: "release.soak", "run.task": "execution.command_failed" },
    };
    const report = buildFailureTaxonomyReport(
      [
        { source: "soak", sourceId: "1", at: "2026-05-21T00:00:00.000Z", signal: "failed with exit code 2" },
        { source: "soak", sourceId: "2", at: "2026-05-21T01:00:00.000Z", signal: "failed with exit code 2" },
        {
          source: "run.task",
          sourceId: "3",
          at: "2026-05-21T02:00:00.000Z",
          signal: "failureReason=command_failed",
        },
      ],
      policy,
    );

    expect(report.allMapped).toBe(true);
    expect(report.classSummaries[0]?.taxonomyClass).toBe("release.soak");
    expect(report.classSummaries[0]?.count).toBe(2);
  });

  it("collects failures from repository telemetry and writes report artifacts", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-failure-taxonomy-"));
    await fs.ensureDir(path.join(rootDir, "docs", "operations"));
    await fs.copy(
      path.join(process.cwd(), "docs", "operations", "FAILURE_TAXONOMY_POLICY.json"),
      path.join(rootDir, "docs", "operations", "FAILURE_TAXONOMY_POLICY.json"),
    );
    await fs.ensureDir(path.join(rootDir, "artifacts", "release"));
    await fs.writeJson(path.join(rootDir, "artifacts", "release", "SOAK_STATUS.json"), {
      schemaVersion: "1.0",
      targetStreak: 1,
      currentStreak: 0,
      longestStreak: 0,
      totalCycles: 2,
      gateSatisfied: false,
      history: [
        {
          at: "2026-05-20T10:00:00.000Z",
          passed: false,
          durationMs: 100,
          failureReason: "unit-tests failed with exit code 1",
          steps: [{ name: "unit-tests", command: "npm test", exitCode: 1, durationMs: 50 }],
        },
      ],
    });

    const signals = await collectFailureSignals(rootDir);
    expect(signals.length).toBeGreaterThan(0);

    const { markdownPath, jsonPath, report } = await writeFailureTaxonomyReport(rootDir);
    expect(await fs.pathExists(markdownPath)).toBe(true);
    expect(await fs.pathExists(jsonPath)).toBe(true);
    expect(report.allMapped).toBe(true);
    expect(report.classSummaries.some((item) => item.taxonomyClass === "release.soak")).toBe(true);
    const markdown = await fs.readFile(markdownPath, "utf8");
    expect(markdown).toContain("Top Failure Classes");
    expect(markdown).toContain("release.soak");
  });
});
