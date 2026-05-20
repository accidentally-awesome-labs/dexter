import type { DiscoveryArtifact, IdeaInput } from "../../protocols/types.js";

const defaultQuestions = [
  "What concrete pain does this solve today?",
  "Who is the first narrow user segment?",
  "What is the smallest production-safe v1 outcome?",
  "What will make this 10x better than current alternatives?",
];

export function runGrillingSession(input: IdeaInput): DiscoveryArtifact {
  const glossary: Record<string, string> = {
    Dexter: "Autonomous software factory for planning, building, verification, and release readiness.",
    AFK: "Task executable end-to-end without human intervention.",
    HITL: "Task requiring explicit human decision or approval.",
    PolicyGate: "Non-bypassable safety and governance approval checkpoint.",
  };

  const brief = [
    `Project: ${input.project}`,
    `Idea: ${input.idea}`,
    "Grilling prompts:",
    ...defaultQuestions.map((q, i) => `${i + 1}. ${q}`),
    "Recommendation: prioritize the thinnest vertical slice that proves production reliability.",
  ].join("\n");

  return {
    brief,
    glossary,
    marketEvidence: [],
    risks: [
      {
        id: "risk-scope-drift",
        title: "Scope drift can kill deterministic execution.",
        level: "high",
        mitigation: "Require task graph with AFK/HITL labels and acceptance criteria for each task.",
      },
    ],
  };
}
