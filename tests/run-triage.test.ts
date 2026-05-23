import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { buildRunTriage } from "../src/core/run-triage.js";

describe("run triage", () => {
  it("produces actionable blocked triage with findings and commands", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-triage-blocked-"));
    await fs.copy(path.join(process.cwd(), "docs"), path.join(rootDir, "docs"));

    const runId = "run-blocked";
    const runDir = path.join(rootDir, "runs", runId);
    const executionDir = path.join(rootDir, "artifacts", "execution");
    await fs.ensureDir(runDir);
    await fs.ensureDir(executionDir);

    await fs.writeJson(
      path.join(runDir, "run_summary.json"),
      {
        runId,
        runStatus: "blocked",
        productionReady: false,
        startedAt: new Date(Date.now() - 72 * 3_600_000).toISOString(),
      },
      { spaces: 2 },
    );
    await fs.writeJson(
      path.join(runDir, "replan_waves_summary.json"),
      {
        maxWaves: 2,
        stoppedReason: "max_waves",
        waves: [{ wave: 1, unresolvedAfterWave: 1 }],
      },
      { spaces: 2 },
    );
    await fs.writeJson(
      path.join(executionDir, "ESCALATION_STATE.json"),
      {
        generatedAt: new Date().toISOString(),
        items: [
          {
            key: "t1:operator:backend_unavailable",
            status: "open",
            target: "operator",
            priority: "high",
            reason: "backend_unavailable",
            lastRunId: runId,
          },
        ],
      },
      { spaces: 2 },
    );

    const report = await buildRunTriage(rootDir, runId, "blocked");
    expect(report.mode).toBe("blocked");
    expect(report.findings.some((finding) => finding.category === "run_status")).toBe(true);
    expect(report.unresolvedEscalations.length).toBeGreaterThanOrEqual(1);
    expect(report.suggestedCommands.some((cmd) => cmd.includes("escalation:list"))).toBe(true);
    expect(report.nextSteps.length).toBeGreaterThan(0);
    expect(report.alerts.matchedRules).toContain("run_blocked");

    await fs.remove(rootDir);
  });
});
