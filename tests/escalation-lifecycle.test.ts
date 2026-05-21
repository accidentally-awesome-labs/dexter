import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { listEscalationLifecycle, syncEscalationLifecycle, updateEscalationLifecycleStatus } from "../src/supervisor/escalation-lifecycle.js";

describe("escalation lifecycle", () => {
  it("tracks unresolved and resolves absent escalations across runs", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-escalation-lifecycle-"));
    const executionDir = path.join(rootDir, "artifacts", "execution");
    await fs.ensureDir(executionDir);

    const runDir1 = path.join(rootDir, "runs", "run-1");
    await fs.ensureDir(runDir1);
    await fs.writeJson(
      path.join(executionDir, "SUPERVISOR_ACTIONS.json"),
      {
        actions: [
          {
            taskId: "t1",
            target: "operator",
            priority: "high",
            reason: "backend_unavailable",
            action: "configure backend",
          },
          {
            taskId: "t2",
            target: "planner",
            priority: "medium",
            reason: "retry_budget_exhausted",
            action: "replan",
          },
        ],
      },
      { spaces: 2 },
    );
    const first = await syncEscalationLifecycle(rootDir, runDir1, "run-1");
    expect(first.runStatus).toBe("blocked");
    expect(first.unresolvedRequired).toBe(2);
    expect(first.unresolvedOperatorHigh).toBe(1);

    const runDir2 = path.join(rootDir, "runs", "run-2");
    await fs.ensureDir(runDir2);
    await fs.writeJson(path.join(executionDir, "SUPERVISOR_ACTIONS.json"), { actions: [] }, { spaces: 2 });
    const second = await syncEscalationLifecycle(rootDir, runDir2, "run-2");
    expect(second.runStatus).toBe("healthy");
    expect(second.unresolvedRequired).toBe(0);
    expect(second.unresolvedOperatorHigh).toBe(0);

    const state = await fs.readJson(path.join(executionDir, "ESCALATION_STATE.json"));
    expect(state.items.some((item: { status: string }) => item.status === "resolved")).toBe(true);
    await fs.remove(rootDir);
  });

  it("updates escalation status explicitly", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-escalation-update-"));
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
    await syncEscalationLifecycle(rootDir, runDir, "run-1");
    const key = "t1:planner:retry_budget_exhausted";
    const updated = await updateEscalationLifecycleStatus({
      rootDir,
      key,
      status: "in_progress",
      note: "triaging",
    });
    expect(updated.updated).toBe(true);
    expect(updated.newStatus).toBe("in_progress");
    const state = await fs.readJson(path.join(executionDir, "ESCALATION_STATE.json"));
    expect(state.items.find((item: { key: string }) => item.key === key)?.status).toBe("in_progress");
    const unresolvedOnly = await listEscalationLifecycle({
      rootDir,
      unresolvedOnly: true,
    });
    expect(unresolvedOnly.items.length).toBe(1);
    expect(unresolvedOnly.items[0]?.key).toBe(key);
    const all = await listEscalationLifecycle({
      rootDir,
      unresolvedOnly: false,
    });
    expect(all.total).toBe(1);
    expect(all.unresolved).toBe(1);
    await fs.remove(rootDir);
  });

  it("requires and stores waiver metadata for waived status", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-escalation-waiver-"));
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
    await syncEscalationLifecycle(rootDir, runDir, "run-1");
    const key = "t1:planner:retry_budget_exhausted";

    await expect(
      updateEscalationLifecycleStatus({
        rootDir,
        key,
        status: "waived",
      }),
    ).rejects.toThrow("Waiver metadata is required");

    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    await updateEscalationLifecycleStatus({
      rootDir,
      key,
      status: "waived",
      waiver: {
        approvedBy: "dexter-ops",
        reason: "Known issue accepted for rollout window",
        expiresAt,
        scope: "run",
      },
    });
    const listed = await listEscalationLifecycle({ rootDir, unresolvedOnly: false });
    const item = listed.items.find((entry) => entry.key === key);
    expect(item?.status).toBe("waived");
    expect(item?.waiver?.approvedBy).toBe("dexter-ops");
    expect(item?.waiver?.expiresAt).toBe(expiresAt);

    await fs.remove(rootDir);
  });

  it("reopens escalations when waiver expires", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-escalation-waiver-expired-"));
    const executionDir = path.join(rootDir, "artifacts", "execution");
    await fs.ensureDir(executionDir);
    const statePath = path.join(executionDir, "ESCALATION_STATE.json");
    await fs.writeJson(
      statePath,
      {
        generatedAt: new Date().toISOString(),
        items: [
          {
            key: "t1:planner:retry_budget_exhausted",
            taskId: "t1",
            target: "planner",
            priority: "medium",
            reason: "retry_budget_exhausted",
            action: "replan",
            status: "waived",
            firstSeenAt: new Date().toISOString(),
            lastSeenAt: new Date().toISOString(),
            lastRunId: "run-1",
            resolvedAt: new Date().toISOString(),
            waiver: {
              approvedBy: "dexter-ops",
              reason: "Temporary waiver",
              expiresAt: new Date(Date.now() - 60_000).toISOString(),
              scope: "run",
            },
          },
        ],
      },
      { spaces: 2 },
    );
    const listed = await listEscalationLifecycle({ rootDir, unresolvedOnly: true });
    expect(listed.unresolved).toBe(1);
    expect(listed.items[0]?.status).toBe("open");
    await fs.remove(rootDir);
  });
});
