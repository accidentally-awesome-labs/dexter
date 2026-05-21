import type { IntakeBrief } from "../schema.js";
import type { IntakeAdapterId } from "./types.js";
import { cliPromptAdapter, type CliPromptPayload } from "./cli-prompt.js";
import { githubIssueAdapter, type GitHubIssuePayload } from "./issue.js";
import { templateAdapter, type TemplatePayload } from "./template.js";

export type IntakeAdapterPayload =
  | { adapter: "cli-prompt"; payload: CliPromptPayload }
  | { adapter: "issue"; payload: GitHubIssuePayload }
  | { adapter: "template"; payload: TemplatePayload };

export function normalizeIntake(input: IntakeAdapterPayload): IntakeBrief {
  switch (input.adapter) {
    case "cli-prompt":
      return cliPromptAdapter.normalize(input.payload);
    case "issue":
      return githubIssueAdapter.normalize(input.payload);
    case "template":
      return templateAdapter.normalize(input.payload);
    default: {
      const exhaustive: never = input;
      throw new Error(`Unsupported intake adapter: ${(exhaustive as IntakeAdapterPayload).adapter}`);
    }
  }
}

export function adapterChannel(adapter: IntakeAdapterId): string {
  switch (adapter) {
    case "cli-prompt":
      return cliPromptAdapter.channel;
    case "issue":
      return githubIssueAdapter.channel;
    case "template":
      return templateAdapter.channel;
    default:
      throw new Error(`Unsupported adapter id: ${adapter}`);
  }
}
