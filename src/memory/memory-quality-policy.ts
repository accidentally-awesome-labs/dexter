import path from "node:path";
import { z } from "zod";
import { readPolicyJson } from "../lib/read-policy-json.js";

const memoryQualityPolicySchema = z.object({
  schemaVersion: z.literal("1.0"),
  description: z.string().optional(),
  freshnessHalfLifeDays: z.number().positive(),
  minFreshnessFactor: z.number().min(0).max(1),
  staleAfterDays: z.number().positive(),
  lowConfidenceThreshold: z.number().min(0).max(1),
  maxLessonsInScorecard: z.number().int().min(1),
});

export type MemoryQualityPolicy = z.infer<typeof memoryQualityPolicySchema>;

export const DEFAULT_MEMORY_QUALITY_POLICY_PATH = path.join(
  "docs",
  "operations",
  "MEMORY_QUALITY_POLICY.json",
);

export async function loadMemoryQualityPolicy(rootDir: string): Promise<MemoryQualityPolicy> {
  return readPolicyJson(rootDir, DEFAULT_MEMORY_QUALITY_POLICY_PATH, (raw) =>
    memoryQualityPolicySchema.parse(raw),
  );
}
