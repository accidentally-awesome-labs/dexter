import type { RiskLevel, TaskSpec } from "../protocols/types.js";
import type { IntakeBriefCore, IntakeBriefWithAmbiguity } from "./ambiguity.js";
import type { IntakeBrief } from "./schema.js";
import {
  DEFAULT_INTAKE_RISK_PRIORITY_POLICY,
  type IntakeRiskPriorityPolicy,
} from "./risk-priority-policy.js";

export interface RiskPriorityDimensions {
  security: number;
  blastRadius: number;
  complexity: number;
  urgency: number;
}

export interface RiskPrioritySignal {
  id: string;
  dimension: keyof RiskPriorityDimensions;
  weight: number;
  reason: string;
  hits?: number;
}

export interface RiskPriorityProfile {
  riskScore: number;
  priorityScore: number;
  riskLevel: RiskLevel;
  priorityLevel: "low" | "medium" | "high" | "critical";
  highRisk: boolean;
  threshold: number;
  dimensions: RiskPriorityDimensions;
  signals: RiskPrioritySignal[];
}

type ScoreLevel = "low" | "medium" | "high" | "critical";

function countKeywordHits(text: string, keywords: string[]): number {
  const normalized = text.toLowerCase();
  let hits = 0;
  for (const keyword of keywords) {
    if (normalized.includes(keyword.toLowerCase())) {
      hits += 1;
    }
  }
  return hits;
}

function capDimension(value: number, cap: number): number {
  return Math.min(cap, value);
}

function resolveScoreLevel(
  score: number,
  levels: IntakeRiskPriorityPolicy["riskLevels"],
): ScoreLevel {
  if (score >= levels.critical.minScore) {
    return "critical";
  }
  if (score >= levels.high.minScore) {
    return "high";
  }
  if (score >= levels.medium.minScore) {
    return "medium";
  }
  return "low";
}

function toRiskLevel(level: ScoreLevel): RiskLevel {
  return level;
}

function addDimensionSignal(
  signals: RiskPrioritySignal[],
  dimensions: RiskPriorityDimensions,
  policy: IntakeRiskPriorityPolicy,
  id: string,
  hits: number,
): void {
  const signal = policy.signals[id];
  if (!signal || hits <= 0) {
    return;
  }
  const cappedHits = Math.min(hits, signal.maxHits ?? hits);
  const weight = signal.weight * cappedHits;
  dimensions[signal.dimension] += weight;
  signals.push({
    id,
    dimension: signal.dimension,
    weight,
    reason: signal.reason ?? `Triggered ${id}`,
    hits: cappedHits,
  });
}

function finalizeDimensions(
  dimensions: RiskPriorityDimensions,
  policy: IntakeRiskPriorityPolicy,
): RiskPriorityDimensions {
  return {
    security: capDimension(dimensions.security, policy.dimensionCaps.security),
    blastRadius: capDimension(dimensions.blastRadius, policy.dimensionCaps.blastRadius),
    complexity: capDimension(dimensions.complexity, policy.dimensionCaps.complexity),
    urgency: capDimension(dimensions.urgency, policy.dimensionCaps.urgency),
  };
}

function weightedScore(dimensions: RiskPriorityDimensions, policy: IntakeRiskPriorityPolicy): number {
  const total =
    dimensions.security * policy.dimensionWeights.security +
    dimensions.blastRadius * policy.dimensionWeights.blastRadius +
    dimensions.complexity * policy.dimensionWeights.complexity +
    dimensions.urgency * policy.dimensionWeights.urgency;
  const maxTotal =
    policy.dimensionCaps.security * policy.dimensionWeights.security +
    policy.dimensionCaps.blastRadius * policy.dimensionWeights.blastRadius +
    policy.dimensionCaps.complexity * policy.dimensionWeights.complexity +
    policy.dimensionCaps.urgency * policy.dimensionWeights.urgency;
  return Math.min(100, Math.round((total / maxTotal) * 100));
}

function buildProfile(
  dimensions: RiskPriorityDimensions,
  signals: RiskPrioritySignal[],
  policy: IntakeRiskPriorityPolicy,
): RiskPriorityProfile {
  const finalized = finalizeDimensions(dimensions, policy);
  const riskScore = weightedScore(finalized, policy);
  const priorityScore = Math.min(
    100,
    Math.round(finalized.urgency * policy.dimensionWeights.urgency * 2 + finalized.security * 1.2),
  );
  const riskLevel = toRiskLevel(resolveScoreLevel(riskScore, policy.riskLevels));
  const priorityLevel = resolveScoreLevel(priorityScore, policy.priorityLevels);
  const sortedSignals = [...signals].sort((left, right) => left.id.localeCompare(right.id));

  return {
    riskScore,
    priorityScore,
    riskLevel,
    priorityLevel,
    highRisk: riskScore >= policy.highRiskThreshold,
    threshold: policy.highRiskThreshold,
    dimensions: finalized,
    signals: sortedSignals,
  };
}

