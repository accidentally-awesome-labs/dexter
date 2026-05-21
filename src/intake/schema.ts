import { z } from "zod";

export const intakeSourceTypeSchema = z.enum(["cli-prompt", "issue", "template"]);

export const intakeSourceSchema = z.object({
  type: intakeSourceTypeSchema,
  channel: z.string().min(1),
  externalId: z.string().optional(),
});

export const intakeRequestSchema = z.object({
  description: z.string().min(10),
  constraints: z.array(z.string()).default([]),
  targetUsers: z.array(z.string()).default([]),
  labels: z.array(z.string()).default([]),
  acceptanceSignals: z.array(z.string()).default([]),
});

export const intakeNormalizationSchema = z.object({
  trimmed: z.boolean(),
  dedupedConstraints: z.boolean(),
  dedupedTargetUsers: z.boolean(),
  wordCount: z.number().int().min(1),
});

export const intakeAmbiguitySignalSchema = z.object({
  id: z.string().min(1),
  weight: z.number().int().min(0),
  reason: z.string().min(3),
  hits: z.number().int().min(1).optional(),
});

const intakeRiskPriorityDimensionSchema = z.object({
  security: z.number(),
  blastRadius: z.number(),
  complexity: z.number(),
  urgency: z.number(),
});

export const intakeRiskPrioritySignalSchema = z.object({
  id: z.string().min(1),
  dimension: z.enum(["security", "blastRadius", "complexity", "urgency"]),
  weight: z.number().int().min(0),
  reason: z.string().min(3),
  hits: z.number().int().min(1).optional(),
});

export const intakeRiskPrioritySchema = z.object({
  riskScore: z.number().int().min(0).max(100),
  priorityScore: z.number().int().min(0).max(100),
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
  priorityLevel: z.enum(["low", "medium", "high", "critical"]),
  highRisk: z.boolean(),
  threshold: z.number().int().min(0).max(100),
  dimensions: intakeRiskPriorityDimensionSchema,
  signals: z.array(intakeRiskPrioritySignalSchema),
});

export const intakeAmbiguitySchema = z.object({
  score: z.number().int().min(0).max(100),
  level: z.enum(["low", "medium", "high"]),
  clarificationRequired: z.boolean(),
  threshold: z.number().int().min(0).max(100),
  signals: z.array(intakeAmbiguitySignalSchema),
});

export const intakeBriefSchema = z.object({
  schemaVersion: z.literal("1.0"),
  intakeId: z.string().uuid(),
  generatedAt: z.string().datetime(),
  source: intakeSourceSchema,
  project: z.string().min(2),
  title: z.string().min(3),
  summary: z.string().min(10),
  request: intakeRequestSchema,
  normalization: intakeNormalizationSchema,
  ambiguity: intakeAmbiguitySchema,
  riskPriority: intakeRiskPrioritySchema,
});

export type IntakeSourceType = z.infer<typeof intakeSourceTypeSchema>;
export type IntakeAmbiguitySignal = z.infer<typeof intakeAmbiguitySignalSchema>;
export type IntakeAmbiguity = z.infer<typeof intakeAmbiguitySchema>;
export type IntakeRiskPriority = z.infer<typeof intakeRiskPrioritySchema>;
export type IntakeBrief = z.infer<typeof intakeBriefSchema>;

export function validateIntakeBrief(value: unknown): IntakeBrief {
  return intakeBriefSchema.parse(value);
}
