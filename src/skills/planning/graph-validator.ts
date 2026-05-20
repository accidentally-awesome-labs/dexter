import type { TaskSpec } from "../../protocols/types.js";

export interface GraphValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateTaskGraph(tasks: TaskSpec[]): GraphValidationResult {
  const errors: string[] = [];
  const idSet = new Set<string>();
  for (const task of tasks) {
    if (idSet.has(task.id)) {
      errors.push(`Duplicate task id: ${task.id}`);
    }
    idSet.add(task.id);
    for (const dep of task.dependencies) {
      if (!dep || dep === task.id) {
        errors.push(`Invalid dependency "${dep}" on task ${task.id}`);
      }
    }
  }

  for (const task of tasks) {
    for (const dep of task.dependencies) {
      if (!idSet.has(dep)) {
        errors.push(`Task ${task.id} depends on unknown task ${dep}`);
      }
    }
  }

  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const task of tasks) {
    inDegree.set(task.id, inDegree.get(task.id) ?? 0);
    adjacency.set(task.id, adjacency.get(task.id) ?? []);
  }
  for (const task of tasks) {
    for (const dep of task.dependencies) {
      inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
      const next = adjacency.get(dep) ?? [];
      next.push(task.id);
      adjacency.set(dep, next);
    }
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(id);
    }
  }
  let visited = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    visited += 1;
    for (const next of adjacency.get(current) ?? []) {
      const degree = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, degree);
      if (degree === 0) {
        queue.push(next);
      }
    }
  }
  if (visited !== tasks.length) {
    errors.push("Task graph contains a cycle.");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function topologicallySortTasks(tasks: TaskSpec[]): TaskSpec[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const task of tasks) {
    inDegree.set(task.id, 0);
    adjacency.set(task.id, []);
  }
  for (const task of tasks) {
    for (const dep of task.dependencies) {
      inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
      adjacency.set(dep, [...(adjacency.get(dep) ?? []), task.id]);
    }
  }
  const queue = [...inDegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id);
  const ordered: TaskSpec[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    ordered.push(byId.get(id)!);
    for (const next of adjacency.get(id) ?? []) {
      const degree = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, degree);
      if (degree === 0) {
        queue.push(next);
      }
    }
  }
  if (ordered.length !== tasks.length) {
    return tasks;
  }
  return ordered;
}
