import { buildIntakeBrief, trim } from "../core.js";
import type { IntakeBrief } from "../schema.js";
import type { IntakeAdapter } from "./types.js";

export interface IssueLabel {
  name: string;
}

export interface GitHubIssuePayload {
  project: string;
  title: string;
  body: string;
  number?: number;
  labels?: Array<string | IssueLabel>;
  constraints?: string[];
  targetUsers?: string[];
  assignees?: string[];
  milestone?: string;
  url?: string;
}

export interface LinearIssuePayload {
  project: string;
  title: string;
  description: string;
  identifier?: string;
  labels?: string[];
  constraints?: string[];
  targetUsers?: string[];
  teamId?: string;
  priority?: number;
}

function normalizeIssueLabels(labels: Array<string | IssueLabel> | undefined): string[] {
  if (!labels) {
    return [];
  }
  return labels
    .map((label) => (typeof label === "string" ? label : label.name))
    .map((label) => trim(label))
    .filter(Boolean);
}

function issueDescription(title: string, body: string): string {
  return `${trim(title)}\n\n${trim(body)}`;
}

export const githubIssueAdapter: IntakeAdapter<GitHubIssuePayload> = {
  id: "issue",
  channel: "github-issue",
  normalize(payload: GitHubIssuePayload): IntakeBrief {
    const description = issueDescription(payload.title, payload.body);
    const labels = normalizeIssueLabels(payload.labels);
    return buildIntakeBrief({
      sourceType: "issue",
      channel: "github-issue",
      externalId: payload.number ? `GH-${payload.number}` : undefined,
      rawDescription: description,
      rawConstraints: payload.constraints ?? [],
      rawTargetUsers: payload.targetUsers ?? [],
      request: {
        project: payload.project,
        description,
        constraints: payload.constraints ?? [],
        targetUsers: payload.targetUsers ?? [],
        labels,
        acceptanceSignals: [],
      },
    });
  },
};

export const linearIssueAdapter: IntakeAdapter<LinearIssuePayload> = {
  id: "issue",
  channel: "linear-issue",
  normalize(payload: LinearIssuePayload): IntakeBrief {
    const description = issueDescription(payload.title, payload.description);
    return buildIntakeBrief({
      sourceType: "issue",
      channel: "linear-issue",
      externalId: payload.identifier,
      rawDescription: description,
      rawConstraints: payload.constraints ?? [],
      rawTargetUsers: payload.targetUsers ?? [],
      request: {
        project: payload.project,
        description,
        constraints: payload.constraints ?? [],
        targetUsers: payload.targetUsers ?? [],
        labels: (payload.labels ?? []).map((label) => trim(label)),
        acceptanceSignals: [],
      },
    });
  },
};

export function normalizeFromGitHubIssue(payload: GitHubIssuePayload): IntakeBrief {
  return githubIssueAdapter.normalize(payload);
}

export function normalizeFromLinearIssue(payload: LinearIssuePayload): IntakeBrief {
  return linearIssueAdapter.normalize(payload);
}
