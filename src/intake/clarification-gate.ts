import path from "node:path";
import fs from "fs-extra";
import { shouldRequireClarification } from "./ambiguity.js";
import { generateClarificationCycle, type ClarificationCycle } from "./clarification.js";
import type { IntakeBrief } from "./schema.js";

const clarificationLogJsonPath = (rootDir: string) =>
  path.join(rootDir, "artifacts", "intake", "CLARIFICATION_LOG.json");
const clarificationLogMarkdownPath = (rootDir: string) =>
  path.join(rootDir, "artifacts", "intake", "CLARIFICATION_LOG.md");

export interface ClarificationGateResult {
  passed: boolean;
  clarificationRequired: boolean;
  bypassed: boolean;
  logPath: string | null;
  jsonPath: string | null;
  cycle: ClarificationCycle | null;
}

function toMarkdown(cycle: ClarificationCycle): string {
  return [
    "# Clarification Log",
    "",
    `Cycle ID: ${cycle.cycleId}`,
    `Intake ID: ${cycle.intakeId}`,
    `Generated at: ${cycle.generatedAt}`,
    `Status: ${cycle.status}`,
    `Ambiguity score: ${cycle.ambiguityScore} (${cycle.ambiguityLevel})`,
    "",
    "## Questions",
    ...cycle.questions.map((question, index) => `${index + 1}. ${question.prompt}`),
    "",
    "## Triggering Signals",
    ...(cycle.triggeringSignals.length > 0
      ? cycle.triggeringSignals.map(
          (signal) => `- ${signal.id} (+${signal.weight}): ${signal.reason}`,
        )
      : ["- None"]),
    "",
    "## Operator Actions",
    "- Update the request with clarified details.",
    "- Re-run `npm run intake:normalize` with the refined input.",
    "- Verify `clarificationRequired` is false before continuing to planning.",
    "",
  ].join("\n");
}

async function clearClarificationArtifacts(rootDir: string): Promise<void> {
  const paths = [clarificationLogJsonPath(rootDir), clarificationLogMarkdownPath(rootDir)];
  await Promise.all(
    paths.map(async (artifactPath) => {
      if (await fs.pathExists(artifactPath)) {
        await fs.remove(artifactPath);
      }
    }),
  );
}

export async function writeClarificationLog(
  rootDir: string,
  cycle: ClarificationCycle,
): Promise<{ jsonPath: string; markdownPath: string }> {
  const jsonPath = clarificationLogJsonPath(rootDir);
  const markdownPath = clarificationLogMarkdownPath(rootDir);
  await fs.ensureDir(path.dirname(jsonPath));
  await fs.writeJson(jsonPath, cycle, { spaces: 2 });
  await fs.writeFile(markdownPath, toMarkdown(cycle));
  return { jsonPath, markdownPath };
}

export async function readClarificationLog(rootDir: string): Promise<ClarificationCycle | null> {
  const jsonPath = clarificationLogJsonPath(rootDir);
  if (!(await fs.pathExists(jsonPath))) {
    return null;
  }
  return fs.readJson(jsonPath) as Promise<ClarificationCycle>;
}

export async function runClarificationGate(rootDir: string, brief: IntakeBrief): Promise<ClarificationGateResult> {
  if (!shouldRequireClarification(brief.ambiguity)) {
    await clearClarificationArtifacts(rootDir);
    return {
      passed: true,
      clarificationRequired: false,
      bypassed: true,
      logPath: null,
      jsonPath: null,
      cycle: null,
    };
  }

  const cycle = generateClarificationCycle(brief);
  const written = await writeClarificationLog(rootDir, cycle);
  return {
    passed: false,
    clarificationRequired: true,
    bypassed: false,
    logPath: written.markdownPath,
    jsonPath: written.jsonPath,
    cycle,
  };
}
