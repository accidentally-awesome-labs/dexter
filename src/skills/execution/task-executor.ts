import type { ExecutionResult, TaskSpec } from "../../protocols/types.js";
import path from "node:path";
import fs from "fs-extra";
import { runTask } from "../../runtime/container-runner.js";
import { prepareTaskWorkspace, cleanupTaskWorkspace } from "../../runtime/workspace-manager.js";
import { createAgentProvider } from "../../providers/agents/factory.js";
import { verifyTaskAcceptance } from "./acceptance-verifier.js";
import { shouldRetryTask, buildRetryHint } from "./replan-loop.js";
import { buildExecutionSchedule } from "./task-scheduler.js";

interface ExecuteOptions {
  rootDir: string;
  runtime: "docker" | "podman";
  runDir: string;
  agentBackend?: string;
}

export async function executeTasks(taskGraph: TaskSpec[], options: ExecuteOptions): Promise<ExecutionResult[]> {
  const results: ExecutionResult[] = [];
  const regressionsDir = path.join(options.runDir, "regressions");
  await fs.ensureDir(regressionsDir);
  const provider = createAgentProvider(options.agentBackend);
  const schedule = buildExecutionSchedule(taskGraph);
  const statusByTaskId = new Map<string, "passed" | "failed" | "skipped">();

  for (const scheduled of schedule) {
    const task = scheduled.task;
    const blockedByDependency = task.dependencies.some((dep) => statusByTaskId.get(dep) !== "passed");
    if (blockedByDependency) {
      statusByTaskId.set(task.id, "skipped");
      results.push({
        taskId: task.id,
        status: "failed",
        logs: [`Skipped task ${task.id} due to failed dependency.`],
        regressionsGenerated: [],
        attempts: 0,
        acceptancePassed: false,
      });
      continue;
    }

    const workspace = await prepareTaskWorkspace(
      options.rootDir,
      options.runDir,
      task.id,
      task.workspaceStrategy ?? "git-worktree",
    );
    let attempt = 0;
    let finalStatus: "passed" | "failed" = "failed";
    let acceptancePassed = false;
    let lastLogs: string[] = [];
    try {
      do {
        attempt += 1;
        const logs: string[] = [];
        for (const command of task.commands ?? []) {
          if (command.type === "agent") {
            const agentResult = await provider.execute({
              task,
              prompt: command.prompt ?? task.description,
              workspaceDir: workspace.path,
              rootDir: options.rootDir,
            });
            logs.push(`Agent backend ${provider.id}: ${agentResult.summary}`);
            if (!agentResult.ok) {
              logs.push(`Agent execution failed for task ${task.id}`);
              lastLogs = logs;
              continue;
            }
          } else {
            const runResult = await runTask(
              options.rootDir,
              options.runtime,
              task,
              workspace.path,
              command.command,
            );
            logs.push(`Runner mode: ${runResult.mode}`);
            logs.push(`Command: ${runResult.command}`);
            if (runResult.stdout) {
              logs.push(`Stdout: ${runResult.stdout}`);
            }
            if (runResult.stderr) {
              logs.push(`Stderr: ${runResult.stderr}`);
            }
            if (!runResult.ok) {
              logs.push(`Command failed in task ${task.id}`);
            }
          }
        }
        const acceptance = await verifyTaskAcceptance(task, workspace.path);
        acceptancePassed = acceptance.passed;
        logs.push(...acceptance.details);
        lastLogs = logs;
        if (acceptancePassed) {
          finalStatus = "passed";
          break;
        }
        if (shouldRetryTask(task, attempt)) {
          lastLogs.push(buildRetryHint(task, attempt));
        }
      } while (shouldRetryTask(task, attempt));
    } finally {
      await cleanupTaskWorkspace(options.rootDir, workspace);
    }

    const regressionsGenerated =
      task.mode === "AFK" ? [path.join(regressionsDir, `regression-${task.id}.spec.md`)] : [];
    await Promise.all(
      regressionsGenerated.map((regressionFile) =>
        fs.writeFile(
          regressionFile,
          `# Regression for ${task.id}\n\n- Attempts: ${attempt}\n- Acceptance passed: ${acceptancePassed}\n`,
        ),
      ),
    );

    results.push({
      taskId: task.id,
      status: finalStatus,
      logs: [`Executed task ${task.id} (${task.mode})`, ...lastLogs].filter(Boolean),
      regressionsGenerated,
      attempts: attempt,
      acceptancePassed,
    });
    statusByTaskId.set(task.id, finalStatus);
  }

  return results;
}
