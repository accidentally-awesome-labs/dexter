import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { resolveEscalationsWorkflow } from "../src/supervisor/escalation-workflow.js";
import { syncEscalationLifecycle } from "../src/supervisor/escalation-lifecycle.js";

describe("escalation resolve workflow", () => {
  it("resolves selected keys and reports resume eligibility", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-escalation-workflow-"));
    const executionDir = path.join(rootDir, "artifacts", "execution");
    await fs.ensureDir(executionDir);
    const runDir = path.join(rootDir, "runs", "run-1");
    await fs.ensureDir(runDir);

    await fs.writeJson(
      path.join(executionDir, "SUPERVISOR_ACTIONS.json"),
      {
        actions: [
          {
            taskId: "t1",
            target: "planner",
            priority: "medium",
            reason: "retry_budget_exhausted",
            action: "replan",
          },
        ],
      },
      { spaces: 2 },
    );
    await fs.writeJson(
      path.join(executionDir, "ESCALATIONS.json"),
      {
        generatedAt: new Date().toISOString(),
        totalTasks: 1,
        requiredEscalations: 1,
        requiredByTarget: { operator: 0, planner: 1 },
        items: [
          {
            taskId: "t1",
            status: "failed",
            failureReason: "acceptance_failed",
            attempts: 2,
            target: "planner",
            reason: "retry_budget_exhausted",
            action: "replan",
          },
        ],
      },
      { spaces: 2 },
    );
    await syncEscalationLifecycle(rootDir, runDir, "run-1");

    const key = "t1:planner:retry_budget_exhausted";
    const result = await resolveEscalationsWorkflow({
      rootDir,
      keys: [key],
      status: "resolved",
      note: "handled",
      runId: "run-1",
    });
    expect(result.updatedKeys).toEqual([key]);
    expect(result.selectedKeys).toEqual([key]);
    expect(result.unresolvedRequired).toBe(0);
    expect(result.resumeAllowed).toBe(true);

    await fs.remove(rootDir);
  });

  it("supports all-unresolved dry-run with target filtering", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-escalation-workflow-dry-"));
    const executionDir = path.join(rootDir, "artifacts", "execution");
    await fs.ensureDir(executionDir);
    const runDir = path.join(rootDir, "runs", "run-2");
    await fs.ensureDir(runDir);

    await fs.writeJson(
      path.join(executionDir, "SUPERVISOR_ACTIONS.json"),
      {
        actions: [
          {
            taskId: "t1",
            target: "planner",
            priority: "medium",
            reason: "retry_budget_exhausted",
            action: "replan",
          },
          {
            taskId: "t2",
            target: "operator",
            priority: "high",
            reason: "backend_unavailable",
            action: "configure backend",
          },
        ],
      },
      { spaces: 2 },
    );
    await fs.writeJson(
      path.join(executionDir, "ESCALATIONS.json"),
      {
        generatedAt: new Date().toISOString(),
        totalTasks: 2,
        requiredEscalations: 2,
        requiredByTarget: { operator: 1, planner: 1 },
        items: [
          {
            taskId: "t1",
            status: "failed",
            failureReason: "acceptance_failed",
            attempts: 2,
            target: "planner",
            reason: "retry_budget_exhausted",
            action: "replan",
          },
          {
            taskId: "t2",
            status: "failed",
            failureReason: "backend_unavailable",
            attempts: 1,
            target: "operator",
            reason: "backend_unavailable",
            action: "configure backend",
          },
        ],
      },
      { spaces: 2 },
    );
    await syncEscalationLifecycle(rootDir, runDir, "run-2");

    const result = await resolveEscalationsWorkflow({
      rootDir,
      status: "resolved",
      allUnresolved: true,
      target: "planner",
      dryRun: true,
    });
    expect(result.dryRun).toBe(true);
    expect(result.selectedKeys).toEqual(["t1:planner:retry_budget_exhausted"]);
    expect(result.updatedKeys).toEqual([]);
    const state = await fs.readJson(path.join(executionDir, "ESCALATION_STATE.json"));
    expect(state.items.find((item: { key: string }) => item.key === "t1:planner:retry_budget_exhausted")?.status).toBe(
      "open",
    );
    await fs.remove(rootDir);
  });

  it("requires waiver metadata when resolving as waived", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-escalation-workflow-waiver-"));
    const executionDir = path.join(rootDir, "artifacts", "execution");
    await fs.ensureDir(executionDir);
    const runDir = path.join(rootDir, "runs", "run-3");
    await fs.ensureDir(runDir);
    await fs.writeJson(
      path.join(executionDir, "SUPERVISOR_ACTIONS.json"),
      {
        actions: [
          {
            taskId: "t1",
            target: "planner",
            priority: "medium",
            reason: "retry_budget_exhausted",
            action: "replan",
          },
        ],
      },
      { spaces: 2 },
    );
    await fs.writeJson(
      path.join(executionDir, "ESCALATIONS.json"),
      {
        generatedAt: new Date().toISOString(),
        totalTasks: 1,
        requiredEscalations: 1,
        requiredByTarget: { operator: 0, planner: 1 },
        items: [
          {
            taskId: "t1",
            status: "failed",
            failureReason: "acceptance_failed",
            attempts: 2,
            target: "planner",
            reason: "retry_budget_exhausted",
            action: "replan",
          },
        ],
      },
      { spaces: 2 },
    );
    await syncEscalationLifecycle(rootDir, runDir, "run-3");

    await expect(
      resolveEscalationsWorkflow({
        rootDir,
        keys: ["t1:planner:retry_budget_exhausted"],
        status: "waived",
      }),
    ).rejects.toThrow("Waiver metadata is required");

    const result = await resolveEscalationsWorkflow({
      rootDir,
      keys: ["t1:planner:retry_budget_exhausted"],
      status: "waived",
      waiver: {
        approvedBy: "dexter-ops",
        reason: "Temporarily accepted",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        scope: "run",
      },
    });
    expect(result.updatedKeys).toEqual(["t1:planner:retry_budget_exhausted"]);
    expect(result.resumeAllowed).toBe(true);

    await fs.remove(rootDir);
  });
});
