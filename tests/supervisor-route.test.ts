import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { routeEscalations } from "../src/supervisor/route-escalations.js";

describe("supervisor escalation routing", () => {
  it("routes escalation artifacts into supervisor actions", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-supervisor-route-"));
    const sourceDir = path.join(rootDir, "artifacts", "execution");
    await fs.ensureDir(sourceDir);
    const sourcePath = path.join(sourceDir, "ESCALATIONS.json");
    await fs.writeJson(
      sourcePath,
      {
        generatedAt: new Date().toISOString(),
        totalTasks: 2,
        requiredEscalations: 2,
        requiredByTarget: { operator: 1, planner: 1 },
        items: [
          {
            taskId: "t1",
            status: "failed",
            failureReason: "backend_unavailable",
            attempts: 1,
            target: "operator",
            reason: "backend_unavailable",
            action: "Configure backend",
          },
          {
            taskId: "t2",
            status: "failed",
            failureReason: "acceptance_failed",
            attempts: 2,
            target: "planner",
            reason: "retry_budget_exhausted",
            action: "Replan task",
          },
        ],
      },
      { spaces: 2 },
    );
    const result = await routeEscalations(rootDir);
    expect(result.actionCount).toBe(2);
    expect(result.requiredEscalations).toBe(2);
    expect(result.operatorHighCount).toBe(1);
    expect(result.runStatus).toBe("blocked");
    expect(await fs.pathExists(result.outputJsonPath)).toBe(true);
    expect(await fs.pathExists(result.outputMarkdownPath)).toBe(true);
    const plan = await fs.readJson(result.outputJsonPath);
    expect(plan.totals.operator).toBe(1);
    expect(plan.totals.planner).toBe(1);
    expect(plan.actions[0].priority).toBe("high");
    await fs.remove(rootDir);
  });
});
