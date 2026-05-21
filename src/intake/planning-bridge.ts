import type { IdeaInput } from "../protocols/types.js";
import { validateIntakeBrief, type IntakeBrief } from "./schema.js";

const ALLOWED_BRIEF_KEYS = new Set([
  "schemaVersion",
  "intakeId",
  "generatedAt",
  "source",
  "project",
  "title",
  "summary",
  "request",
  "normalization",
  "ambiguity",
  "riskPriority",
]);

const ALLOWED_REQUEST_KEYS = new Set([
  "description",
  "constraints",
  "targetUsers",
  "labels",
  "acceptanceSignals",
]);

const ALLOWED_SOURCE_KEYS = new Set(["type", "channel", "externalId"]);

export function assertNoSourceLeakage(brief: IntakeBrief): void {
  validateIntakeBrief(brief);
  for (const key of Object.keys(brief)) {
    if (!ALLOWED_BRIEF_KEYS.has(key)) {
      throw new Error(`Intake brief contains non-contract field: ${key}`);
    }
  }
  for (const key of Object.keys(brief.request)) {
    if (!ALLOWED_REQUEST_KEYS.has(key)) {
      throw new Error(`Intake request contains non-contract field: ${key}`);
    }
  }
  for (const key of Object.keys(brief.source)) {
    if (!ALLOWED_SOURCE_KEYS.has(key)) {
      throw new Error(`Intake source contains non-contract field: ${key}`);
    }
  }
}

export function toIdeaInput(brief: IntakeBrief): IdeaInput {
  assertNoSourceLeakage(brief);
  return {
    project: brief.project,
    idea: brief.request.description,
    constraints: brief.request.constraints,
    targetUsers: brief.request.targetUsers,
  };
}

export function toDiscoveryBrief(intake: IntakeBrief): string {
  assertNoSourceLeakage(intake);
  return [
    `# ${intake.title}`,
    "",
    intake.summary,
    "",
    "## Constraints",
    ...(intake.request.constraints.length > 0
      ? intake.request.constraints.map((item) => `- ${item}`)
      : ["- None"]),
    "",
    "## Target Users",
    ...(intake.request.targetUsers.length > 0
      ? intake.request.targetUsers.map((item) => `- ${item}`)
      : ["- General engineering teams"]),
    ...(intake.request.labels.length > 0
      ? ["", "## Labels", ...intake.request.labels.map((item) => `- ${item}`)]
      : []),
    ...(intake.request.acceptanceSignals.length > 0
      ? [
          "",
          "## Acceptance Signals",
          ...intake.request.acceptanceSignals.map((item) => `- ${item}`),
        ]
      : []),
  ].join("\n");
}
