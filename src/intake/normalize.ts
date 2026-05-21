import type { IdeaInput } from "../protocols/types.js";
import { cliPromptAdapter, type CliPromptPayload } from "./adapters/cli-prompt.js";
import {
  githubIssueAdapter,
  linearIssueAdapter,
  type GitHubIssuePayload,
  type LinearIssuePayload,
} from "./adapters/issue.js";
import { templateAdapter, type TemplatePayload } from "./adapters/template.js";
import { normalizeIntake } from "./adapters/registry.js";
import type { IntakeBrief } from "./schema.js";
import type { IntakeSourceType } from "./schema.js";

export type { CliPromptPayload, GitHubIssuePayload, LinearIssuePayload, TemplatePayload };
export { normalizeIntake } from "./adapters/registry.js";
export { listIntakeTemplateIds } from "./adapters/template.js";
export { toDiscoveryBrief, toIdeaInput, assertNoSourceLeakage } from "./planning-bridge.js";
export { arePlanningEquivalent, intakePlanningFingerprint } from "./equivalence.js";
export {
  attachIntakeAmbiguity,
  attachIntakeAmbiguityFromPolicyFile,
  scoreIntakeAmbiguity,
  shouldRequireClarification,
} from "./ambiguity.js";
export { generateClarificationCycle } from "./clarification.js";
export { runClarificationGate, writeClarificationLog } from "./clarification-gate.js";
export { processIntakeBrief } from "./process-intake.js";
export { compilePlanFromIntake, planFromIntakeArtifacts, risksFromIntakeBrief } from "./plan-from-intake.js";
export { runIntakePipelineFromIdea } from "./run-intake-pipeline.js";
export { runDexterFromIntakeArtifacts } from "./run-from-intake.js";
export {
  buildIntakeExecutionManifest,
  buildIntakeRunSummaryFields,
  verifyIntakeExecutionCoherence,
} from "./execution-coherence.js";
export {
  evaluatePilotBatch,
  loadPilotRequests,
  processPilotRequest,
  runIntakePilotBatch,
} from "./pilot-batch.js";
export {
  attachIntakeRiskPriority,
  enrichTaskGraphWithRiskPriority,
  scoreIntakeRiskPriority,
  scoreTaskRiskPriority,
} from "./risk-priority.js";
export {
  applyExecutionModeRouting,
  isAfkEligible,
  routeTaskExecutionMode,
} from "./mode-routing.js";

export interface CliPromptIntakeInput extends CliPromptPayload {
  sourceType?: IntakeSourceType;
}

export interface IssueIntakeInput {
  project: string;
  title: string;
  body: string;
  labels?: string[];
  constraints?: string[];
  targetUsers?: string[];
  externalId?: string;
  number?: number;
}

export function normalizeFromCliPrompt(input: CliPromptIntakeInput): IntakeBrief {
  const brief = cliPromptAdapter.normalize({
    project: input.project,
    idea: input.idea,
    constraints: input.constraints,
    targetUsers: input.targetUsers,
    labels: input.labels,
    externalId: input.externalId,
  });
  if (input.sourceType && input.sourceType !== "cli-prompt") {
    return {
      ...brief,
      source: {
        ...brief.source,
        type: input.sourceType,
      },
    };
  }
  return brief;
}

export function normalizeFromIdeaInput(input: IdeaInput, sourceType: IntakeSourceType = "cli-prompt"): IntakeBrief {
  return normalizeFromCliPrompt({
    project: input.project,
    idea: input.idea,
    constraints: input.constraints,
    targetUsers: input.targetUsers,
    labels: input.labels,
    sourceType,
  });
}

export function normalizeFromIssuePayload(input: IssueIntakeInput): IntakeBrief {
  return githubIssueAdapter.normalize({
    project: input.project,
    title: input.title,
    body: input.body,
    labels: input.labels,
    constraints: input.constraints,
    targetUsers: input.targetUsers,
    number: input.number ?? (input.externalId?.startsWith("GH-") ? Number(input.externalId.slice(3)) : undefined),
  });
}

export function normalizeFromTemplatePayload(payload: TemplatePayload): IntakeBrief {
  return templateAdapter.normalize(payload);
}

export function normalizeFromLinearIssuePayload(payload: LinearIssuePayload): IntakeBrief {
  return linearIssueAdapter.normalize(payload);
}
