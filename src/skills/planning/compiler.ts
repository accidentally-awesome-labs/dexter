import type { DiscoveryArtifact, PlanArtifact, TaskSpec } from "../../protocols/types.js";

function buildTaskGraph(): TaskSpec[] {
  return [
    {
      id: "t1-discovery",
      title: "Discovery artifacts",
      description: "Generate brief, glossary, market evidence, and risk register.",
      mode: "AFK",
      dependencies: [],
      acceptanceCriteria: ["All discovery artifacts written", "Risk levels assigned"],
      nfrTags: ["traceability"],
    },
    {
      id: "t2-planning",
      title: "Compile PRD and task graph",
      description: "Generate PRD, architecture spec, NFR spec, and task graph.",
      mode: "AFK",
      dependencies: ["t1-discovery"],
      acceptanceCriteria: ["Task graph is acyclic", "All tasks have acceptance criteria"],
      nfrTags: ["reliability", "security"],
    },
    {
      id: "t3-policy",
      title: "Apply policy gate",
      description: "Evaluate safety and rollback constraints before execution.",
      mode: "HITL",
      dependencies: ["t2-planning"],
      acceptanceCriteria: ["No critical blockers unresolved"],
      nfrTags: ["governance"],
    },
  ];
}

export function compilePlan(discovery: DiscoveryArtifact): PlanArtifact {
  const prd = `# PRD\n\n${discovery.brief}\n\n## Risks\n${discovery.risks
    .map((r) => `- (${r.level}) ${r.title}: ${r.mitigation}`)
    .join("\n")}`;

  const architecture = `# Architecture\n\n- Loop model: fresh run context with artifacts.\n- Pipeline: discovery -> planning -> policy gate -> execution -> verification -> release.\n- Memory: project + global learning graph.`;
  const nfrSpec = `# NFR Specification\n\n- Performance budget: complete AFK task in <= 5 minutes.\n- Reliability target: 99% task completion without manual retry.\n- Security: enforce secret-safety and supply-chain checks before release.`;
  const testStrategy = `# Test Strategy\n\n- Unit-test compilers and policy evaluators.\n- Integration-test orchestrator pipeline.\n- Golden-run replay tests for regression detection.`;

  return {
    prd,
    architecture,
    nfrSpec,
    testStrategy,
    tasks: buildTaskGraph(),
  };
}
