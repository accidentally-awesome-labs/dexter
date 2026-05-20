import type { DiscoveryArtifact, IdeaInput } from "../../protocols/types.js";
import { createResearchProvider } from "../../providers/research/factory.js";

async function fetchLiveEvidence(input: IdeaInput): Promise<string[]> {
  const provider = createResearchProvider();
  if (!provider) {
    return [];
  }
  try {
    return await provider.fetchEvidence(input);
  } catch {
    return [];
  }
}

export async function synthesizeResearch(input: IdeaInput): Promise<Pick<DiscoveryArtifact, "marketEvidence" | "risks">> {
  const fallbackEvidence = [
    "Reference architecture trend: autonomous loops perform better with explicit artifact state.",
    "Operational trend: production trust requires rollback-first deployment contracts.",
    "Product trend: hybrid graph+vector memory improves retrieval diversity for long-lived agents.",
  ];
  const liveEvidence = await fetchLiveEvidence(input);
  const evidence = liveEvidence.length > 0 ? liveEvidence : fallbackEvidence;

  return {
    marketEvidence: evidence,
    risks: [
      {
        id: "risk-memory-quality",
        title: "Global memory may propagate stale or incorrect lessons.",
        level: "critical",
        mitigation: "Confidence scoring, contradiction resolution, and decay-based expiry.",
      },
      {
        id: "risk-runtime-lockin",
        title: `Control-plane lock-in can slow future managed-platform evolution for ${input.project}.`,
        level: "medium",
        mitigation: "Maintain adapter contracts and benchmark-driven selection cadence.",
      },
    ],
  };
}
