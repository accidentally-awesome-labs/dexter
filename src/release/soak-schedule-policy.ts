import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";

const warningThresholdsSchema = z.object({
  rolling100PassRateDropMin: z.number().min(0).max(1),
  rolling100PassRateFloor: z.number().min(0).max(1),
  consecutiveFailuresWarn: z.number().int().min(1),
  consecutiveFailuresCritical: z.number().int().min(1),
  avgDurationIncreasePct: z.number().min(0).max(5),
  dailyPassRateDropMin: z.number().min(0).max(1),
  stepFailureSpikeMin: z.number().int().min(1),
});

const soakSchedulePolicySchema = z.object({
  schemaVersion: z.literal("1.0"),
  description: z.string().optional(),
  enabled: z.boolean(),
  intervalMinutes: z.number().int().min(15),
  minGapMinutes: z.number().int().min(0),
  enforceGateOnScheduledRun: z.boolean(),
  targetStreak: z.number().int().min(1),
  warningThresholds: warningThresholdsSchema,
  automation: z.object({
    githubActionsCron: z.string().min(1),
    localCronExample: z.string().min(1),
  }),
});

export type SoakSchedulePolicy = z.infer<typeof soakSchedulePolicySchema>;
export type SoakWarningThresholds = z.infer<typeof warningThresholdsSchema>;

export const DEFAULT_SOAK_SCHEDULE_POLICY_PATH = path.join("docs", "operations", "SOAK_SCHEDULE_POLICY.json");

export async function loadSoakSchedulePolicy(rootDir: string): Promise<SoakSchedulePolicy> {
  const raw = await fs.readJson(path.join(rootDir, DEFAULT_SOAK_SCHEDULE_POLICY_PATH));
  return soakSchedulePolicySchema.parse(raw);
}
