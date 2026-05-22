import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskSpec } from "../src/protocols/types.js";

const prepareTaskWorkspaceMock = vi.fn();
const cleanupTaskWorkspaceMock = vi.fn();
const providerExecuteMock = vi.fn();
const verifyTaskAcceptanceMock = vi.fn();
const runTaskMock = vi.fn();

vi.mock("../src/runtime/workspace-manager.js", () => ({
  prepareTaskWorkspace: prepareTaskWorkspaceMock,
  cleanupTaskWorkspace: cleanupTaskWorkspaceMock,
}));

vi.mock("../src/providers/agents/factory.js", () => ({
  resolveAgentProviderWithPolicy: () => ({
    provider: {
      id: "mock-provider",
      execute: providerExecuteMock,
      isReady: () => ({ ready: true }),
    },
    selectedId: "mock-provider",
    requestedId: "mock-provider",
  }),
}));

vi.mock("../src/skills/execution/acceptance-verifier.js", () => ({
  verifyTaskAcceptance: verifyTaskAcceptanceMock,
}));

vi.mock("../src/runtime/container-runner.js", () => ({
  runTask: runTaskMock,
}));

describe("task executor cleanup behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cleans up workspace when command execution throws", async () => {
    const runDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-executor-cleanup-"));
    const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-executor-cleanup-ws-"));

    prepareTaskWorkspaceMock.mockResolvedValue({
      strategy: "copy",
      path: workspacePath,
      cleanup: true,
    });
    cleanupTaskWorkspaceMock.mockResolvedValue(undefined);
    providerExecuteMock.mockRejectedValue(new Error("provider crash"));
    verifyTaskAcceptanceMock.mockResolvedValue({
      passed: false,
      details: ["acceptance failed"],
    });
    runTaskMock.mockResolvedValue({
      ok: true,
      mode: "local-fallback",
      command: "true",
      stdout: "",
      stderr: "",
    });

    const { executeTasks } = await import("../src/skills/execution/task-executor.js");
    const tasks: TaskSpec[] = [
      {
        id: "t1",
        title: "Task one",
        description: "Task one description",
        mode: "AFK",
        dependencies: [],
        acceptanceCriteria: ["done"],
        nfrTags: [],
        maxAttempts: 1,
        commands: [{ type: "agent", prompt: "do work" }],
        acceptanceChecks: [{ type: "shell", command: "true" }],
      },
    ];

    const results = await executeTasks(tasks, {
      rootDir: runDir,
      runDir,
      runtime: "docker",
      agentBackend: "scripted",
    });

    expect(results[0]?.status).toBe("failed");
    expect(results[0]?.failureReason).toBe("command_failed");
    expect(results[0]?.escalation?.required).toBe(true);
    expect(results[0]?.escalation?.target).toBe("planner");
    expect(cleanupTaskWorkspaceMock).toHaveBeenCalledTimes(1);
    await fs.remove(runDir);
    await fs.remove(workspacePath);
  }, 30_000);
});
