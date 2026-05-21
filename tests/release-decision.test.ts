import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { generateGoNoGoDecision } from "../src/release/generate-go-no-go.js";

describe("release decision", () => {
  async function writePassingRun(rootDir: string, runId: string) {
    await fs.ensureDir(path.join(rootDir, "runs", runId));
    await fs.writeJson(
      path.join(rootDir, "runs", runId, "run_summary.json"),
      {
        runId,
        project: "sample-app",
        durationMs: 1000,
        verificationPassed: true,
        deployed: true,
        memoryLessonsRetrieved: 2,
        tasksTotal: 3,
        tasksPassed: 3,
      },
      { spaces: 2 },
    );
  }

  it("returns NO-GO when unresolved required escalations exist", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-release-decision-"));
    await writePassingRun(rootDir, "run-1");
    await fs.ensureDir(path.join(rootDir, "artifacts", "execution"));
    await fs.writeJson(
      path.join(rootDir, "artifacts", "execution", "ESCALATION_STATE.json"),
      {
        generatedAt: new Date().toISOString(),
        items: [
          {
            key: "t1:planner:retry_budget_exhausted",
            status: "open",
            target: "planner",
            priority: "medium",
            reason: "retry_budget_exhausted",
          },
        ],
      },
      { spaces: 2 },
    );
    const result = await generateGoNoGoDecision(rootDir);
    expect(result.decision).toBe("NO-GO");
    expect(result.unresolvedEscalations).toBe(1);
    await fs.remove(rootDir);
  });

  it("returns NO-GO when latest replan outcome is stalled without waiver", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-release-decision-"));
    await writePassingRun(rootDir, "run-1");
    await fs.writeJson(path.join(rootDir, "runs", "run-1", "replan_waves_summary.json"), { stoppedReason: "stalled" }, { spaces: 2 });
    await fs.ensureDir(path.join(rootDir, "artifacts", "execution"));
    await fs.writeJson(path.join(rootDir, "artifacts", "execution", "ESCALATION_STATE.json"), { items: [] }, { spaces: 2 });

    const result = await generateGoNoGoDecision(rootDir);
    expect(result.decision).toBe("NO-GO");
    expect(result.replanOutcome).toBe("stalled");
    expect(result.replanGateWaived).toBe(false);
    await fs.remove(rootDir);
  });

  it("returns GO when stalled replan outcome has an active waiver", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-release-decision-"));
    await writePassingRun(rootDir, "run-1");
    await fs.writeJson(path.join(rootDir, "runs", "run-1", "replan_waves_summary.json"), { stoppedReason: "stalled" }, { spaces: 2 });
    await fs.ensureDir(path.join(rootDir, "artifacts", "execution"));
    await fs.writeJson(path.join(rootDir, "artifacts", "execution", "ESCALATION_STATE.json"), { items: [] }, { spaces: 2 });
    await fs.writeJson(
      path.join(rootDir, "artifacts", "execution", "REPLAN_OUTCOME_WAIVER.json"),
      {
        approvedBy: "dexter-ops",
        reason: "Known planner instability accepted for this release window",
        outcomes: ["stalled"],
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
      { spaces: 2 },
    );

    const result = await generateGoNoGoDecision(rootDir);
    expect(result.decision).toBe("GO");
    expect(result.replanOutcome).toBe("stalled");
    expect(result.replanGateWaived).toBe(true);
    await fs.remove(rootDir);
  });
});
