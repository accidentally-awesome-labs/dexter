import { describe, expect, it } from "vitest";
import { compilePlan } from "../src/skills/planning/compiler.js";
import { DEFAULT_INTAKE_RISK_PRIORITY_POLICY } from "../src/intake/risk-priority-policy.js";
import {
  enrichTaskGraphWithRiskPriority,
  scoreIntakeRiskPriority,
} from "../src/intake/risk-priority.js";
import { normalizeFromCliPrompt } from "../src/intake/normalize.js";

describe("intake risk and priority scoring", () => {
  it("is deterministic for fixed input", () => {
    const brief = normalizeFromCliPrompt({
      project: "payments",
      idea: "Patch production authentication outage with PCI scope and urgent incident response.",
      constraints: ["SOC2"],
      targetUsers: ["oncall-team"],
    });

    const first = scoreIntakeRiskPriority(brief, DEFAULT_INTAKE_RISK_PRIORITY_POLICY);
    const second = scoreIntakeRiskPriority(brief, DEFAULT_INTAKE_RISK_PRIORITY_POLICY);
    expect(first).toEqual(second);
  });

  it("marks high-risk production security requests above threshold", () => {
    const brief = normalizeFromCliPrompt({
      project: "payments",
      idea: "Patch production authentication outage with PCI scope, customer-facing billing impact, and urgent incident response.",
      constraints: [],
      targetUsers: ["oncall-team"],
      sourceType: "cli-prompt",
    });
    brief.request.labels = ["security", "incident"];

    const profile = scoreIntakeRiskPriority(brief, DEFAULT_INTAKE_RISK_PRIORITY_POLICY);
    expect(profile.riskScore).toBeGreaterThanOrEqual(profile.threshold);
    expect(profile.highRisk).toBe(true);
    expect(profile.riskLevel).not.toBe("low");
    expect(profile.dimensions.security).toBeGreaterThan(0);
    expect(profile.dimensions.urgency).toBeGreaterThan(0);
  });

  it("marks low-risk internal requests below high-risk threshold", () => {
    const brief = normalizeFromCliPrompt({
      project: "internal-tools",
      idea: "Add a local developer dashboard widget for test coverage summaries in staging environments.",
      constraints: ["type-safe"],
      targetUsers: ["platform-team"],
    });

    const profile = scoreIntakeRiskPriority(brief, DEFAULT_INTAKE_RISK_PRIORITY_POLICY);
    expect(profile.highRisk).toBe(false);
    expect(profile.riskScore).toBeLessThan(profile.threshold);
  });

  it("includes riskPriority on intake brief artifacts", () => {
    const brief = normalizeFromCliPrompt({
      project: "payments",
      idea: "Patch production authentication outage with PCI scope and urgent incident response.",
      constraints: ["SOC2"],
      targetUsers: ["oncall-team"],
    });

    expect(brief.riskPriority.riskScore).toBeGreaterThan(0);
    expect(brief.riskPriority.priorityScore).toBeGreaterThan(0);
    expect(brief.riskPriority.dimensions).toMatchObject({
      security: expect.any(Number),
      blastRadius: expect.any(Number),
      complexity: expect.any(Number),
      urgency: expect.any(Number),
    });
  });

  it("enriches task graph metadata from intake profile", () => {
    const brief = normalizeFromCliPrompt({
      project: "payments",
      idea: "Patch production authentication outage with PCI scope and urgent incident response.",
      constraints: ["SOC2"],
      targetUsers: ["oncall-team"],
    });

    const discovery = {
      brief: brief.summary,
      glossary: {},
      marketEvidence: [],
      risks: [],
    };
    const plan = compilePlan(discovery, { project: "payments", intakeBrief: brief });

    expect(plan.tasks.every((task) => task.riskPriority)).toBe(true);
    const policyTask = plan.tasks.find((task) => task.id === "t3-policy");
    expect(policyTask?.riskPriority?.highRisk).toBe(true);
    expect(policyTask?.mode).toBe("HITL");
  });

  it("increases task risk for HITL governance tasks", () => {
    const brief = normalizeFromCliPrompt({
      project: "internal-tools",
      idea: "Add a local developer dashboard widget for test coverage summaries in staging environments.",
      constraints: ["type-safe"],
      targetUsers: ["platform-team"],
    });

    const tasks = enrichTaskGraphWithRiskPriority(brief, [
      {
        id: "t1",
        title: "Implement widget",
        description: "Build widget",
        mode: "AFK",
        dependencies: [],
        acceptanceCriteria: ["done"],
        nfrTags: ["reliability"],
        maxAttempts: 2,
        commands: [{ type: "shell", command: "true" }],
        acceptanceChecks: [{ type: "shell", command: "true" }],
      },
      {
        id: "t2",
        title: "Policy gate",
        description: "Governance",
        mode: "HITL",
        dependencies: ["t1"],
        acceptanceCriteria: ["approved"],
        nfrTags: ["governance"],
        commands: [],
      },
    ]);

    const hitl = tasks.find((task) => task.id === "t2");
    const afk = tasks.find((task) => task.id === "t1");
    expect((hitl?.riskPriority?.riskScore ?? 0)).toBeGreaterThan(afk?.riskPriority?.riskScore ?? 0);
  });
});
