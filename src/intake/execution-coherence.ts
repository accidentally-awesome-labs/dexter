import type { ExecutionResult, TaskSpec } from "../protocols/types.js";
import type { IntakeBrief } from "./schema.js";
import { isAfkEligible } from "./mode-routing.js";

export interface IntakeExecutionCoherenceCheck {
  id: string;
  passed: boolean;
  details: string;
}

export interface IntakeExecutionManifest {
  schemaVersion: "1.0";
  intakeId: string;
  runId: string;
  generatedAt: string;
  intake: {
    ambiguityScore: number;
    clarificationRequired: boolean;
    riskScore: number;
    highRisk: boolean;
    priorityScore: number;
  };
  routing: {
    tasksTotal: number;
    routedToHitl: number;
    routedToAfk: number;
    hitlTaskIds: string[];
    afkEligibleTaskIds: string[];
  };
  execution: {
    tasksPassed: number;
    tasksFailed: number;
    tasksSkipped: number;
    hitlTasksExecuted: number;
    afkTasksExecuted: number;
  };
  escalations: {
    runStatus: string;
    unresolvedRequired: number;
    operatorHigh: number;
  };
  coherence: {
    passed: boolean;
    checks: IntakeExecutionCoherenceCheck[];
  };
}

export function buildIntakeRunSummaryFields(
  intake: IntakeBrief,
  tasks: TaskSpec[],
): {
  intakeId: string;
  ambiguityScore: number;
  clarificationRequired: boolean;
  riskScore: number;
  priorityScore: number;
  highRisk: boolean;
  tasksRoutedToHitl: number;
  tasksRoutedToAfk: number;
} {
  return {
    intakeId: intake.intakeId,
    ambiguityScore: intake.ambiguity.score,
    clarificationRequired: intake.ambiguity.clarificationRequired,
    riskScore: intake.riskPriority.riskScore,
    priorityScore: intake.riskPriority.priorityScore,
    highRisk: intake.riskPriority.highRisk,
    tasksRoutedToHitl: tasks.filter((task) => task.routing?.routedMode === "HITL").length,
    tasksRoutedToAfk: tasks.filter((task) => isAfkEligible(task)).length,
  };
}

export function verifyIntakeExecutionCoherence(input: {
  intake: IntakeBrief;
  tasks: TaskSpec[];
  execution: ExecutionResult[];
  runStatus: string;
  unresolvedRequired: number;
  operatorHighEscalations: number;
}): { passed: boolean; checks: IntakeExecutionCoherenceCheck[] } {
  const checks: IntakeExecutionCoherenceCheck[] = [];

  const afkRoutedUnderHighRisk = input.intake.riskPriority.highRisk
    ? input.tasks.filter((task) => task.routing?.routedMode === "AFK")
    : [];
  checks.push({
    id: "high-risk-hitl-routing",
    passed: afkRoutedUnderHighRisk.length === 0,
    details:
      afkRoutedUnderHighRisk.length === 0
        ? "No AFK-routed tasks under high-risk intake."
        : `High-risk intake still has AFK-routed tasks: ${afkRoutedUnderHighRisk.map((task) => task.id).join(", ")}`,
  });

  const hitlTasks = input.tasks.filter((task) => task.routing?.routedMode === "HITL");
  const hitlFailed = input.execution.filter(
    (result) =>
      result.status === "failed" &&
      hitlTasks.some((task) => task.id === result.taskId),
  );
  const hitlFailuresEscalated = hitlFailed.every(
    (result) => result.escalation?.required && result.escalation.target !== "none",
  );
  checks.push({
    id: "hitl-failure-escalation",
    passed: hitlFailed.length === 0 || hitlFailuresEscalated,
    details:
      hitlFailed.length === 0
        ? "No failed HITL-routed tasks."
        : hitlFailuresEscalated
          ? "Failed HITL-routed tasks produced escalation signals."
          : "Failed HITL-routed tasks missing escalation routing.",
  });

  const executionCoverage = input.execution.length === input.tasks.length;
  checks.push({
    id: "execution-coverage",
    passed: executionCoverage,
    details: executionCoverage
      ? `Execution results captured for all ${input.tasks.length} tasks.`
      : `Execution results missing (${input.execution.length}/${input.tasks.length}).`,
  });

  const blockedWithUnresolved = input.runStatus === "blocked" && input.unresolvedRequired > 0;
  checks.push({
    id: "blocked-run-escalation-signal",
    passed: input.runStatus !== "blocked" || blockedWithUnresolved,
    details:
      input.runStatus !== "blocked"
        ? `Run status is ${input.runStatus}.`
        : blockedWithUnresolved
          ? `Blocked run has ${input.unresolvedRequired} unresolved required escalations.`
          : "Blocked run missing unresolved escalation signal.",
  });

  if (input.intake.riskPriority.highRisk && input.operatorHighEscalations === 0 && hitlTasks.length > 0) {
    checks.push({
      id: "high-risk-operator-visibility",
      passed: input.runStatus === "healthy" || input.unresolvedRequired > 0,
      details: "High-risk intake run exposes operator/planner escalation visibility when not healthy.",
    });
  }

  const passed = checks.every((check) => check.passed);
  return { passed, checks };
}

export function buildIntakeExecutionManifest(input: {
  intake: IntakeBrief;
  runId: string;
  tasks: TaskSpec[];
  execution: ExecutionResult[];
  runStatus: string;
  unresolvedRequired: number;
  operatorHighEscalations: number;
}): IntakeExecutionManifest {
  const coherence = verifyIntakeExecutionCoherence(input);
  const hitlTaskIds = input.tasks
    .filter((task) => task.routing?.routedMode === "HITL")
    .map((task) => task.id);
  const afkEligibleTaskIds = input.tasks.filter((task) => isAfkEligible(task)).map((task) => task.id);

  return {
    schemaVersion: "1.0",
    intakeId: input.intake.intakeId,
    runId: input.runId,
    generatedAt: new Date().toISOString(),
    intake: {
      ambiguityScore: input.intake.ambiguity.score,
      clarificationRequired: input.intake.ambiguity.clarificationRequired,
      riskScore: input.intake.riskPriority.riskScore,
      highRisk: input.intake.riskPriority.highRisk,
      priorityScore: input.intake.riskPriority.priorityScore,
    },
    routing: {
      tasksTotal: input.tasks.length,
      routedToHitl: hitlTaskIds.length,
      routedToAfk: afkEligibleTaskIds.length,
      hitlTaskIds,
      afkEligibleTaskIds,
    },
    execution: {
      tasksPassed: input.execution.filter((item) => item.status === "passed").length,
      tasksFailed: input.execution.filter((item) => item.status === "failed").length,
      tasksSkipped: input.execution.filter((item) => item.status === "skipped").length,
      hitlTasksExecuted: input.execution.filter((item) => hitlTaskIds.includes(item.taskId)).length,
      afkTasksExecuted: input.execution.filter((item) => afkEligibleTaskIds.includes(item.taskId)).length,
    },
    escalations: {
      runStatus: input.runStatus,
      unresolvedRequired: input.unresolvedRequired,
      operatorHigh: input.operatorHighEscalations,
    },
    coherence: coherence,
  };
}
