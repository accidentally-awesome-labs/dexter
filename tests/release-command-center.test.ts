import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { runReleaseCommandCenter } from "../src/operations/release-command-center.js";

describe("release command center", () => {
  it("writes center report with governance and audit trail", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-release-center-"));
    await fs.copy(path.join(process.cwd(), "docs"), path.join(rootDir, "docs"));

    const runId = "run-healthy";
    const runDir = path.join(rootDir, "runs", runId);
    await fs.ensureDir(runDir);
    await fs.writeJson(
      path.join(runDir, "run_summary.json"),
      {
        runId,
        runStatus: "healthy",
        productionReady: true,
        startedAt: new Date().toISOString(),
      },
      { spaces: 2 },
    );
    await fs.ensureDir(path.join(rootDir, "artifacts", "execution"));
    await fs.writeJson(
      path.join(rootDir, "artifacts", "execution", "ESCALATION_STATE.json"),
      { generatedAt: new Date().toISOString(), items: [] },
      { spaces: 2 },
    );
    await fs.ensureDir(path.join(rootDir, "artifacts", "release"));
    await fs.ensureDir(path.join(rootDir, "artifacts", "verification"));
    await fs.writeJson(
      path.join(rootDir, "artifacts", "verification", "FAILURE_TAXONOMY.json"),
      {
        schemaVersion: "1.0",
        generatedAt: new Date().toISOString(),
        totalFailures: 0,
        allMapped: true,
        unmappedCount: 0,
        classSummaries: [],
        failures: [],
      },
      { spaces: 2 },
    );
    await fs.writeJson(
      path.join(rootDir, "artifacts", "release", "PROMOTION_HISTORY.json"),
      {
        schemaVersion: "1.0",
        updatedAt: new Date().toISOString(),
        promotions: [],
      },
      { spaces: 2 },
    );

    const report = await runReleaseCommandCenter(rootDir, { minimumPromotions: 1 });
    expect(report.steps.some((step) => step.id === "release_decision")).toBe(true);
    expect(report.steps.some((step) => step.id === "governance_verify")).toBe(true);
    expect(report.artifacts.reportJson).toContain("RELEASE_COMMAND_CENTER.json");
    expect(await fs.pathExists(report.artifacts.auditLog ?? "")).toBe(true);

    await fs.remove(rootDir);
  });
});
