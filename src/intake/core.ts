import { randomUUID } from "node:crypto";
import { attachIntakeAmbiguity } from "./ambiguity.js";
import { attachIntakeRiskPriority } from "./risk-priority.js";
import type { IntakeAmbiguityPolicy } from "./ambiguity-policy.js";
import { DEFAULT_INTAKE_AMBIGUITY_POLICY } from "./ambiguity-policy.js";
import type { IntakeBriefCore } from "./ambiguity.js";
import { intakeBriefSchema, type IntakeBrief, type IntakeSourceType } from "./schema.js";

export function trim(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeDescription(value: string): string {
  return value
    .trim()
    .split("\n")
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .join("\n\n");
}

export function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const raw of values) {
    const normalized = trim(raw);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

export function deriveTitle(description: string): string {
  const firstSentence = description.split(/[.!?\n]/)[0]?.trim() ?? description;
  if (firstSentence.length <= 120) {
    return firstSentence;
  }
  return `${firstSentence.slice(0, 117).trim()}...`;
}

export function deriveSummary(description: string, constraints: string[], targetUsers: string[]): string {
  const constraintText =
    constraints.length > 0 ? ` Constraints: ${constraints.join("; ")}.` : "";
  const audienceText = targetUsers.length > 0 ? ` Target users: ${targetUsers.join(", ")}.` : "";
  return `${description}${constraintText}${audienceText}`.trim();
}

export interface CanonicalIntakeRequest {
  project: string;
  description: string;
  constraints: string[];
  targetUsers: string[];
  labels: string[];
  acceptanceSignals: string[];
}

export interface BuildIntakeBriefInput {
  request: CanonicalIntakeRequest;
  sourceType: IntakeSourceType;
  channel: string;
  externalId?: string;
  rawDescription?: string;
  rawConstraints?: string[];
  rawTargetUsers?: string[];
}

export function buildIntakeBrief(
  input: BuildIntakeBriefInput,
  policy: IntakeAmbiguityPolicy = DEFAULT_INTAKE_AMBIGUITY_POLICY,
): IntakeBrief {
  const description = normalizeDescription(input.request.description);
  const constraints = dedupe(input.request.constraints);
  const targetUsers = dedupe(input.request.targetUsers);
  const labels = dedupe(input.request.labels);
  const acceptanceSignals = dedupe(input.request.acceptanceSignals);
  const rawConstraints = input.rawConstraints ?? input.request.constraints;
  const rawTargetUsers = input.rawTargetUsers ?? input.request.targetUsers;
  const rawDescription = input.rawDescription ?? input.request.description;

  const brief: IntakeBriefCore = {
    schemaVersion: "1.0",
    intakeId: randomUUID(),
    generatedAt: new Date().toISOString(),
    source: {
      type: input.sourceType,
      channel: input.channel,
      externalId: input.externalId,
    },
    project: trim(input.request.project),
    title: deriveTitle(description),
    summary: deriveSummary(description, constraints, targetUsers),
    request: {
      description,
      constraints,
      targetUsers,
      labels,
      acceptanceSignals,
    },
    normalization: {
      trimmed:
        description !== normalizeDescription(rawDescription) ||
        rawConstraints.some((item) => item !== trim(item)) ||
        rawTargetUsers.some((item) => item !== trim(item)),
      dedupedConstraints: rawConstraints.length !== constraints.length,
      dedupedTargetUsers: rawTargetUsers.length !== targetUsers.length,
      wordCount: description.split(/\s+/).filter(Boolean).length,
    },
  };

  const withAmbiguity = attachIntakeAmbiguity(brief, policy);
  return intakeBriefSchema.parse(attachIntakeRiskPriority(withAmbiguity));
}
