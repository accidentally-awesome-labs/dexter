import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";

const modeRoutingPolicySchema = z.object({
  schemaVersion: z.literal("1.0"),
  forceHitlWhenIntakeHighRisk: z.boolean(),
  forceHitlWhenTaskHighRisk: z.boolean(),
  forceHitlRiskLevels: z.array(z.enum(["low", "medium", "high", "critical"])),
  alwaysHitlTaskIds: z.array(z.string()),
  alwaysHitlNfrTags: z.array(z.string()),
  preserveExplicitHitl: z.boolean(),
  lowRiskMaxScore: z.number().int().min(0).max(100),
});

export type IntakeModeRoutingPolicy = z.infer<typeof modeRoutingPolicySchema>;

export const DEFAULT_INTAKE_MODE_ROUTING_POLICY: IntakeModeRoutingPolicy = {
  schemaVersion: "1.0",
  forceHitlWhenIntakeHighRisk: true,
  forceHitlWhenTaskHighRisk: true,
  forceHitlRiskLevels: ["high", "critical"],
  alwaysHitlTaskIds: ["t3-policy"],
  alwaysHitlNfrTags: ["governance"],
  preserveExplicitHitl: true,
  lowRiskMaxScore: 39,
};

export async function loadIntakeModeRoutingPolicy(rootDir: string): Promise<IntakeModeRoutingPolicy> {
  const policyPath = path.join(rootDir, "docs", "operations", "INTAKE_MODE_ROUTING_POLICY.json");
  if (!(await fs.pathExists(policyPath))) {
    return DEFAULT_INTAKE_MODE_ROUTING_POLICY;
  }
  return modeRoutingPolicySchema.parse(await fs.readJson(policyPath));
}
