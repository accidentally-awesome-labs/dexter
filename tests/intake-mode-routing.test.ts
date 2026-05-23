import { describe, expect, it } from "vitest";
import { compilePlan } from "../src/skills/planning/compiler.js";
import { applyExecutionModeRouting, isAfkEligible } from "../src/intake/mode-routing.js";
import { normalizeFromCliPrompt } from "../src/intake/normalize.js";
import { verifyTaskAcceptance } from "../src/skills/execution/acceptance-verifier.js";

const discovery = {
  brief: "Sample discovery brief",
  glossary: {},
  marketEvidence: [],
  risks: [],
};

describe("intake AFK/HITL mode routing", () => {
  it("routes high-risk intake tasks to HITL", () => {
    const brief = normalizeFromCliPrompt({
      project: "payments",
      idea: "Patch production authentication outage with PCI scope, customer-facing billing impact, and urgent incident response.",
      constraints: [],
      targetUsers: ["oncall-team"],
    });
    brief.request.labels = ["security", "incident"];

    const plan = compilePlan(discovery, { project: "payments", intakeBrief: brief });
    const bootstrap = plan.tasks.find((task) => task.id === "t1-bootstrap-workspace");
    const build = plan.tasks.find((task) => task.id === "t2-build-and-verify");
    const policy = plan.tasks.find((task) => task.id === "t3-policy");

    expect(brief.riskPriority.highRisk).toBe(true);
    expect(bootstrap?.routing?.routedMode).toBe("HITL");
    expect(build?.routing?.routedMode).toBe("HITL");
    expect(policy?.mode).toBe("HITL");
    expect(isAfkEligible(bootstrap!)).toBe(false);
  });

  it("keeps low-risk implementation tasks AFK-eligible", () => {
    const brief = normalizeFromCliPrompt({
      project: "internal-tools",
      idea: "Add a local developer dashboard widget for test coverage summaries in staging environments.",
      constraints: ["type-safe"],
      targetUsers: ["platform-team"],
    });

    const plan = compilePlan(discovery, { project: "internal-tools", intakeBrief: brief });
    const bootstrap = plan.tasks.find((task) => task.id === "t1-bootstrap-workspace");
    const build = plan.tasks.find((task) => task.id === "t2-build-and-verify");
    const policy = plan.tasks.find((task) => task.id === "t3-policy");

    expect(brief.riskPriority.highRisk).toBe(false);
    expect(bootstrap?.routing?.routedMode).toBe("AFK");
    expect(build?.routing?.routedMode).toBe("AFK");
    expect(policy?.routing?.routedMode).toBe("HITL");
    expect(isAfkEligible(bootstrap!)).toBe(true);
    expect(isAfkEligible(build!)).toBe(true);
  });

  it("always routes governance policy tasks to HITL", () => {
    const brief = normalizeFromCliPrompt({
      project: "internal-tools",
      idea: "Add a local developer dashboard widget for test coverage summaries in staging environments.",
      constraints: ["type-safe"],
      targetUsers: ["platform-team"],
    });

    const { tasks } = applyExecutionModeRouting(
      brief,
      [
        {
          id: "t3-policy",
          title: "Apply policy gate",
          description: "Governance",
          mode: "HITL",
          dependencies: [],
          acceptanceCriteria: ["approved"],
          nfrTags: ["governance"],
          commands: [],
        },
      ],
    );

    expect(tasks[0]?.mode).toBe("HITL");
    expect(tasks[0]?.routing?.reason).toBe("explicit-hitl");
  });

  it("keeps acceptance verifier behavior for routed HITL tasks", async () => {
    const brief = normalizeFromCliPrompt({
      project: "payments",
      idea: "Patch production authentication outage with PCI scope and urgent incident response.",
      constraints: ["SOC2"],
      targetUsers: ["oncall-team"],
    });
    const plan = compilePlan(discovery, { project: "payments", intakeBrief: brief });
    const routed = plan.tasks.find((task) => task.id === "t1-bootstrap-workspace");
    expect(routed?.mode).toBe("HITL");

    const result = await verifyTaskAcceptance(routed!, process.cwd());
    expect(result.passed).toBe(true);
  });
});
