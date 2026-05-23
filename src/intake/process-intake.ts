import type { IntakeBrief } from "./schema.js";
import { runClarificationGate, type ClarificationGateResult } from "./clarification-gate.js";
import { writeIntakeArtifact } from "./write-artifact.js";

export interface ProcessIntakeResult {
  brief: IntakeBrief;
  jsonPath: string;
  markdownPath: string;
  clarification: ClarificationGateResult;
}

export async function processIntakeBrief(rootDir: string, brief: IntakeBrief): Promise<ProcessIntakeResult> {
  const written = await writeIntakeArtifact(rootDir, brief);
  const clarification = await runClarificationGate(rootDir, written.brief);
  return {
    brief: written.brief,
    jsonPath: written.jsonPath,
    markdownPath: written.markdownPath,
    clarification,
  };
}
