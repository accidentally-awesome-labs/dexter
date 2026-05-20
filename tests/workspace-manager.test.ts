import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { cleanupTaskWorkspace, prepareTaskWorkspace } from "../src/runtime/workspace-manager.js";

describe("workspace manager", () => {
  it("falls back to copy strategy when git is unavailable", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-workspace-root-"));
    const runDir = path.join(rootDir, "runs", "test-run");
    await fs.ensureDir(runDir);
    await fs.writeFile(path.join(rootDir, "sample.txt"), "hello");

    const workspace = await prepareTaskWorkspace(rootDir, runDir, "task-copy", "copy");
    const copied = await fs.pathExists(path.join(workspace.path, "sample.txt"));
    expect(workspace.strategy).toBe("copy");
    expect(copied).toBe(true);

    await cleanupTaskWorkspace(rootDir, workspace);
    expect(await fs.pathExists(workspace.path)).toBe(false);
    await fs.remove(rootDir);
  });
});
