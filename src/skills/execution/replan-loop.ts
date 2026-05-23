import type { ExecutionEscalation, ExecutionFailureReason, TaskSpec } from "../../protocols/types.js";
import {
  buildRegressionRemediation,
  formatRemediationHint,
  type RegressionRemediation,
} from "../../verification/regression-prevention.js";
import type { RegressionPreventionPolicy } from "../../verification/regression-prevention-policy.js";

export function shouldRetryTask(task: TaskSpec, attempt: number): boolean {
  const maxAttempts = task.maxAttempts ?? 1;
  return attempt < maxAttempts;
}

export function buildRetryHint(
  task: TaskSpec,
  attempt: number,
  reason: ExecutionFailureReason,
  remediation?: RegressionRemediation,
): string {
  if (remediation) {
    return `Retrying task ${task.id} attempt ${attempt + 1}: ${formatRemediationHint(remediation)}`;
  }
  if (reason === "command_failed") {
    return `Retrying task ${task.id} attempt ${attempt + 1}: command failed, focus on deterministic command execution and diagnostics.`;
  }
  if (reason === "acceptance_failed") {
    return `Retrying task ${task.id} attempt ${attempt + 1}: acceptance failed, focus on producing artifacts required by checks.`;
  }
  return `Retrying task ${task.id} attempt ${attempt + 1} with tightened acceptance focus.`;
}

function remediationFor(
  policy: RegressionPreventionPolicy | undefined,
  failureReason: ExecutionFailureReason,
  escalationReason: string,
): RegressionRemediation | undefined {
  if (!policy) {
    return undefined;
  }
  return buildRegressionRemediation(policy, {
    failureReason,
    escalationReason,
  });
}

export function evaluateRetryPolicy(
  task: TaskSpec,
  attempt: number,
  reason: ExecutionFailureReason,
  policy?: RegressionPreventionPolicy,
): {
  shouldRetry: boolean;
  hint: string;
  escalation: ExecutionEscalation;
  remediation?: RegressionRemediation;
} {
  if (reason === "cleanup_failed") {
    const remediation = remediationFor(policy, reason, "cleanup_failed");
    return {
      shouldRetry: false,
      hint: remediation
        ? `Workspace cleanup failed; ${remediation.retryGuidance}`
        : "Workspace cleanup failed; task retries are halted to avoid leaking state across attempts.",
      escalation: {
        required: true,
        target: "operator",
        reason: "cleanup_failed",
        action: "Inspect and prune stale worktrees before rerun.",
      },
      remediation,
    };
  }
  if (reason === "backend_unavailable") {
    const remediation = remediationFor(policy, reason, "backend_unavailable");
    return {
      shouldRetry: false,
      hint: remediation
        ? `Requested backend is unavailable; ${remediation.retryGuidance}`
        : "Requested backend is unavailable; retries cannot self-heal configuration issues.",
      escalation: {
        required: true,
        target: "operator",
        reason: "backend_unavailable",
        action: "Configure backend credentials/template or change backendHint.",
      },
      remediation,
    };
  }
  const retry = shouldRetryTask(task, attempt);
  const escalation: ExecutionEscalation = retry
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
      };
  const remediation = remediationFor(policy, reason, escalation.reason);
  return {
    shouldRetry: retry,
    hint: retry
      ? buildRetryHint(task, attempt, reason, remediation)
      : remediation
        ? `Task ${task.id} exhausted retry budget. ${formatRemediationHint(remediation)}`
        : `Task ${task.id} exhausted retry budget after ${attempt} attempt(s).`,
    escalation,
    remediation,
  };
}
