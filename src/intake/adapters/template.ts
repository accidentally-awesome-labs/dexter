import { buildIntakeBrief } from "../core.js";
import type { IntakeBrief } from "../schema.js";
import type { IntakeAdapter } from "./types.js";

export interface TemplatePayload {
  project: string;
  templateId: string;
  variables?: Record<string, string>;
  constraints?: string[];
  targetUsers?: string[];
  externalId?: string;
}

interface IntakeTemplateDefinition {
  title: string;
  description: (variables: Record<string, string>) => string;
  defaultConstraints: string[];
  defaultTargetUsers: string[];
  defaultLabels: string[];
  defaultAcceptanceSignals: string[];
}

const TEMPLATE_CATALOG: Record<string, IntakeTemplateDefinition> = {
  "api-endpoint": {
    title: "Add API endpoint",
    description: (vars) =>
      `Add ${vars.method ?? "GET"} ${vars.path ?? "/resource"} endpoint for ${vars.resource ?? "resource"} with auth, validation, and tests.`,
    defaultConstraints: ["type-safe", "test-first"],
    defaultTargetUsers: ["backend-team"],
    defaultLabels: ["api"],
    defaultAcceptanceSignals: ["endpoint documented", "tests passing"],
  },
  "bugfix": {
    title: "Fix production defect",
    description: (vars) =>
      `Fix ${vars.component ?? "component"} defect: ${vars.symptom ?? "unexpected failure"} with regression test and rollout safeguards.`,
    defaultConstraints: ["no-regression", "rollback-ready"],
    defaultTargetUsers: ["oncall-team"],
    defaultLabels: ["bug"],
    defaultAcceptanceSignals: ["root cause documented", "regression test added"],
  },
};

export function listIntakeTemplateIds(): string[] {
  return Object.keys(TEMPLATE_CATALOG);
}

export const templateAdapter: IntakeAdapter<TemplatePayload> = {
  id: "template",
  channel: "dexter-template",
  normalize(payload: TemplatePayload): IntakeBrief {
    const template = TEMPLATE_CATALOG[payload.templateId];
    if (!template) {
      throw new Error(
        `Unknown intake template "${payload.templateId}". Available: ${listIntakeTemplateIds().join(", ")}`,
      );
    }
    const variables = payload.variables ?? {};
    const description = template.description(variables);
    const constraints = [...template.defaultConstraints, ...(payload.constraints ?? [])];
    const targetUsers = [...template.defaultTargetUsers, ...(payload.targetUsers ?? [])];

    return buildIntakeBrief({
      sourceType: "template",
      channel: "dexter-template",
      externalId: payload.externalId ?? payload.templateId,
      rawDescription: description,
      rawConstraints: constraints,
      rawTargetUsers: targetUsers,
      request: {
        project: payload.project,
        description,
        constraints,
        targetUsers,
        labels: [...template.defaultLabels],
        acceptanceSignals: [...template.defaultAcceptanceSignals],
      },
    });
  },
};
