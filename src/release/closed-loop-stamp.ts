import type { TaskSpec } from "../protocols/types.js";

const STAMP_TASK_ID = "closed-loop-stamp";

export function isClosedLoopSmokeEnabled(): boolean {
  return process.env.DEXTER_CLOSED_LOOP_SMOKE === "true";
}

export function buildClosedLoopStampTask(runId: string, project: string): TaskSpec {
  const stampPath = "generated/RUN_STAMP.json";
  return {
    id: STAMP_TASK_ID,
    title: "Write run stamp for deploy manifest",
    description: "Record run identity in the repo for deploy manifest and closed-loop verification.",
    mode: "AFK",
    dependencies: [],
    acceptanceCriteria: ["RUN_STAMP.json written with runId"],
    nfrTags: ["traceability"],
    workspaceStrategy: "shared",
    maxAttempts: 2,
    commands: [
      {
        type: "shell",
        command: `mkdir -p generated && printf '{"schemaVersion":"1.0","runId":"${runId}","project":"${project}","generatedAt":"${new Date().toISOString()}"}\\n' > ${stampPath}`,
      },
    ],
    acceptanceChecks: [
      {
        type: "file-exists",
        path: stampPath,
      },
    ],
  };
}

export function injectClosedLoopStampTask(tasks: TaskSpec[], runId: string, project: string): TaskSpec[] {
  if (!isClosedLoopSmokeEnabled()) {
    return tasks;
  }
  if (tasks.some((task) => task.id === STAMP_TASK_ID)) {
    return tasks;
  }

  const stamp = buildClosedLoopStampTask(runId, project);
  const updated = tasks.map((task) => {
    if (task.dependencies.length === 0) {
      return {
        ...task,
        dependencies: [STAMP_TASK_ID],
      };
    }
    return task;
  });
  return [stamp, ...updated];
}
