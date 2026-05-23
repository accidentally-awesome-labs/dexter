import path from "node:path";
import fs from "fs-extra";
import type { ExecutionFailureReason } from "../protocols/types.js";
import {
  DEFAULT_REGRESSION_PREVENTION_POLICY_PATH,
  loadRegressionPreventionPolicy,
  type RegressionPreventionPolicy,
  type RegressionTemplate,
} from "./regression-prevention-policy.js";

export interface RegressionRemediation {
  failureClass: string;
  title: string;
  retryGuidance: string;
  replanSuggestions: string[];
  operatorChecklist: string[];
  regressionChecks: string[];
}

const EXECUTION_REASON_TO_CLASS: Record<ExecutionFailureReason, string> = {
  command_failed: "execution.command_failed",
  acceptance_failed: "execution.acceptance_failed",
  dependency_blocked: "execution.dependency_blocked",
  cleanup_failed: "execution.command_failed",
  backend_unavailable: "execution.command_failed",
};

const ESCALATION_REASON_TO_CLASS: Record<string, string> = {
  cleanup_failed: "execution.command_failed",
  backend_unavailable: "execution.command_failed",
  retry_budget_exhausted: "execution.acceptance_failed",
  retry_in_progress: "execution.command_failed",
};

export function regressionPreventionIndexPath(rootDir: string): string {
  return path.join(rootDir, "artifacts", "verification", "REGRESSION_PREVENTION_INDEX.json");
}

export function resolveFailureClass(input: {
  failureReason?: ExecutionFailureReason;
  escalationReason?: string;
}): string {
  if (input.failureReason) {
    return EXECUTION_REASON_TO_CLASS[input.failureReason];
  }
  if (input.escalationReason && ESCALATION_REASON_TO_CLASS[input.escalationReason]) {
    return ESCALATION_REASON_TO_CLASS[input.escalationReason];
  }
  return "unknown";
}

export function resolveRegressionTemplate(
  policy: RegressionPreventionPolicy,
  failureClass: string,
): RegressionTemplate {
  const match =
    policy.templates.find((template) => template.failureClass === failureClass) ??
    policy.templates.find((template) => template.failureClass === "unknown");
  if (!match) {
    throw new Error(`Regression prevention policy missing template for class: ${failureClass}`);
  }
  return match;
}

export function buildRegressionRemediation(
  policy: RegressionPreventionPolicy,
  input: {
    failureClass?: string;
    failureReason?: ExecutionFailureReason;
    escalationReason?: string;
  },
): RegressionRemediation {
  const failureClass = input.failureClass ?? resolveFailureClass(input);
  const template = resolveRegressionTemplate(policy, failureClass);
  return {
    failureClass,
    title: template.title,
    retryGuidance: template.retryGuidance,
    replanSuggestions: [...template.replanSuggestions],
    operatorChecklist: [...template.operatorChecklist],
    regressionChecks: [...template.regressionChecks],
  };
}

export function formatRemediationHint(remediation: RegressionRemediation): string {
  const suggestions =
    remediation.replanSuggestions.length > 0
      ? ` Replan: ${remediation.replanSuggestions.slice(0, 2).join("; ")}.`
      : "";
  return `${remediation.retryGuidance}${suggestions}`;
}

export async function writeRegressionPreventionIndex(
  rootDir: string,
  policy: RegressionPreventionPolicy,
  generatedAt = new Date().toISOString(),
): Promise<string> {
  const indexPath = regressionPreventionIndexPath(rootDir);
  await fs.ensureDir(path.dirname(indexPath));
  await fs.writeJson(
    indexPath,
    {
      schemaVersion: "1.0",
      generatedAt,
      templateCount: policy.templates.length,
      failureClasses: policy.templates.map((template) => template.failureClass),
      policyPath: DEFAULT_REGRESSION_PREVENTION_POLICY_PATH,
    },
    { spaces: 2 },
  );
  return indexPath;
}

export async function loadRegressionRemediationPolicy(rootDir: string): Promise<RegressionPreventionPolicy> {
  return loadRegressionPreventionPolicy(rootDir);
}
