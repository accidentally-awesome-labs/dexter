import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";

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
  const raw = await fs.readJson(path.join(rootDir, DEFAULT_MEMORY_QUALITY_POLICY_PATH));
  return memoryQualityPolicySchema.parse(raw);
}
