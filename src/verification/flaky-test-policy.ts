import path from "node:path";
import { z } from "zod";
import { readPolicyJson } from "../lib/read-policy-json.js";

const flakyTestPolicySchema = z.object({
  schemaVersion: z.literal("1.0"),
  description: z.string().optional(),
  minObservations: z.number().int().min(2),
  minPasses: z.number().int().min(1),
  minFails: z.number().int().min(1),
  minFlipRate: z.number().min(0).max(1),
  highConfidenceThreshold: z.number().min(0).max(1),
  maxRunsRetained: z.number().int().min(10),
  stablePassRateThreshold: z.number().min(0).max(1),
});

export type FlakyTestPolicy = z.infer<typeof flakyTestPolicySchema>;

export const DEFAULT_FLAKY_TEST_POLICY_PATH = path.join("docs", "operations", "FLAKY_TEST_POLICY.json");

export async function loadFlakyTestPolicy(rootDir: string): Promise<FlakyTestPolicy> {
  return readPolicyJson(rootDir, DEFAULT_FLAKY_TEST_POLICY_PATH, (raw) => flakyTestPolicySchema.parse(raw));
}
