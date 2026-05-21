import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { verifyTaskAcceptance } from "../src/skills/execution/acceptance-verifier.js";
import type { TaskSpec } from "../src/protocols/types.js";

function makeTask(partial: Partial<TaskSpec>): TaskSpec {
  return {
    id: "task-1",
    title: "Task",
    description: "Task description",
    mode: "AFK",
    dependencies: [],
    acceptanceCriteria: ["done"],
    nfrTags: [],
    ...partial,
  };
}

describe("acceptance verifier", () => {
  it("fails AFK task with no structured checks", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-acceptance-"));
    const result = await verifyTaskAcceptance(makeTask({ mode: "AFK" }), workspaceDir);
    expect(result.passed).toBe(false);
    expect(result.details.join(" ")).toContain("AFK task missing structured acceptance checks");
    await fs.remove(workspaceDir);
  });

  it("allows HITL task with no structured checks", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-acceptance-hitl-"));
    const result = await verifyTaskAcceptance(makeTask({ mode: "HITL" }), workspaceDir);
    expect(result.passed).toBe(true);
    expect(result.details.join(" ")).toContain("HITL");
    await fs.remove(workspaceDir);
  });
});
