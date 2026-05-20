import type { IdeaInput } from "../../protocols/types.js";
import type { ResearchProvider } from "./types.js";

export class HttpResearchProvider implements ResearchProvider {
  constructor(
    private readonly endpoint: string,
    private readonly apiKey?: string,
  ) {}

  async fetchEvidence(input: IdeaInput): Promise<string[]> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        query: input.idea,
        constraints: input.constraints,
        targetUsers: input.targetUsers,
      }),
    });
    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as { evidence?: string[] };
    return payload.evidence ?? [];
  }
}
