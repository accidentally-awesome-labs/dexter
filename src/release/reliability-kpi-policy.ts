import path from "node:path";
import { z } from "zod";
import { readPolicyJson } from "../lib/read-policy-json.js";

const reliabilityKpiPolicySchema = z.object({
  schemaVersion: z.literal("1.0"),
  description: z.string().optional(),
  rolling100MinPassRate: z.number().min(0).max(1),
  maxSoakRepeatFailureRate: z.number().min(0).max(1),
  maxRunRepeatFailureRate: z.number().min(0).max(1),
  topFailureClassCount: z.number().int().min(1).max(10),
  severityToPriority: z.object({
    critical: z.enum(["P0", "P1", "P2"]),
    high: z.enum(["P0", "P1", "P2"]),
    medium: z.enum(["P0", "P1", "P2"]),
    low: z.enum(["P0", "P1", "P2"]),
  }),
  mitigationOwners: z.record(z.string(), z.enum(["operator", "planner", "platform"])),
});

export type ReliabilityKpiPolicy = z.infer<typeof reliabilityKpiPolicySchema>;
export type MitigationPriority = "P0" | "P1" | "P2";
export type MitigationOwner = "operator" | "planner" | "platform";

export const DEFAULT_RELIABILITY_KPI_POLICY_PATH = path.join(
  "docs",
  "operations",
  "RELIABILITY_KPI_POLICY.json",
);

export async function loadReliabilityKpiPolicy(rootDir: string): Promise<ReliabilityKpiPolicy> {
  return readPolicyJson(rootDir, DEFAULT_RELIABILITY_KPI_POLICY_PATH, (raw) =>
    reliabilityKpiPolicySchema.parse(raw),
  );
}
