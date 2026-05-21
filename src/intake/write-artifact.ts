import path from "node:path";
import fs from "fs-extra";
import { validateIntakeBrief, type IntakeBrief } from "./schema.js";

const intakeJsonPath = (rootDir: string) => path.join(rootDir, "artifacts", "intake", "INTAKE_BRIEF.json");
const intakeMarkdownPath = (rootDir: string) => path.join(rootDir, "artifacts", "intake", "INTAKE_BRIEF.md");

function toMarkdown(brief: IntakeBrief): string {
  return [
    "# Intake Brief",
    "",
    `Intake ID: ${brief.intakeId}`,
    `Generated at: ${brief.generatedAt}`,
    `Project: ${brief.project}`,
    `Source: ${brief.source.type} (${brief.source.channel})`,
    ...(brief.source.externalId ? [`External ID: ${brief.source.externalId}`] : []),
    "",
    "## Title",
    brief.title,
    "",
    "## Summary",
    brief.summary,
    "",
    "## Request Description",
    brief.request.description,
    "",
    "## Constraints",
    ...(brief.request.constraints.length > 0 ? brief.request.constraints.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Target Users",
    ...(brief.request.targetUsers.length > 0 ? brief.request.targetUsers.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Normalization",
    `- Trimmed: ${brief.normalization.trimmed}`,
    `- Deduped constraints: ${brief.normalization.dedupedConstraints}`,
    `- Deduped target users: ${brief.normalization.dedupedTargetUsers}`,
    `- Word count: ${brief.normalization.wordCount}`,
    "",
    "## Ambiguity",
    `- Score: ${brief.ambiguity.score}`,
    `- Level: ${brief.ambiguity.level}`,
    `- Clarification required: ${brief.ambiguity.clarificationRequired}`,
    `- Threshold: ${brief.ambiguity.threshold}`,
    ...(brief.ambiguity.signals.length > 0
      ? [
          "",
          "### Signals",
          ...brief.ambiguity.signals.map(
            (signal) => `- ${signal.id} (+${signal.weight}): ${signal.reason}`,
          ),
        ]
      : []),
    "",
    "## Risk and Priority",
    `- Risk score: ${brief.riskPriority.riskScore} (${brief.riskPriority.riskLevel})`,
    `- Priority score: ${brief.riskPriority.priorityScore} (${brief.riskPriority.priorityLevel})`,
    `- High risk: ${brief.riskPriority.highRisk}`,
    `- Threshold: ${brief.riskPriority.threshold}`,
    `- Dimensions: security=${brief.riskPriority.dimensions.security}, blastRadius=${brief.riskPriority.dimensions.blastRadius}, complexity=${brief.riskPriority.dimensions.complexity}, urgency=${brief.riskPriority.dimensions.urgency}`,
    ...(brief.riskPriority.signals.length > 0
      ? [
          "",
          "### Risk Signals",
          ...brief.riskPriority.signals.map(
            (signal) => `- ${signal.id} [${signal.dimension}] +${signal.weight}: ${signal.reason}`,
          ),
        ]
      : []),
    "",
  ].join("\n");
}

export async function writeIntakeArtifact(
  rootDir: string,
  brief: IntakeBrief,
): Promise<{ jsonPath: string; markdownPath: string; brief: IntakeBrief }> {
  const validated = validateIntakeBrief(brief);
  const jsonPath = intakeJsonPath(rootDir);
  const markdownPath = intakeMarkdownPath(rootDir);
  await fs.ensureDir(path.dirname(jsonPath));
  await fs.writeJson(jsonPath, validated, { spaces: 2 });
  await fs.writeFile(markdownPath, toMarkdown(validated));
  return { jsonPath, markdownPath, brief: validated };
}

export async function readIntakeArtifact(rootDir: string): Promise<IntakeBrief | null> {
  const jsonPath = intakeJsonPath(rootDir);
  if (!(await fs.pathExists(jsonPath))) {
    return null;
  }
  return validateIntakeBrief(await fs.readJson(jsonPath));
}
