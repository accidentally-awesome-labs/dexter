import path from "node:path";
import fs from "fs-extra";
import type { ExecutionResult, TaskSpec } from "../protocols/types.js";
import { executeTasks } from "../skills/execution/task-executor.js";

interface SupervisorActionsPlan {
  actions: Array<{
    key?: string;
    taskId: string;
    target: "operator" | "planner";
    priority: "high" | "medium";
    reason: string;
    action: string;
  }>;
}

export interface AutoReplanResult {
  wave: number;
  attempted: boolean;
  plannerTaskIds: string[];
  plannerEscalationKeys: string[];
  plannerSignature?: string;
  rerunTaskIds: string[];
  mergedExecution: ExecutionResult[];
  stalled: boolean;
  stallReason?: string;
  waveResultPath?: string;
}

function collectDependencyClosure(taskIds: string[], taskMap: Map<string, TaskSpec>): string[] {
  const seen = new Set<string>();
  const visit = (taskId: string) => {
    if (seen.has(taskId)) {
      return;
    }
    const task = taskMap.get(taskId);
    if (!task) {
      return;
    }
    seen.add(taskId);
    for (const dep of task.dependencies) {
      visit(dep);
    }
  };
  for (const taskId of taskIds) {
    visit(taskId);
  }
  return [...seen];
}

export async function runPlannerReplanWave(options: {
  rootDir: string;
  runDir: string;
  runtime: "docker" | "podman";
  agentBackend?: string;
  tasks: TaskSpec[];
  currentExecution: ExecutionResult[];
  wave: number;
  previousPlannerSignature?: string;
}): Promise<AutoReplanResult> {
  const supervisorActionsPath = path.join(options.rootDir, "artifacts", "execution", "SUPERVISOR_ACTIONS.json");
  if (!(await fs.pathExists(supervisorActionsPath))) {
    return {
      wave: options.wave,
      attempted: false,
      plannerTaskIds: [],
      plannerEscalationKeys: [],
      rerunTaskIds: [],
      mergedExecution: options.currentExecution,
      stalled: false,
    };
  }
  const plan = (await fs.readJson(supervisorActionsPath)) as SupervisorActionsPlan;
  const plannerActions = plan.actions.filter((action) => action.target === "planner");
  const plannerTaskIds = [...new Set(plannerActions.map((action) => action.taskId))];
  const plannerEscalationKeys = plannerActions.map(
    (action) => action.key ?? `${action.taskId}:${action.target}:${action.reason}`,
  );
  const plannerSignature = [...plannerEscalationKeys].sort().join("|");
  if (options.previousPlannerSignature && plannerSignature === options.previousPlannerSignature) {
    return {
      wave: options.wave,
      attempted: false,
      plannerTaskIds,
      plannerEscalationKeys,
      plannerSignature,
      rerunTaskIds: [],
      mergedExecution: options.currentExecution,
      stalled: true,
      stallReason: "Planner escalation keys unchanged from previous wave.",
    };
  }
  if (plannerTaskIds.length === 0) {
    return {
      wave: options.wave,
      attempted: false,
      plannerTaskIds,
      plannerEscalationKeys,
      plannerSignature,
      rerunTaskIds: [],
      mergedExecution: options.currentExecution,
      stalled: false,
    };
  }

  const taskMap = new Map(options.tasks.map((task) => [task.id, task]));
  const rerunTaskIds = collectDependencyClosure(plannerTaskIds, taskMap);
  const rerunTaskSet = new Set(rerunTaskIds);
  const rerunTasks = options.tasks
    .filter((task) => rerunTaskSet.has(task.id))
    .map((task) => ({
      ...task,
      maxAttempts: plannerTaskIds.includes(task.id) ? Math.min((task.maxAttempts ?? 1) + 1, 5) : task.maxAttempts,
    }));

  const rerunResults = await executeTasks(rerunTasks, {
    rootDir: options.rootDir,
    runtime: options.runtime,
    runDir: options.runDir,
    agentBackend: options.agentBackend,
  });

  const mergedMap = new Map(options.currentExecution.map((result) => [result.taskId, result]));
  for (const result of rerunResults) {
    mergedMap.set(result.taskId, result);
  }
  const mergedExecution = options.tasks
    .map((task) => mergedMap.get(task.id))
    .filter((result): result is ExecutionResult => Boolean(result));

  const waveResultPath = path.join(options.runDir, `replan_wave_${options.wave}_results.json`);
  await fs.writeJson(
    waveResultPath,
    {
      wave: options.wave,
      plannerTaskIds,
      plannerEscalationKeys,
      plannerSignature,
      rerunTaskIds,
      rerunResults,
      mergedExecution,
    },
    { spaces: 2 },
  );

  return {
    wave: options.wave,
    attempted: true,
    plannerTaskIds,
    plannerEscalationKeys,
    plannerSignature,
    rerunTaskIds,
    mergedExecution,
    stalled: false,
    waveResultPath,
  };
}
