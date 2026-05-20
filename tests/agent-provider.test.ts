import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { createAgentProvider, listAgentProviderIds } from "../src/providers/agents/factory.js";
import type { TaskSpec } from "../src/protocols/types.js";

describe("agent provider factory", () => {
  it("lists pluggable backends", () => {
    const ids = listAgentProviderIds();
    expect(ids).toContain("scripted");
    expect(ids).toContain("shell");
    expect(ids).toContain("cursor-cli");
  });

  it("executes scripted provider and writes artifact", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-agent-provider-"));
    const provider = createAgentProvider("scripted");
    const task: TaskSpec = {
      id: "task-1",
      title: "task",
      description: "task description",
      mode: "AFK",
      dependencies: [],
      acceptanceCriteria: ["done"],
      nfrTags: [],
    };
    const result = await provider.execute({
      task,
      prompt: "Write something",
      workspaceDir,
      rootDir: workspaceDir,
    });
    expect(result.ok).toBe(true);
    expect(await fs.pathExists(path.join(workspaceDir, ".dexter-agent", "task-1.md"))).toBe(true);
    await fs.remove(workspaceDir);
  });
});
