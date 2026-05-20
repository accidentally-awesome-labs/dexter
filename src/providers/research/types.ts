import type { IdeaInput } from "../../protocols/types.js";

export interface ResearchProvider {
  fetchEvidence(input: IdeaInput): Promise<string[]>;
}
