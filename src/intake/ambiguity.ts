import {
  DEFAULT_INTAKE_AMBIGUITY_POLICY,
  loadIntakeAmbiguityPolicy,
  type IntakeAmbiguityPolicy,
} from "./ambiguity-policy.js";
import type { IntakeAmbiguity, IntakeAmbiguitySignal, IntakeBrief } from "./schema.js";

export type IntakeBriefCore = Omit<IntakeBrief, "ambiguity" | "riskPriority">;
export type IntakeBriefWithAmbiguity = IntakeBriefCore & { ambiguity: IntakeAmbiguity };

function countWordMatches(text: string, phrases: string[]): number {
  const normalized = text.toLowerCase();
  let hits = 0;
  for (const phrase of phrases) {
    const pattern = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    const matches = normalized.match(pattern);
    if (matches) {
      hits += matches.length;
    }
  }
  return hits;
}

function hasRiskScope(text: string, keywords: string[]): boolean {
  const normalized = text.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword));
}

function hasConflictingConstraints(constraints: string[], policy: IntakeAmbiguityPolicy): boolean {
  const normalized = constraints.map((item) => item.toLowerCase());
  return policy.constraintConflicts.some((pair) => {
    const hasLeft = normalized.some((item) => item.includes(pair.left));
    const hasRight = normalized.some((item) => item.includes(pair.right));
    return hasLeft && hasRight;
  });
}

function resolveLevel(score: number, policy: IntakeAmbiguityPolicy): IntakeAmbiguity["level"] {
  if (score >= policy.levels.high.minScore) {
    return "high";
  }
  if (score >= policy.levels.medium.minScore) {
    return "medium";
  }
  return "low";
}

function pushSignal(
  signals: IntakeAmbiguitySignal[],
  id: string,
  weight: number,
  reason: string,
  hits = 1,
): void {
  signals.push({ id, weight, reason, hits });
}

export function scoreIntakeAmbiguity(brief: IntakeBriefCore, policy: IntakeAmbiguityPolicy): IntakeAmbiguity {
  const signals: IntakeAmbiguitySignal[] = [];
  const description = brief.request.description.toLowerCase();
  const wordCount = brief.normalization.wordCount;

  if (brief.request.targetUsers.length === 0) {
    const signal = policy.signals["missing-target-users"];
    pushSignal(signals, "missing-target-users", signal.weight, signal.reason);
  }

  if (
    brief.request.constraints.length === 0 &&
    hasRiskScope(description, policy.riskScopeKeywords)
  ) {
    const signal = policy.signals["missing-constraints-for-risky-scope"];
    pushSignal(signals, "missing-constraints-for-risky-scope", signal.weight, signal.reason);
  }

  if (wordCount < 20) {
    const signal = policy.signals["short-description"];
    pushSignal(signals, "short-description", signal.weight, signal.reason);
  } else if (wordCount < 40) {
    const signal = policy.signals["medium-description"];
    pushSignal(signals, "medium-description", signal.weight, signal.reason);
  }

  const vagueHits = countWordMatches(description, policy.vaguePhrases);
  if (vagueHits > 0) {
    const signal = policy.signals["vague-language"];
    const cappedHits = Math.min(vagueHits, signal.maxHits ?? vagueHits);
    pushSignal(
      signals,
      "vague-language",
      signal.weight * cappedHits,
      signal.reason,
      cappedHits,
    );
  }

  const placeholderHits = countWordMatches(description, ["tbd", "todo", "fixme", "???"]);
  if (placeholderHits > 0) {
    const signal = policy.signals["placeholder-tokens"];
    pushSignal(signals, "placeholder-tokens", signal.weight, signal.reason, placeholderHits);
  }

  if (hasConflictingConstraints(brief.request.constraints, policy)) {
    const signal = policy.signals["conflicting-constraints"];
    pushSignal(signals, "conflicting-constraints", signal.weight, signal.reason);
  }

  if (
    brief.request.acceptanceSignals.length === 0 &&
    hasRiskScope(description, policy.complexityKeywords)
  ) {
    const signal = policy.signals["missing-acceptance-signals"];
    pushSignal(signals, "missing-acceptance-signals", signal.weight, signal.reason);
  }

  const questionHits = (brief.request.description.match(/\?/g) ?? []).length;
  if (questionHits > 0) {
    const signal = policy.signals["open-questions"];
    const cappedHits = Math.min(questionHits, signal.maxHits ?? questionHits);
    pushSignal(signals, "open-questions", signal.weight * cappedHits, signal.reason, cappedHits);
  }

  const sortedSignals = [...signals].sort((left, right) => left.id.localeCompare(right.id));
  const rawScore = sortedSignals.reduce((sum, signal) => sum + signal.weight, 0);
  const score = Math.min(100, rawScore);
  const level = resolveLevel(score, policy);

  return {
    score,
    level,
    clarificationRequired: score >= policy.clarificationThreshold,
    threshold: policy.clarificationThreshold,
    signals: sortedSignals,
  };
}

export function attachIntakeAmbiguity(
  brief: IntakeBriefCore | IntakeBrief,
  policy: IntakeAmbiguityPolicy = DEFAULT_INTAKE_AMBIGUITY_POLICY,
): IntakeBriefWithAmbiguity {
  const core: IntakeBriefCore =
    "ambiguity" in brief
      ? (({ ambiguity: _ignored, riskPriority: _riskIgnored, ...rest }) => rest)(brief)
      : "riskPriority" in brief
        ? (({ riskPriority: _riskIgnored, ...rest }) => rest)(brief as IntakeBrief)
        : brief;
  return {
    ...core,
    ambiguity: scoreIntakeAmbiguity(core, policy),
  };
}

export async function attachIntakeAmbiguityFromPolicyFile(
  rootDir: string,
  brief: IntakeBriefCore,
): Promise<IntakeBriefWithAmbiguity> {
  const policy = await loadIntakeAmbiguityPolicy(rootDir);
  return attachIntakeAmbiguity(brief, policy);
}

export function shouldRequireClarification(ambiguity: IntakeAmbiguity): boolean {
  return ambiguity.clarificationRequired;
}
