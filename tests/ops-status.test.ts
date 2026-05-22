import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { writeOpsStatusArtifact } from "../src/core/ops-status.js";

describe("ops status artifact", () => {
  it("writes blocked run dashboard with escalation and resume commands", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-ops-status-blocked-"));
    const runId = "run-1";
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
        durationMs: 1_800_000,
        startedAt: new Date(Date.now() - 72 * 3_600_000).toISOString(),
      },
      { spaces: 2 },
    );
    await fs.writeJson(
      path.join(runDir, "replan_waves_summary.json"),
      {
        maxWaves: 3,
        stoppedReason: "max_waves",
        waves: [{ wave: 1, attempted: true, stalled: false, runStatusAfterWave: "degraded", unresolvedAfterWave: 1 }],
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
            firstSeenAt: new Date(Date.now() - 48 * 3_600_000).toISOString(),
            lastSeenAt: new Date().toISOString(),
          },
        ],
      },
      { spaces: 2 },
    );

    await writeOpsStatusArtifact({ rootDir, runDir, runId });
    const dashboard = await fs.readJson(path.join(executionDir, "OPS_STATUS.json"));
    expect(dashboard.schemaVersion).toBe("1.1");
    expect(dashboard.runStatus).toBe("blocked");
    expect(dashboard.cost.present).toBe(true);
    expect(dashboard.cost.source).toBe("run_summary.duration");
    expect(dashboard.cost.estimatedCostUsd).toBeGreaterThan(0);
    expect(dashboard.queue.depth).toBeGreaterThanOrEqual(1);
    expect(dashboard.queue.backlogAging.stale).toBeGreaterThanOrEqual(1);
    expect(dashboard.escalationAging.oldestUnresolved?.bucket).toBe("stale");
    expect(dashboard.unresolved.count).toBe(1);
    expect(dashboard.replan?.stoppedReason).toBe("max_waves");
    expect(dashboard.nextCommands.some((cmd: string) => cmd.includes("latest-blocked"))).toBe(true);
    expect(dashboard.nextCommands.some((cmd: string) => cmd.includes("escalation:resolve"))).toBe(true);

    await fs.remove(rootDir);
  });

  it("writes healthy run dashboard with release commands", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-ops-status-healthy-"));
    const runId = "run-2";
    const runDir = path.join(rootDir, "runs", runId);
    const executionDir = path.join(rootDir, "artifacts", "execution");
    await fs.ensureDir(runDir);
    await fs.ensureDir(executionDir);

    await fs.writeJson(
      path.join(runDir, "run_summary.json"),
      {
        runId,
        runStatus: "healthy",
        productionReady: true,
      },
      { spaces: 2 },
    );
    await fs.writeJson(path.join(executionDir, "ESCALATION_STATE.json"), { generatedAt: new Date().toISOString(), items: [] }, { spaces: 2 });

    await writeOpsStatusArtifact({ rootDir, runDir, runId });
    const dashboard = await fs.readJson(path.join(executionDir, "OPS_STATUS.json"));
    expect(dashboard.resume.allowed).toBe(true);
    expect(dashboard.nextCommands).toContain("npm run release:decision");
    expect(dashboard.nextCommands).toContain("npm run verify");

    await fs.remove(rootDir);
  });
});
