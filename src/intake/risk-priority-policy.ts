import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";

const riskPriorityPolicySchema = z.object({
  schemaVersion: z.literal("1.0"),
  highRiskThreshold: z.number().int().min(0).max(100),
  priorityLevels: z.record(z.string(), z.object({ minScore: z.number(), maxScore: z.number() })),
  riskLevels: z.record(z.string(), z.object({ minScore: z.number(), maxScore: z.number() })),
  dimensionWeights: z.object({
    security: z.number(),
    blastRadius: z.number(),
    complexity: z.number(),
    urgency: z.number(),
  }),
  dimensionCaps: z.object({
    security: z.number().int(),
    blastRadius: z.number().int(),
    complexity: z.number().int(),
    urgency: z.number().int(),
  }),
  signals: z.record(
    z.string(),
    z.object({
      dimension: z.enum(["security", "blastRadius", "complexity", "urgency"]),
      weight: z.number().int().min(0),
      maxHits: z.number().int().min(1).optional(),
      reason: z.string().optional(),
    }),
  ),
  securityKeywords: z.array(z.string()),
  blastRadiusKeywords: z.array(z.string()),
  complexityKeywords: z.array(z.string()),
  urgencyKeywords: z.array(z.string()),
});

export type IntakeRiskPriorityPolicy = z.infer<typeof riskPriorityPolicySchema>;

export const DEFAULT_INTAKE_RISK_PRIORITY_POLICY: IntakeRiskPriorityPolicy = {
  schemaVersion: "1.0",
  highRiskThreshold: 60,
  priorityLevels: {
    low: { minScore: 0, maxScore: 39 },
    medium: { minScore: 40, maxScore: 59 },
    high: { minScore: 60, maxScore: 79 },
    critical: { minScore: 80, maxScore: 100 },
  },
  riskLevels: {
    low: { minScore: 0, maxScore: 39 },
    medium: { minScore: 40, maxScore: 59 },
    high: { minScore: 60, maxScore: 79 },
    critical: { minScore: 80, maxScore: 100 },
  },
  dimensionWeights: {
    security: 1.5,
    blastRadius: 1.5,
    complexity: 1,
    urgency: 1.25,
  },
  dimensionCaps: {
    security: 25,
    blastRadius: 25,
    complexity: 25,
    urgency: 25,
  },
  signals: {
    "security-keywords": { dimension: "security", weight: 8, maxHits: 3 },
    "blast-radius-keywords": { dimension: "blastRadius", weight: 8, maxHits: 3 },
    "complexity-keywords": { dimension: "complexity", weight: 7, maxHits: 3 },
    "urgency-keywords": { dimension: "urgency", weight: 10, maxHits: 2 },
    "security-label": { dimension: "security", weight: 10 },
    "incident-label": { dimension: "urgency", weight: 12 },
    "high-ambiguity": { dimension: "complexity", weight: 12 },
    "missing-constraints-security-scope": { dimension: "security", weight: 10 },
    "hitl-task-mode": { dimension: "blastRadius", weight: 12 },
    "governance-nfr-tag": { dimension: "security", weight: 8 },
  },
  securityKeywords: ["security", "auth", "authentication", "authorization", "pci", "hipaa", "pii", "encryption", "secret", "oauth"],
  blastRadiusKeywords: ["production", "prod", "multi-tenant", "global", "all users", "customer-facing", "billing", "payments"],
  complexityKeywords: ["integration", "migration", "refactor", "distributed", "multi-region", "legacy"],
  urgencyKeywords: ["urgent", "asap", "outage", "incident", "blocking", "sev1", "critical bug", "hotfix"],
};

export async function loadIntakeRiskPriorityPolicy(rootDir: string): Promise<IntakeRiskPriorityPolicy> {
  const policyPath = path.join(rootDir, "docs", "operations", "INTAKE_RISK_PRIORITY_POLICY.json");
  if (!(await fs.pathExists(policyPath))) {
    return DEFAULT_INTAKE_RISK_PRIORITY_POLICY;
  }
  return riskPriorityPolicySchema.parse(await fs.readJson(policyPath));
}
