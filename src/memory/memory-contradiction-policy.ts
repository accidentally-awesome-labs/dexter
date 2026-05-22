import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";

const contradictionPairSchema = z.object({
  id: z.string().min(1),
  left: z.string().min(1),
  right: z.string().min(1),
});

const memoryContradictionPolicySchema = z.object({
  schemaVersion: z.literal("1.0"),
  description: z.string().optional(),
  minTagOverlap: z.number().int().min(0).default(1),
  requireCategoryMatch: z.boolean().default(false),
  contradictionPairs: z.array(contradictionPairSchema).min(1),
  deprioritizePenaltyWeight: z.number().min(0).max(1).default(0.5),
  highSeverityThreshold: z.number().min(0).max(1).default(0.6),
});

export type MemoryContradictionPolicy = z.infer<typeof memoryContradictionPolicySchema>;

export const DEFAULT_MEMORY_CONTRADICTION_POLICY_PATH = path.join(
  "docs",
  "operations",
  "MEMORY_CONTRADICTION_POLICY.json",
);

export async function loadMemoryContradictionPolicy(rootDir: string): Promise<MemoryContradictionPolicy> {
  const raw = await fs.readJson(path.join(rootDir, DEFAULT_MEMORY_CONTRADICTION_POLICY_PATH));
  return memoryContradictionPolicySchema.parse(raw);
}
