import type { TaskMode, TaskSpec } from "../protocols/types.js";
import type { IntakeBrief } from "./schema.js";
import {
  DEFAULT_INTAKE_MODE_ROUTING_POLICY,
  type IntakeModeRoutingPolicy,
} from "./mode-routing-policy.js";

export interface TaskExecutionRouting {
  originalMode: TaskMode;
  routedMode: TaskMode;
  reason: string;
  policyVersion: string;
}

export interface ModeRoutingSummary {
  policyVersion: string;
  intakeHighRisk: boolean;
  routedToHitl: number;
  remainedAfk: number;
  tasks: Array<{ taskId: string; originalMode: TaskMode; routedMode: TaskMode; reason: string }>;
}

function isHighRiskLevel(level: string, policy: IntakeModeRoutingPolicy): boolean {
  return policy.forceHitlRiskLevels.includes(level as "low" | "medium" | "high" | "critical");
}

function shouldForceHitl(
  task: TaskSpec,
  brief: IntakeBrief | undefined,
  policy: IntakeModeRoutingPolicy,
): { force: boolean; reason: string } {
  if (policy.alwaysHitlTaskIds.includes(task.id)) {
    return { force: true, reason: "always-hitl-task-id" };
  }
  if (task.nfrTags.some((tag) => policy.alwaysHitlNfrTags.includes(tag.toLowerCase()))) {
    return { force: true, reason: "always-hitl-nfr-tag" };
  }
  if (policy.forceHitlWhenIntakeHighRisk && brief?.riskPriority.highRisk) {
    return { force: true, reason: "intake-high-risk" };
  }
  if (policy.forceHitlWhenTaskHighRisk && task.riskPriority?.highRisk) {
    return { force: true, reason: "task-high-risk" };
  }
  if (task.riskPriority && isHighRiskLevel(task.riskPriority.riskLevel, policy)) {
    return { force: true, reason: `task-risk-level-${task.riskPriority.riskLevel}` };
  }
  if (brief && isHighRiskLevel(brief.riskPriority.riskLevel, policy)) {
    return { force: true, reason: `intake-risk-level-${brief.riskPriority.riskLevel}` };
  }
  return { force: false, reason: "low-risk-afk-eligible" };
}

function toHitlTask(task: TaskSpec, reason: string, policy: IntakeModeRoutingPolicy): TaskSpec {
  const originalMode = task.mode;
  return {
    ...task,
    mode: "HITL",
    commands: [],
    acceptanceChecks: undefined,
    maxAttempts: undefined,
    routing: {
      originalMode,
      routedMode: "HITL",
      reason,
      policyVersion: policy.schemaVersion,
    },
  };
}

function withAfkRouting(task: TaskSpec, policy: IntakeModeRoutingPolicy): TaskSpec {
  return {
    ...task,
    routing: {
      originalMode: task.mode,
      routedMode: "AFK",
      reason: "low-risk-afk-eligible",
      policyVersion: policy.schemaVersion,
    },
  };
}

export function routeTaskExecutionMode(
  task: TaskSpec,
  brief: IntakeBrief | undefined,
  policy: IntakeModeRoutingPolicy = DEFAULT_INTAKE_MODE_ROUTING_POLICY,
): TaskSpec {
  if (task.mode === "HITL" && policy.preserveExplicitHitl) {
    return {
      ...task,
      routing: {
        originalMode: "HITL",
        routedMode: "HITL",
        reason: "explicit-hitl",
        policyVersion: policy.schemaVersion,
      },
    };
  }

  const decision = shouldForceHitl(task, brief, policy);
  if (decision.force) {
    return toHitlTask(task, decision.reason, policy);
  }

  if (task.mode === "AFK") {
    return withAfkRouting(task, policy);
  }

  return {
    ...task,
    routing: {
      originalMode: task.mode,
      routedMode: task.mode,
      reason: decision.reason,
      policyVersion: policy.schemaVersion,
    },
  };
}

export function applyExecutionModeRouting(
  brief: IntakeBrief | undefined,
  tasks: TaskSpec[],
  policy: IntakeModeRoutingPolicy = DEFAULT_INTAKE_MODE_ROUTING_POLICY,
): { tasks: TaskSpec[]; summary: ModeRoutingSummary } {
  const routed = tasks.map((task) => routeTaskExecutionMode(task, brief, policy));
  const summary: ModeRoutingSummary = {
    policyVersion: policy.schemaVersion,
    intakeHighRisk: brief?.riskPriority.highRisk ?? false,
    routedToHitl: routed.filter((task) => task.routing?.routedMode === "HITL").length,
    remainedAfk: routed.filter((task) => task.routing?.routedMode === "AFK").length,
    tasks: routed.map((task) => ({
      taskId: task.id,
      originalMode: task.routing?.originalMode ?? task.mode,
      routedMode: task.routing?.routedMode ?? task.mode,
      reason: task.routing?.reason ?? "unknown",
    })),
  };
  return { tasks: routed, summary };
}

export function isAfkEligible(task: TaskSpec): boolean {
  return task.routing?.routedMode === "AFK" || (task.mode === "AFK" && !task.routing);
}
