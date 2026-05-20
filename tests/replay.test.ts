import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, describe, expect, it } from "vitest";
import { runDexter } from "../src/core/orchestrator.js";

async function seedHooks(rootDir: string) {
  const hooksDir = path.join(rootDir, "infra", "coolify", "hooks");
  await fs.ensureDir(hooksDir);
  await fs.writeFile(path.join(hooksDir, "deploy.sh"), "#!/usr/bin/env sh\necho deploy\n");
  await fs.writeFile(path.join(hooksDir, "rollback.sh"), "#!/usr/bin/env sh\necho rollback\n");
}

describe("deterministic replay", () => {
  afterEach(() => {
    delete process.env.DEXTER_AUTO_APPROVE_HITL;
  });

  it("produces stable planning artifacts across runs for same input", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-replay-"));
    await seedHooks(rootDir);
    process.env.DEXTER_AUTO_APPROVE_HITL = "true";

    await runDexter(rootDir, {
      project: "sample-app",
      idea: "Build a deterministic execution pipeline",
      constraints: ["self-hosted-first"],
      targetUsers: ["engineers"],
    });
    const firstTaskGraph = await fs.readFile(path.join(rootDir, "artifacts", "planning", "TASK_GRAPH.json"), "utf8");
    const firstPrd = await fs.readFile(path.join(rootDir, "artifacts", "planning", "PRD.md"), "utf8");

    await runDexter(rootDir, {
      project: "sample-app",
      idea: "Build a deterministic execution pipeline",
      constraints: ["self-hosted-first"],
      targetUsers: ["engineers"],
    });
    const secondTaskGraph = await fs.readFile(path.join(rootDir, "artifacts", "planning", "TASK_GRAPH.json"), "utf8");
    const secondPrd = await fs.readFile(path.join(rootDir, "artifacts", "planning", "PRD.md"), "utf8");

    expect(secondTaskGraph).toBe(firstTaskGraph);
    expect(secondPrd).toBe(firstPrd);
  });
});
