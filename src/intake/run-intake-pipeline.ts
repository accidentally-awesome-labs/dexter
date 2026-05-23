import type { IdeaInput } from "../protocols/types.js";
import { normalizeFromIdeaInput } from "./normalize.js";
import { processIntakeBrief, type ProcessIntakeResult } from "./process-intake.js";

export interface RunIntakePipelineOptions {
  skipClarificationGate?: boolean;
}

export async function runIntakePipelineFromIdea(
  rootDir: string,
  idea: IdeaInput,
  options?: RunIntakePipelineOptions,
): Promise<ProcessIntakeResult> {
  const brief = normalizeFromIdeaInput(idea);
  const processed = await processIntakeBrief(rootDir, brief);
  if (!processed.clarification.passed && !options?.skipClarificationGate) {
    throw new Error(
      `Clarification gate blocked planning (score ${processed.brief.ambiguity.score} >= ${processed.brief.ambiguity.threshold}). See ${processed.clarification.logPath}`,
    );
  }
  return processed;
}
