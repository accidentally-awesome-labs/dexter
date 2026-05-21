import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { buildResumeCheck, findLatestBlockedRunId, findLatestDegradedRunId, findLatestRunId } from "../src/core/run-selector.js";

describe("run selector", () => {
  it("finds latest blocked run id", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-run-selector-"));
    const runsDir = path.join(rootDir, "runs");
    await fs.ensureDir(runsDir);
    await fs.ensureDir(path.join(runsDir, "run-a"));
    await fs.ensureDir(path.join(runsDir, "run-b"));
    await fs.writeJson(
      path.join(runsDir, "run-a", "run_summary.json"),
      {
        runId: "run-a",
        runStatus: "blocked",
        startedAt: "2026-01-01T00:00:00.000Z",
      },
      { spaces: 2 },
    );
    await fs.writeJson(
      path.join(runsDir, "run-b", "run_summary.json"),
      {
        runId: "run-b",
        runStatus: "blocked",
        startedAt: "2026-01-02T00:00:00.000Z",
      },
      { spaces: 2 },
    );
    const selected = await findLatestBlockedRunId(rootDir);
    expect(selected).toBe("run-b");
    await fs.remove(rootDir);
  });

  it("finds latest degraded run id", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-run-selector-degraded-"));
    const runsDir = path.join(rootDir, "runs");
    await fs.ensureDir(runsDir);
    await fs.ensureDir(path.join(runsDir, "run-a"));
    await fs.ensureDir(path.join(runsDir, "run-b"));
    await fs.writeJson(
      path.join(runsDir, "run-a", "run_summary.json"),
      {
        runId: "run-a",
        runStatus: "degraded",
        startedAt: "2026-01-01T00:00:00.000Z",
      },
      { spaces: 2 },
    );
    await fs.writeJson(
      path.join(runsDir, "run-b", "run_summary.json"),
      {
        runId: "run-b",
        runStatus: "degraded",
        startedAt: "2026-01-02T00:00:00.000Z",
      },
      { spaces: 2 },
    );
    const selected = await findLatestDegradedRunId(rootDir);
    expect(selected).toBe("run-b");
    await fs.remove(rootDir);
  });

  it("finds latest run id regardless of status", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-run-selector-latest-"));
    const runsDir = path.join(rootDir, "runs");
    await fs.ensureDir(runsDir);
    await fs.ensureDir(path.join(runsDir, "run-a"));
    await fs.ensureDir(path.join(runsDir, "run-b"));
    await fs.writeJson(
      path.join(runsDir, "run-a", "run_summary.json"),
      {
        runId: "run-a",
        runStatus: "blocked",
        startedAt: "2026-01-01T00:00:00.000Z",
      },
      { spaces: 2 },
    );
    await fs.writeJson(
      path.join(runsDir, "run-b", "run_summary.json"),
      {
        runId: "run-b",
        runStatus: "healthy",
        startedAt: "2026-01-02T00:00:00.000Z",
      },
      { spaces: 2 },
    );
    const selected = await findLatestRunId(rootDir);
    expect(selected).toBe("run-b");
    await fs.remove(rootDir);
  });

  it("builds resume check with blocker keys and suggested commands", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-resume-check-"));
    const runsDir = path.join(rootDir, "runs");
    await fs.ensureDir(path.join(runsDir, "run-x"));
    await fs.writeJson(
      path.join(runsDir, "run-x", "run_summary.json"),
      {
        runId: "run-x",
        runStatus: "blocked",
        startedAt: "2026-01-03T00:00:00.000Z",
      },
      { spaces: 2 },
    );
    const executionDir = path.join(rootDir, "artifacts", "execution");
    await fs.ensureDir(executionDir);
    await fs.writeJson(
      path.join(executionDir, "ESCALATION_STATE.json"),
      {
        generatedAt: new Date().toISOString(),
        items: [
          {
            key: "t1:operator:backend_unavailable",
            taskId: "t1",
            target: "operator",
            priority: "high",
            reason: "backend_unavailable",
            action: "configure backend",
            status: "open",
            firstSeenAt: new Date().toISOString(),
            lastSeenAt: new Date().toISOString(),
            lastRunId: "run-x",
          },
        ],
      },
      { spaces: 2 },
    );

    const check = await buildResumeCheck(rootDir, "run-x");
    expect(check.resumeAllowed).toBe(false);
    expect(check.unresolvedEscalations.map((item) => item.key)).toEqual(["t1:operator:backend_unavailable"]);
    expect(check.suggestedCommands.some((cmd) => cmd.includes("escalation:resolve"))).toBe(true);
    await fs.remove(rootDir);
  });
});
