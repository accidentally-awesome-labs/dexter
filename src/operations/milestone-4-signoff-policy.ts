import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";

const milestone4SignoffPolicySchema = z.object({
  schemaVersion: z.literal("1.0"),
  description: z.string().optional(),
  maxDiagnosisDurationMs: z.number().int().positive(),
  minimumPromotionsForGovernance: z.number().int().min(0),
  requiredAlertRuleIds: z.array(z.string().min(1)),
  requiredRunbookKeys: z.array(z.string().min(1)),
});

export type Milestone4SignoffPolicy = z.infer<typeof milestone4SignoffPolicySchema>;

export const DEFAULT_MILESTONE_4_SIGNOFF_POLICY_PATH = path.join(
  "docs",
  "operations",
  "MILESTONE_4_SIGNOFF_POLICY.json",
);

export async function loadMilestone4SignoffPolicy(rootDir: string): Promise<Milestone4SignoffPolicy> {
  const raw = await fs.readJson(path.join(rootDir, DEFAULT_MILESTONE_4_SIGNOFF_POLICY_PATH));
  return milestone4SignoffPolicySchema.parse(raw);
}
