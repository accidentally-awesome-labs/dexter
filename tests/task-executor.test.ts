import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { executeTasks } from "../src/skills/execution/task-executor.js";
import type { TaskSpec } from "../src/protocols/types.js";
import { loadRegressionPreventionPolicy } from "../src/verification/regression-prevention-policy.js";

describe("task executor failure modes", () => {
  it("enforces retry boundary, command-failure gating, dependency skips, and backend-unavailable handling", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-executor-root-"));
    const policy = await loadRegressionPreventionPolicy(process.cwd());
    await fs.ensureDir(path.join(rootDir, "docs", "operations"));
    await fs.writeJson(path.join(rootDir, "docs", "operations", "REGRESSION_PREVENTION_TEMPLATES.json"), policy, {
      spaces: 2,
    });
    const runDir = path.join(rootDir, "runs", "test");
    await fs.ensureDir(runDir);
    const previousTemplate = process.env.DEXTER_CURSOR_CLI_COMMAND_TEMPLATE;
    delete process.env.DEXTER_CURSOR_CLI_COMMAND_TEMPLATE;

    const tasks: TaskSpec[] = [
      {
        id: "t1-failing-command",
        title: "Failing command task",
        description: "Task with a failing command that should not pass acceptance.",
        mode: "AFK",
        dependencies: [],
        acceptanceCriteria: ["shell command succeeds"],
        nfrTags: ["reliability"],
        workspaceStrategy: "shared",
        maxAttempts: 2,
        commands: [{ type: "shell", command: "false" }],
        acceptanceChecks: [{ type: "shell", command: "true" }],
      },
      {
        id: "t2-dependent",
        title: "Dependent task",
        description: "Should be skipped when dependency fails.",
        mode: "AFK",
        dependencies: ["t1-failing-command"],
        acceptanceCriteria: ["dependency passed"],
        nfrTags: ["reliability"],
        workspaceStrategy: "shared",
        maxAttempts: 1,
        commands: [{ type: "shell", command: "true" }],
        acceptanceChecks: [{ type: "shell", command: "true" }],
      },
      {
        id: "t3-backend-required",
        title: "Backend-specific task",
        description: "Should fail when required backend is unavailable.",
        mode: "AFK",
        dependencies: [],
        acceptanceCriteria: ["backend available"],
        nfrTags: ["reliability"],
        workspaceStrategy: "shared",
        maxAttempts: 1,
        backendHint: "cursor-cli",
        commands: [{ type: "agent", prompt: "do work" }],
        acceptanceChecks: [{ type: "shell", command: "true" }],
      },
    ];

    const results = await executeTasks(tasks, {
      rootDir,
      runDir,
      runtime: "docker",
      agentBackend: "scripted",
    });

    const first = results.find((result) => result.taskId === "t1-failing-command");
    const second = results.find((result) => result.taskId === "t2-dependent");
    const third = results.find((result) => result.taskId === "t3-backend-required");

    expect(first).toBeDefined();
    expect(first?.status).toBe("failed");
    expect(first?.failureReason).toBe("command_failed");
    expect(first?.escalation?.required).toBe(true);
    expect(first?.escalation?.target).toBe("planner");
    expect(first?.attempts).toBe(2);
    expect(first?.acceptancePassed).toBe(false);

    expect(second).toBeDefined();
    expect(second?.status).toBe("skipped");
    expect(second?.failureReason).toBe("dependency_blocked");
    expect(second?.blockedBy).toEqual(["t1-failing-command"]);
    expect(second?.escalation?.required).toBe(false);
    expect(second?.escalation?.target).toBe("none");
    expect(second?.attempts).toBe(0);
    expect(third).toBeDefined();
    expect(third?.status).toBe("failed");
    expect(third?.failureReason).toBe("backend_unavailable");
    expect(third?.escalation?.required).toBe(true);
    expect(third?.escalation?.target).toBe("operator");
    expect(third?.attempts).toBe(1);

    if (previousTemplate) {
      process.env.DEXTER_CURSOR_CLI_COMMAND_TEMPLATE = previousTemplate;
    }
    await fs.remove(rootDir);
  });
});
