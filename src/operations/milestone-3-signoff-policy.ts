import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";

const milestone3SignoffPolicySchema = z.object({
  schemaVersion: z.literal("1.0"),
  description: z.string().optional(),
  minConsecutiveSoakPasses: z.number().int().min(1),
  minTotalSoakCycles: z.number().int().min(1),
  requireWeeklyPassRateNonDeclining: z.boolean(),
  allowWaivedWeeklyTrend: z.boolean(),
});

export type Milestone3SignoffPolicy = z.infer<typeof milestone3SignoffPolicySchema>;

export const DEFAULT_MILESTONE_3_SIGNOFF_POLICY_PATH = path.join(
  "docs",
  "operations",
  "MILESTONE_3_SIGNOFF_POLICY.json",
);

export async function loadMilestone3SignoffPolicy(rootDir: string): Promise<Milestone3SignoffPolicy> {
  const raw = await fs.readJson(path.join(rootDir, DEFAULT_MILESTONE_3_SIGNOFF_POLICY_PATH));
  return milestone3SignoffPolicySchema.parse(raw);
}
