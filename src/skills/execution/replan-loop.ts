import type { ExecutionEscalation, ExecutionFailureReason, TaskSpec } from "../../protocols/types.js";

export function shouldRetryTask(task: TaskSpec, attempt: number): boolean {
  const maxAttempts = task.maxAttempts ?? 1;
  return attempt < maxAttempts;
}

export function buildRetryHint(task: TaskSpec, attempt: number, reason: ExecutionFailureReason): string {
  if (reason === "command_failed") {
    return `Retrying task ${task.id} attempt ${attempt + 1}: command failed, focus on deterministic command execution and diagnostics.`;
  }
  if (reason === "acceptance_failed") {
    return `Retrying task ${task.id} attempt ${attempt + 1}: acceptance failed, focus on producing artifacts required by checks.`;
  }
  return `Retrying task ${task.id} attempt ${attempt + 1} with tightened acceptance focus.`;
}

export function evaluateRetryPolicy(
  task: TaskSpec,
  attempt: number,
  reason: ExecutionFailureReason,
): {
  shouldRetry: boolean;
  hint: string;
  escalation: ExecutionEscalation;
} {
  if (reason === "cleanup_failed") {
    return {
      shouldRetry: false,
      hint: "Workspace cleanup failed; task retries are halted to avoid leaking state across attempts.",
      escalation: {
        required: true,
        target: "operator",
        reason: "cleanup_failed",
        action: "Inspect and prune stale worktrees before rerun.",
      },
    };
  }
  if (reason === "backend_unavailable") {
    return {
      shouldRetry: false,
      hint: "Requested backend is unavailable; retries cannot self-heal configuration issues.",
      escalation: {
        required: true,
        target: "operator",
        reason: "backend_unavailable",
        action: "Configure backend credentials/template or change backendHint.",
      },
    };
  }
  const retry = shouldRetryTask(task, attempt);
  return {
    shouldRetry: retry,
    hint: retry
      ? buildRetryHint(task, attempt, reason)
      : `Task ${task.id} exhausted retry budget after ${attempt} attempt(s).`,
    escalation: retry
      ? {
          required: false,
          target: "none",
          reason: "retry_in_progress",
          action: "Continue automated retry loop.",
        }
      : {
          required: true,
          target: "planner",
          reason: "retry_budget_exhausted",
          action: "Regenerate task commands/checks with stronger constraints.",
        },
  };
}
