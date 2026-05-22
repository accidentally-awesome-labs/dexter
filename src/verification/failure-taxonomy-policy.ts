import path from "node:path";
import { z } from "zod";
import { readPolicyJson } from "../lib/read-policy-json.js";

const failureClassSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  severity: z.enum(["low", "medium", "high", "critical"]),
});

const mappingRuleSchema = z.object({
  id: z.string().min(1),
  class: z.string().min(1),
  source: z.string().min(1),
  signalIncludes: z.array(z.string()).default([]),
});

const policySchema = z.object({
  schemaVersion: z.literal("1.0"),
  description: z.string().optional(),
  classes: z.array(failureClassSchema).min(1),
  mappingRules: z.array(mappingRuleSchema).min(1),
  sourceFallbacks: z.record(z.string(), z.string()),
});

export type FailureTaxonomyPolicy = z.infer<typeof policySchema>;
export type FailureTaxonomyClass = z.infer<typeof failureClassSchema>;
export type FailureTaxonomyMappingRule = z.infer<typeof mappingRuleSchema>;

export const DEFAULT_FAILURE_TAXONOMY_POLICY_PATH = path.join(
  "docs",
  "operations",
  "FAILURE_TAXONOMY_POLICY.json",
);

export async function loadFailureTaxonomyPolicy(
  rootDir: string,
  policyPath = DEFAULT_FAILURE_TAXONOMY_POLICY_PATH,
): Promise<FailureTaxonomyPolicy> {
  return readPolicyJson(rootDir, policyPath, (raw) => policySchema.parse(raw));
}
