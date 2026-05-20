import type { ExecutionResult, TaskSpec } from "../../protocols/types.js";
import path from "node:path";
import fs from "fs-extra";
import { runTask } from "../../runtime/container-runner.js";

interface ExecuteOptions {
  rootDir: string;
  runtime: "docker" | "podman";
  runDir: string;
}

export async function executeTasks(taskGraph: TaskSpec[], options: ExecuteOptions): Promise<ExecutionResult[]> {
  const results: ExecutionResult[] = [];
  const regressionsDir = path.join(options.runDir, "regressions");
  await fs.ensureDir(regressionsDir);

  for (const task of taskGraph) {
    const runResult = await runTask(options.rootDir, options.runtime, task);
    const regressionsGenerated =
      task.mode === "AFK" ? [path.join(regressionsDir, `regression-${task.id}.spec.md`)] : [];
    await Promise.all(
      regressionsGenerated.map((regressionFile) =>
        fs.writeFile(
          regressionFile,
          `# Regression for ${task.id}\n\n- Runner mode: ${runResult.mode}\n- Command: ${runResult.command}\n`,
        ),
      ),
    );

    results.push({
      taskId: task.id,
      status: runResult.ok ? "passed" : "failed",
      logs: [
        `Executed task ${task.id} (${task.mode})`,
        `Runner mode: ${runResult.mode}`,
        `Command: ${runResult.command}`,
        runResult.stdout ? `Stdout: ${runResult.stdout}` : "",
        runResult.stderr ? `Stderr: ${runResult.stderr}` : "",
      ].filter(Boolean),
      regressionsGenerated,
    });
  }

  return results;
}
