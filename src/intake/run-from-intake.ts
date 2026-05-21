import type { IdeaInput } from "../protocols/types.js";
import { runDexter } from "../core/orchestrator.js";
import { toIdeaInput } from "./planning-bridge.js";
import { readIntakeArtifact } from "./write-artifact.js";

export async function runDexterFromIntakeArtifacts(
  rootDir: string,
  options?: {
    replanMaxWaves?: number;
    skipClarificationGate?: boolean;
  },
) {
  const brief = await readIntakeArtifact(rootDir);
  if (!brief) {
    throw new Error("Missing artifacts/intake/INTAKE_BRIEF.json. Run intake-normalize first.");
  }
  if (brief.ambiguity.clarificationRequired && !options?.skipClarificationGate) {
    throw new Error(
      `Intake brief requires clarification before execution (score ${brief.ambiguity.score} >= ${brief.ambiguity.threshold}).`,
    );
  }

  const idea: IdeaInput = toIdeaInput(brief);
  return runDexter(rootDir, idea, {
    replanMaxWaves: options?.replanMaxWaves,
    intakeBrief: brief,
    skipIntakePipeline: true,
  });
}
