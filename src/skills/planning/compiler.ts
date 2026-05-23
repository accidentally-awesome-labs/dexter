import type { DiscoveryArtifact, PlanArtifact, TaskSpec } from "../../protocols/types.js";
import { applyExecutionModeRouting } from "../../intake/mode-routing.js";
import { enrichTaskGraphWithRiskPriority } from "../../intake/risk-priority.js";
import type { IntakeBrief } from "../../intake/schema.js";
import { validateTaskGraph } from "./graph-validator.js";

function buildTaskGraph(project: string, _priorLessons: string[] = []): TaskSpec[] {
  return [
    {
      id: "t1-bootstrap-workspace",
      title: "Bootstrap workspace implementation artifacts",
      description: "Create baseline implementation notes and scaffolding files in isolated workspace.",
      mode: "AFK",
      dependencies: [],
      acceptanceCriteria: ["Bootstrap artifact generated"],
      nfrTags: ["traceability", "reliability"],
      workspaceStrategy: "shared",
      maxAttempts: 2,
      backendHint: "scripted",
      commands: [
        {
          type: "agent",
          prompt: `Create an implementation brief for ${project}. Guidance: Use deterministic, test-first iteration.`,
        },
        {
          type: "shell",
          command: `mkdir -p generated && printf "project=%s\\nstatus=bootstrapped\\n" "${project}" > generated/bootstrap.txt`,
        },
      ],
      acceptanceChecks: [
        {
          type: "file-exists",
          path: "generated/bootstrap.txt",
        },
      ],
    },
    {
      id: "t2-build-and-verify",
      title: "Run build and verification commands",
      description: "Execute deterministic build checks and capture verification output.",
      mode: "AFK",
      dependencies: ["t1-bootstrap-workspace"],
      acceptanceCriteria: ["Generated bootstrap output validated"],
      nfrTags: ["reliability", "security"],
      workspaceStrategy: "shared",
      maxAttempts: 2,
      commands: [
        {
          type: "shell",
          command: "test -f generated/bootstrap.txt",
        },
      ],
      acceptanceChecks: [
        {
          type: "shell",
          command: "test -f generated/bootstrap.txt",
        },
      ],
    },
    {
      id: "t3-policy",
      title: "Apply policy gate",
      description: "Evaluate safety and rollback constraints before execution.",
      mode: "HITL",
      dependencies: ["t2-build-and-verify"],
      acceptanceCriteria: ["No critical blockers unresolved"],
      nfrTags: ["governance"],
      workspaceStrategy: "shared",
      commands: [],
    },
  ];
}

export function compilePlan(
  discovery: DiscoveryArtifact,
  options?: { project?: string; priorLessons?: string[]; intakeBrief?: IntakeBrief },
): PlanArtifact {
  const prd = `# PRD\n\n${discovery.brief}\n\n## Risks\n${discovery.risks
    .map((r) => `- (${r.level}) ${r.title}: ${r.mitigation}`)
    .join("\n")}`;

  const architecture = `# Architecture\n\n- Loop model: fresh run context with artifacts.\n- Pipeline: discovery -> planning -> policy gate -> execution -> verification -> release.\n- Memory: project + global learning graph.`;
  const nfrSpec = `# NFR Specification\n\n- Performance budget: complete AFK task in <= 5 minutes.\n- Reliability target: 99% task completion without manual retry.\n- Security: enforce secret-safety and supply-chain checks before release.`;
  const testStrategy = `# Test Strategy\n\n- Unit-test compilers and policy evaluators.\n- Integration-test orchestrator pipeline.\n- Golden-run replay tests for regression detection.`;

  const baseTasks = buildTaskGraph(options?.project ?? "dexter-project", options?.priorLessons ?? []);
  const scoredTasks = options?.intakeBrief
    ? enrichTaskGraphWithRiskPriority(options.intakeBrief, baseTasks)
    : baseTasks;
  const routed = applyExecutionModeRouting(options?.intakeBrief, scoredTasks);
  const tasks = routed.tasks;
  const validation = validateTaskGraph(tasks);
  if (!validation.valid) {
    throw new Error(`Invalid compiled task graph: ${validation.errors.join("; ")}`);
  }

  return {
    prd,
    architecture,
    nfrSpec,
    testStrategy,
    tasks,
  };
}