export function scoreIntakeRiskPriority(
  brief: IntakeBrief | IntakeBriefCore | IntakeBriefWithAmbiguity,
  policy: IntakeRiskPriorityPolicy = DEFAULT_INTAKE_RISK_PRIORITY_POLICY,
): RiskPriorityProfile {
  const signals: RiskPrioritySignal[] = [];
  const dimensions: RiskPriorityDimensions = {
    security: 0,
    blastRadius: 0,
    complexity: 0,
    urgency: 0,
  };
  const text = [
    brief.request.description,
    brief.summary,
    ...brief.request.constraints,
    ...brief.request.labels,
  ].join(" ");

  addDimensionSignal(
    signals,
    dimensions,
    policy,
    "security-keywords",
    countKeywordHits(text, policy.securityKeywords),
  );
  addDimensionSignal(
    signals,
    dimensions,
    policy,
    "blast-radius-keywords",
    countKeywordHits(text, policy.blastRadiusKeywords),
  );
  addDimensionSignal(
    signals,
    dimensions,
    policy,
    "complexity-keywords",
    countKeywordHits(text, policy.complexityKeywords),
  );
  addDimensionSignal(
    signals,
    dimensions,
    policy,
    "urgency-keywords",
    countKeywordHits(text, policy.urgencyKeywords),
  );

  if (brief.request.labels.some((label) => label.toLowerCase().includes("security"))) {
    addDimensionSignal(signals, dimensions, policy, "security-label", 1);
  }
  if (brief.request.labels.some((label) => ["incident", "outage", "hotfix"].includes(label.toLowerCase()))) {
    addDimensionSignal(signals, dimensions, policy, "incident-label", 1);
  }

  if ("ambiguity" in brief && brief.ambiguity.level === "high") {
    addDimensionSignal(signals, dimensions, policy, "high-ambiguity", 1);
  }

  if (
    brief.request.constraints.length === 0 &&
    countKeywordHits(text, policy.securityKeywords) > 0
  ) {
    addDimensionSignal(signals, dimensions, policy, "missing-constraints-security-scope", 1);
  }

  return buildProfile(dimensions, signals, policy);
}

export function scoreTaskRiskPriority(
  brief: IntakeBrief | IntakeBriefCore | IntakeBriefWithAmbiguity,
  task: TaskSpec,
  policy: IntakeRiskPriorityPolicy = DEFAULT_INTAKE_RISK_PRIORITY_POLICY,
): RiskPriorityProfile {
  const base = scoreIntakeRiskPriority(brief, policy);
  const signals = [...base.signals];
  const dimensions = { ...base.dimensions };

  if (task.mode === "HITL") {
    addDimensionSignal(signals, dimensions, policy, "hitl-task-mode", 1);
  }
  if (task.nfrTags.some((tag) => tag.toLowerCase() === "governance")) {
    addDimensionSignal(signals, dimensions, policy, "governance-nfr-tag", 1);
  }
  if (task.nfrTags.some((tag) => tag.toLowerCase() === "security")) {
    addDimensionSignal(signals, dimensions, policy, "security-label", 1);
  }

  return buildProfile(dimensions, signals, policy);
}

export function enrichTaskGraphWithRiskPriority(
  brief: IntakeBrief | IntakeBriefCore | IntakeBriefWithAmbiguity,
  tasks: TaskSpec[],
  policy: IntakeRiskPriorityPolicy = DEFAULT_INTAKE_RISK_PRIORITY_POLICY,
): TaskSpec[] {
  return tasks.map((task) => ({
    ...task,
    riskPriority: scoreTaskRiskPriority(brief, task, policy),
  }));
}

export function attachIntakeRiskPriority(
  brief: IntakeBriefWithAmbiguity | IntakeBrief,
  policy: IntakeRiskPriorityPolicy = DEFAULT_INTAKE_RISK_PRIORITY_POLICY,
): IntakeBrief {
  return {
    ...brief,
    riskPriority: scoreIntakeRiskPriority(brief, policy),
  };
}
