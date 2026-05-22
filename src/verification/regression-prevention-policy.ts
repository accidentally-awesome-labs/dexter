import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";

const regressionTemplateSchema = z.object({
  failureClass: z.string().min(1),
  title: z.string().min(1),
  retryGuidance: z.string().min(1),
  replanSuggestions: z.array(z.string().min(1)).min(1),
  operatorChecklist: z.array(z.string().min(1)).min(1),
  regressionChecks: z.array(z.string().min(1)).min(1),
});

const regressionPreventionPolicySchema = z.object({
  schemaVersion: z.literal("1.0"),
  description: z.string().optional(),
  templates: z.array(regressionTemplateSchema).min(1),
});

export type RegressionTemplate = z.infer<typeof regressionTemplateSchema>;
export type RegressionPreventionPolicy = z.infer<typeof regressionPreventionPolicySchema>;

export const DEFAULT_REGRESSION_PREVENTION_POLICY_PATH = path.join(
  "docs",
  "operations",
  "REGRESSION_PREVENTION_TEMPLATES.json",
);

export async function loadRegressionPreventionPolicy(rootDir: string): Promise<RegressionPreventionPolicy> {
  const raw = await fs.readJson(path.join(rootDir, DEFAULT_REGRESSION_PREVENTION_POLICY_PATH));
  return regressionPreventionPolicySchema.parse(raw);
}
