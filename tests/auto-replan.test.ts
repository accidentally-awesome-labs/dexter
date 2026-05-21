import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import type { ExecutionResult, TaskSpec } from "../src/protocols/types.js";
import { runPlannerReplanWave } from "../src/supervisor/auto-replan.js";

describe("auto replan wave", () => {
  it("reruns planner-targeted tasks with dependency closure and merges execution", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-auto-replan-"));
    const runDir = path.join(rootDir, "runs", "test");
    await fs.ensureDir(runDir);
    const actionsDir = path.join(rootDir, "artifacts", "execution");
    await fs.ensureDir(actionsDir);
    await fs.writeJson(
      path.join(actionsDir, "SUPERVISOR_ACTIONS.json"),
      {
        actions: [
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

    const tasks: TaskSpec[] = [
      {
        id: "t1",
        title: "Task one",
        description: "Task one description",
        mode: "AFK",
        dependencies: [],
        acceptanceCriteria: ["done"],
        nfrTags: [],
        workspaceStrategy: "shared",
        maxAttempts: 1,
        commands: [{ type: "shell", command: "true" }],
        acceptanceChecks: [{ type: "shell", command: "true" }],
      },
      {
        id: "t2",
        title: "Task two",
        description: "Task two description",
        mode: "AFK",
        dependencies: ["t1"],
        acceptanceCriteria: ["done"],
        nfrTags: [],
        workspaceStrategy: "shared",
        maxAttempts: 1,
        commands: [{ type: "shell", command: "true" }],
        acceptanceChecks: [{ type: "shell", command: "true" }],
      },
    ];
    const currentExecution: ExecutionResult[] = [
      {
        taskId: "t1",
        status: "passed",
        logs: [],
        regressionsGenerated: [],
        attempts: 1,
        acceptancePassed: true,
      },
      {
        taskId: "t2",
        status: "failed",
        failureReason: "acceptance_failed",
        escalation: {
          required: true,
          target: "planner",
          reason: "retry_budget_exhausted",
          action: "replan",
        },
        logs: [],
        regressionsGenerated: [],
        attempts: 1,
        acceptancePassed: false,
      },
    ];

    const result = await runPlannerReplanWave({
      rootDir,
      runDir,
      runtime: "docker",
      tasks,
      currentExecution,
      agentBackend: "scripted",
      wave: 1,
    });

    expect(result.attempted).toBe(true);
    expect(result.wave).toBe(1);
    expect(result.plannerTaskIds).toEqual(["t2"]);
    expect(result.rerunTaskIds).toEqual(expect.arrayContaining(["t1", "t2"]));
    expect(result.mergedExecution.find((item) => item.taskId === "t2")?.status).toBe("passed");
    expect(result.waveResultPath).toBeDefined();
    expect(await fs.pathExists(result.waveResultPath!)).toBe(true);

    await fs.remove(rootDir);
  });

  it("detects stalled planner escalation keys across waves", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-auto-replan-stall-"));
    const runDir = path.join(rootDir, "runs", "test");
    await fs.ensureDir(runDir);
    const actionsDir = path.join(rootDir, "artifacts", "execution");
    await fs.ensureDir(actionsDir);
    await fs.writeJson(
      path.join(actionsDir, "SUPERVISOR_ACTIONS.json"),
      {
        actions: [
          {
            key: "t2:planner:retry_budget_exhausted",
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
    const tasks: TaskSpec[] = [
      {
        id: "t2",
        title: "Task two",
        description: "Task two description",
        mode: "AFK",
        dependencies: [],
        acceptanceCriteria: ["done"],
        nfrTags: [],
        workspaceStrategy: "shared",
        maxAttempts: 1,
        commands: [{ type: "shell", command: "true" }],
        acceptanceChecks: [{ type: "shell", command: "true" }],
      },
    ];
    const currentExecution: ExecutionResult[] = [];
    const result = await runPlannerReplanWave({
      rootDir,
      runDir,
      runtime: "docker",
      tasks,
      currentExecution,
      agentBackend: "scripted",
      wave: 2,
      previousPlannerSignature: "t2:planner:retry_budget_exhausted",
    });
    expect(result.attempted).toBe(false);
    expect(result.stalled).toBe(true);
    await fs.remove(rootDir);
  });
});
