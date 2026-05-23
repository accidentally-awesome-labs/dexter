import type { ExecutionEscalation, ExecutionResult, TaskSpec } from "../../protocols/types.js";
import path from "node:path";
import fs from "fs-extra";
import { runTask } from "../../runtime/container-runner.js";
import { prepareTaskWorkspace, cleanupTaskWorkspace } from "../../runtime/workspace-manager.js";
import { resolveAgentProviderWithPolicy } from "../../providers/agents/factory.js";
import { verifyTaskAcceptance } from "./acceptance-verifier.js";
import { evaluateRetryPolicy } from "./replan-loop.js";
import { buildExecutionSchedule } from "./task-scheduler.js";
import { loadRegressionRemediationPolicy } from "../../verification/regression-prevention.js";

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
  const remediationPolicy = await loadRegressionRemediationPolicy(options.rootDir);
  const schedule = buildExecutionSchedule(taskGraph);
  const statusByTaskId = new Map<string, "passed" | "failed" | "skipped">();

  for (const scheduled of schedule) {
    const task = scheduled.task;
    const blockedBy = task.dependencies.filter((dep) => statusByTaskId.get(dep) !== "passed");
    const blockedByDependency = blockedBy.length > 0;
    if (blockedByDependency) {
      statusByTaskId.set(task.id, "skipped");
      results.push({
        taskId: task.id,
        status: "skipped",
        failureReason: "dependency_blocked",
        blockedBy,
        escalation: {
          required: false,
          target: "none",
          reason: "dependency_blocked",
          action: "Wait for dependencies to pass before rerun.",
        },
        logs: [`Skipped task ${task.id} due to failed dependency.`],
        regressionsGenerated: [],
        attempts: 0,
        acceptancePassed: false,
      });
      continue;
    }
    const requestedBackend = task.backendHint ?? options.agentBackend;
    let providerSelection: ReturnType<typeof resolveAgentProviderWithPolicy>;
    try {
      providerSelection = resolveAgentProviderWithPolicy(requestedBackend, {
        allowFallback: !task.backendHint,
      });
    } catch (error) {
      statusByTaskId.set(task.id, "failed");
      results.push({
        taskId: task.id,
        status: "failed",
        failureReason: "backend_unavailable",
        escalation: {
          required: true,
          target: "operator",
          reason: "backend_unavailable",
          action: "Configure requested backend and rerun the task.",
        },
        logs: [
          `Task ${task.id} requested backend "${requestedBackend ?? "default"}" but it is unavailable.`,
          `Reason: ${(error as Error).message}`,
          "Escalate to operator: configure backend and rerun.",
        ],
        regressionsGenerated: [],
        attempts: 1,
        acceptancePassed: false,
      });
      continue;
    }
    const provider = providerSelection.provider;

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
    let failureReason: ExecutionResult["failureReason"];
    let escalation: ExecutionEscalation = {
      required: false,
      target: "none",
      reason: "in_progress",
      action: "No escalation required.",
    };
    let cleanupError: Error | undefined;
    try {
      do {
        attempt += 1;
        const logs: string[] = [
          `Agent provider selected=${providerSelection.selectedId} requested=${providerSelection.requestedId}`,
        ];
        if (providerSelection.fallbackReason) {
          logs.push(`Agent provider fallback: ${providerSelection.fallbackReason}`);
        }
        let commandFailed = false;
        for (const command of task.commands ?? []) {
          try {
            if (command.type === "agent") {
              const agentResult = await provider.execute({
                task,
                prompt: command.prompt ?? task.description,
                workspaceDir: workspace.path,
                rootDir: options.rootDir,
              });
              logs.push(`Agent backend ${provider.id}: ${agentResult.summary}`);
              if (!agentResult.ok) {
                commandFailed = true;
                failureReason = "command_failed";
                logs.push(`Agent execution failed for task ${task.id}`);
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
                commandFailed = true;
                failureReason = "command_failed";
                logs.push(`Command failed in task ${task.id}`);
              }
            }
          } catch (error) {
            commandFailed = true;
            failureReason = "command_failed";
            logs.push(`Command execution threw in task ${task.id}: ${(error as Error).message}`);
          }
        }
        const acceptance = await verifyTaskAcceptance(task, workspace.path);
        acceptancePassed = acceptance.passed && !commandFailed;
        logs.push(...acceptance.details);
        if (commandFailed) {
          logs.push("One or more task commands failed; forcing acceptance failure for this attempt.");
        } else if (!acceptance.passed) {
          failureReason = "acceptance_failed";
        }
        lastLogs = logs;
        if (acceptancePassed) {
          finalStatus = "passed";
          failureReason = undefined;
          break;
        }
        const retryPolicy = evaluateRetryPolicy(
          task,
          attempt,
          failureReason ?? "acceptance_failed",
          remediationPolicy,
        );
        lastLogs.push(retryPolicy.hint);
        escalation = retryPolicy.escalation;
        if (retryPolicy.escalation.required) {
          lastLogs.push(
            `Escalate to ${retryPolicy.escalation.target}: ${retryPolicy.escalation.action} (${retryPolicy.escalation.reason})`,
          );
        }
        if (!retryPolicy.shouldRetry) {
          break;
        }
      } while (true);
    } finally {
      try {
        await cleanupTaskWorkspace(options.rootDir, workspace);
      } catch (error) {
        cleanupError = error as Error;
      }
    }
    if (cleanupError) {
      finalStatus = "failed";
      acceptancePassed = false;
      failureReason = "cleanup_failed";
      escalation = {
        required: true,
        target: "operator",
        reason: "cleanup_failed",
        action: "Inspect workspace cleanup and stale git worktree state.",
      };
      lastLogs.push(`Workspace cleanup failed for task ${task.id}: ${cleanupError.message}`);
      lastLogs.push("Escalate to operator: inspect workspace cleanup and stale git worktree state.");
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
      failureReason: finalStatus === "passed" ? undefined : failureReason ?? "acceptance_failed",
      escalation:
        finalStatus === "passed"
          ? {
              required: false,
              target: "none",
              reason: "completed",
              action: "No escalation required.",
            }
          : escalation,
      logs: [`Executed task ${task.id} (${task.mode})`, ...lastLogs].filter(Boolean),
      regressionsGenerated,
      attempts: attempt,
      acceptancePassed,
    });
    statusByTaskId.set(task.id, finalStatus);
  }

  return results;
}
