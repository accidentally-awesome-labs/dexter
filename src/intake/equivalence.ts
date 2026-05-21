import type { IntakeBrief } from "./schema.js";

export interface IntakePlanningFingerprint {
  project: string;
  title: string;
  summary: string;
  request: {
    description: string;
    constraints: string[];
    targetUsers: string[];
    labels: string[];
    acceptanceSignals: string[];
  };
}

export function intakePlanningFingerprint(brief: IntakeBrief): IntakePlanningFingerprint {
  return {
    project: brief.project,
    title: brief.title,
    summary: brief.summary,
    request: {
      description: brief.request.description,
      constraints: [...brief.request.constraints],
      targetUsers: [...brief.request.targetUsers],
      labels: [...brief.request.labels],
      acceptanceSignals: [...brief.request.acceptanceSignals],
    },
  };
}

export function arePlanningEquivalent(left: IntakeBrief, right: IntakeBrief): boolean {
  return JSON.stringify(intakePlanningFingerprint(left)) === JSON.stringify(intakePlanningFingerprint(right));
}
