import type { TaskSpec } from "../../protocols/types.js";
import { topologicallySortTasks, validateTaskGraph } from "../planning/graph-validator.js";

export interface ScheduledTask {
  task: TaskSpec;
  skipped: boolean;
  skipReason?: string;
}

export function buildExecutionSchedule(tasks: TaskSpec[]): ScheduledTask[] {
  const validation = validateTaskGraph(tasks);
  if (!validation.valid) {
    throw new Error(`Invalid task graph: ${validation.errors.join("; ")}`);
  }
  const ordered = topologicallySortTasks(tasks);
  return ordered.map((task) => ({ task, skipped: false }));
}
