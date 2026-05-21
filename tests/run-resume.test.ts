import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { resumeDexterRun } from "../src/core/orchestrator.js";

describe("run resume", () => {
  it("blocks resume when unresolved high-priority operator escalations exist", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-resume-"));
    const runId = "run-blocked";
    const runDir = path.join(rootDir, "runs", runId);
    await fs.ensureDir(runDir);

    await fs.writeJson(
      path.join(runDir, "context.json"),
      {
        runId,
        rootDir,
        runDir,
        projectDir: path.join(rootDir, "state", "sample-app"),
        idea: {
          project: "sample-app",
          idea: "Build sample app",
          constraints: [],
          targetUsers: [],
        },
        now: new Date().toISOString(),
      },
      { spaces: 2 },
    );
    await fs.writeJson(
      path.join(runDir, "execution_results.json"),
      [
        {
          taskId: "t1",
          status: "failed",
          failureReason: "backend_unavailable",
          escalation: {
            required: true,
            target: "operator",
            reason: "backend_unavailable",
            action: "configure",
          },
          logs: [],
          regressionsGenerated: [],
          attempts: 1,
          acceptancePassed: false,
        },
      ],
      { spaces: 2 },
    );

    await expect(resumeDexterRun(rootDir, runId)).rejects.toThrow("Resume blocked");
    await fs.remove(rootDir);
  });
});
