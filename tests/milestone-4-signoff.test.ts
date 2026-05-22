import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { generateMilestone4Signoff } from "../src/operations/milestone-4-signoff.js";

describe("milestone 4 signoff", () => {
  it("passes when control-plane policies and simulations are satisfied", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-m4-signoff-"));
    await fs.copy(path.join(process.cwd(), "docs"), path.join(rootDir, "docs"));
    await fs.copy(path.join(process.cwd(), "docs/specs"), path.join(rootDir, "docs/specs"));

    const runId = "run-healthy";
    await fs.ensureDir(path.join(rootDir, "runs", runId));
    await fs.writeJson(path.join(rootDir, "runs", runId, "run_summary.json"), {
      runId,
      runStatus: "healthy",
      productionReady: true,
      startedAt: new Date().toISOString(),
    });
    await fs.ensureDir(path.join(rootDir, "artifacts/execution"));
    await fs.writeJson(path.join(rootDir, "artifacts/execution/ESCALATION_STATE.json"), {
      generatedAt: new Date().toISOString(),
      items: [],
    });
    await fs.ensureDir(path.join(rootDir, "artifacts/release"));
    await fs.ensureDir(path.join(rootDir, "artifacts/verification"));
    await fs.writeJson(path.join(rootDir, "artifacts/verification/FAILURE_TAXONOMY.json"), {
      schemaVersion: "1.0",
      generatedAt: new Date().toISOString(),
      totalFailures: 0,
      allMapped: true,
      unmappedCount: 0,
      classSummaries: [],
      failures: [],
    });
    await fs.writeJson(path.join(rootDir, "artifacts/release/PROMOTION_HISTORY.json"), {
      schemaVersion: "1.0",
      updatedAt: new Date().toISOString(),
      promotions: [
        {
          promotionId: "p1",
          targetService: "svc",
          appName: "app",
          generatedAt: new Date().toISOString(),
          passed: true,
          manifestPath: path.join(rootDir, "artifacts/release/promotions/p1.json"),
          stages: ["dev", "staging", "canary", "prod"],
        },
        {
          promotionId: "p2",
          targetService: "svc",
          appName: "app",
          generatedAt: new Date().toISOString(),
          passed: true,
          manifestPath: path.join(rootDir, "artifacts/release/promotions/p2.json"),
          stages: ["dev", "staging", "canary", "prod"],
        },
        {
          promotionId: "p3",
          targetService: "svc",
          appName: "app",
          generatedAt: new Date().toISOString(),
          passed: true,
          manifestPath: path.join(rootDir, "artifacts/release/promotions/p3.json"),
          stages: ["dev", "staging", "canary", "prod"],
        },
      ],
    });

    for (const promotionId of ["p1", "p2", "p3"]) {
      await fs.ensureDir(path.join(rootDir, "artifacts/release/promotions"));
      await fs.writeJson(path.join(rootDir, "artifacts/release/promotions", `${promotionId}.json`), {
        promotionId,
        stages: [
          { environment: "dev", approverRole: "operator", passed: true },
          { environment: "staging", approverRole: "operator", passed: true },
          { environment: "canary", approverRole: "release-manager", passed: true },
          { environment: "prod", approverRole: "release-manager", passed: true },
        ],
        audit: { eventsDelta: 2, pipelineActions: ["a", "b", "c"] },
      });
    }

    const report = await generateMilestone4Signoff(rootDir);
    expect(report.passed).toBe(true);
    expect(report.diagnosis.durationMs).toBeLessThan(600_000);
    expect(report.incidentSimulations.passed).toBe(true);

    await fs.remove(rootDir);
  });
});
