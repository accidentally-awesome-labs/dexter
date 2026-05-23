import path from "node:path";
import { z } from "zod";
import { readPolicyJson } from "../lib/read-policy-json.js";

const flakyQuarantinePolicySchema = z.object({
  schemaVersion: z.literal("1.0"),
  description: z.string().optional(),
  regressionCriticalPatterns: z.array(z.string()).default([]),
  manualQuarantine: z.array(z.string()).default([]),
  manualNeverQuarantine: z.array(z.string()).default([]),
});

export type FlakyQuarantinePolicy = z.infer<typeof flakyQuarantinePolicySchema>;

export const DEFAULT_FLAKY_QUARANTINE_POLICY_PATH = path.join(
  "docs",
  "operations",
  "FLAKY_QUARANTINE_POLICY.json",
);

export async function loadFlakyQuarantinePolicy(rootDir: string): Promise<FlakyQuarantinePolicy> {
  return readPolicyJson(rootDir, DEFAULT_FLAKY_QUARANTINE_POLICY_PATH, (raw) =>
    flakyQuarantinePolicySchema.parse(raw),
  );
}

export function matchesPattern(value: string, patterns: string[]): boolean {
  const normalized = value.replace(/\\/g, "/");
  return patterns.some((pattern) => {
    const needle = pattern.replace(/\\/g, "/");
    return normalized.includes(needle) || normalized.endsWith(needle);
  });
}

export function isRegressionCriticalTest(
  test: { testId: string; file: string },
  policy: FlakyQuarantinePolicy,
): boolean {
  if (matchesPattern(test.testId, policy.manualNeverQuarantine)) {
    return true;
  }
  return (
    matchesPattern(test.file, policy.regressionCriticalPatterns) ||
    matchesPattern(test.testId, policy.regressionCriticalPatterns)
  );
}
