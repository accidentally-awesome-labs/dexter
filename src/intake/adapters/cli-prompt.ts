import { buildIntakeBrief } from "../core.js";
import type { IntakeBrief } from "../schema.js";
import type { IntakeAdapter } from "./types.js";

export interface CliPromptPayload {
  project: string;
  idea: string;
  constraints?: string[];
  targetUsers?: string[];
  labels?: string[];
  externalId?: string;
}

export const cliPromptAdapter: IntakeAdapter<CliPromptPayload> = {
  id: "cli-prompt",
  channel: "dexter-cli",
  normalize(payload: CliPromptPayload): IntakeBrief {
    return buildIntakeBrief({
      sourceType: "cli-prompt",
      channel: "dexter-cli",
      externalId: payload.externalId,
      rawDescription: payload.idea,
      rawConstraints: payload.constraints ?? [],
      rawTargetUsers: payload.targetUsers ?? [],
      request: {
        project: payload.project,
        description: payload.idea,
        constraints: payload.constraints ?? [],
        targetUsers: payload.targetUsers ?? [],
        labels: payload.labels ?? [],
        acceptanceSignals: [],
      },
    });
  },
};
