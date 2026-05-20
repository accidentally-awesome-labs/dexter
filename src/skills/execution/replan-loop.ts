import type { TaskSpec } from "../../protocols/types.js";

export function shouldRetryTask(task: TaskSpec, attempt: number): boolean {
  const maxAttempts = task.maxAttempts ?? 1;
  return attempt < maxAttempts;
}

export function buildRetryHint(task: TaskSpec, attempt: number): string {
  return `Retrying task ${task.id} attempt ${attempt + 1} with tightened acceptance focus.`;
}
