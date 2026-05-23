import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";

const ambiguityPolicySchema = z.object({
  schemaVersion: z.literal("1.0"),
  clarificationThreshold: z.number().int().min(0).max(100),
  levels: z.object({
    low: z.object({ minScore: z.number(), maxScore: z.number() }),
    medium: z.object({ minScore: z.number(), maxScore: z.number() }),
    high: z.object({ minScore: z.number(), maxScore: z.number() }),
  }),
  signals: z.record(
    z.string(),
    z.object({
      weight: z.number().int().min(0),
      reason: z.string(),
      maxHits: z.number().int().min(1).optional(),
    }),
  ),
  riskScopeKeywords: z.array(z.string()),
  complexityKeywords: z.array(z.string()),
  vaguePhrases: z.array(z.string()),
  constraintConflicts: z.array(
    z.object({
      left: z.string(),
      right: z.string(),
    }),
  ),
});

export type IntakeAmbiguityPolicy = z.infer<typeof ambiguityPolicySchema>;

export const DEFAULT_INTAKE_AMBIGUITY_POLICY: IntakeAmbiguityPolicy = {
  schemaVersion: "1.0",
  clarificationThreshold: 50,
  levels: {
    low: { minScore: 0, maxScore: 24 },
    medium: { minScore: 25, maxScore: 49 },
    high: { minScore: 50, maxScore: 100 },
  },
  signals: {
    "missing-target-users": { weight: 15, reason: "No target users specified" },
    "missing-constraints-for-risky-scope": {
      weight: 20,
      reason: "Risky scope keywords without constraints",
    },
    "short-description": { weight: 25, reason: "Description has fewer than 20 words" },
    "medium-description": { weight: 15, reason: "Description has fewer than 40 words" },
    "vague-language": { weight: 10, maxHits: 3, reason: "Vague or unresolved language detected" },
    "placeholder-tokens": { weight: 15, reason: "Placeholder tokens detected (TODO/TBD/FIXME)" },
    "conflicting-constraints": { weight: 25, reason: "Constraints contain conflicting directives" },
    "missing-acceptance-signals": {
      weight: 10,
      reason: "No acceptance signals for complex request",
    },
    "open-questions": { weight: 5, maxHits: 3, reason: "Open questions detected in description" },
  },
  riskScopeKeywords: ["security", "compliance", "production", "pii", "pci", "hipaa", "auth"],
  complexityKeywords: ["integration", "migration", "refactor", "multi-tenant", "distributed"],
  vaguePhrases: ["tbd", "todo", "fixme", "maybe", "perhaps", "somehow", "something", "whatever", "unsure", "unclear", "later"],
  constraintConflicts: [
    { left: "no-auth", right: "auth" },
    { left: "no authentication", right: "authentication" },
    { left: "sync only", right: "async" },
    { left: "no database", right: "database" },
  ],
};

export async function loadIntakeAmbiguityPolicy(rootDir: string): Promise<IntakeAmbiguityPolicy> {
  const policyPath = path.join(rootDir, "docs", "operations", "INTAKE_AMBIGUITY_POLICY.json");
  if (!(await fs.pathExists(policyPath))) {
    return DEFAULT_INTAKE_AMBIGUITY_POLICY;
  }
  const raw = await fs.readJson(policyPath);
  return ambiguityPolicySchema.parse(raw);
}
