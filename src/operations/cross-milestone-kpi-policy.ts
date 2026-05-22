import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";

const crossMilestoneKpiPolicySchema = z.object({
  schemaVersion: z.literal("1.0"),
  description: z.string().optional(),
  targets: z.object({
    autonomyRateMin: z.number().min(0).max(1),
    reliabilitySuccessRateMin: z.number().min(0).max(1),
    safetyPromotionComplianceMin: z.number().min(0).max(1),
    governanceWaiverComplianceMin: z.number().min(0).max(1),
    blockedRunMttrMaxMs: z.number().int().positive(),
  }),
  measurement: z.object({
    reliabilityWindowRuns: z.number().int().positive(),
    minReliabilitySamples: z.number().int().positive(),
    minBlockedRecoverySamples: z.number().int().min(0),
    allowSoakFallbackForReliability: z.boolean(),
  }),
});

export type CrossMilestoneKpiPolicy = z.infer<typeof crossMilestoneKpiPolicySchema>;

export const DEFAULT_CROSS_MILESTONE_KPI_POLICY_PATH = path.join(
  "docs",
  "operations",
  "CROSS_MILESTONE_KPI_POLICY.json",
);

export async function loadCrossMilestoneKpiPolicy(rootDir: string): Promise<CrossMilestoneKpiPolicy> {
  const raw = await fs.readJson(path.join(rootDir, DEFAULT_CROSS_MILESTONE_KPI_POLICY_PATH));
  return crossMilestoneKpiPolicySchema.parse(raw);
}
