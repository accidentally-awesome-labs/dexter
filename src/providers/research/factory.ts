import type { ResearchProvider } from "./types.js";
import { HttpResearchProvider } from "./http-provider.js";

export function createResearchProvider(): ResearchProvider | null {
  const endpoint = process.env.DEXTER_RESEARCH_API_URL;
  if (!endpoint) {
    return null;
  }
  const apiKey = process.env.DEXTER_RESEARCH_API_KEY;
  return new HttpResearchProvider(endpoint, apiKey);
}
