import { describe, expect, it } from "vitest";
import { DEFAULT_INTAKE_AMBIGUITY_POLICY } from "../src/intake/ambiguity-policy.js";
import {
  attachIntakeAmbiguity,
  scoreIntakeAmbiguity,
  shouldRequireClarification,
} from "../src/intake/ambiguity.js";
import { buildIntakeBrief } from "../src/intake/core.js";
import { normalizeFromCliPrompt } from "../src/intake/normalize.js";

describe("intake ambiguity scoring", () => {
  it("is deterministic for fixed input", () => {
    const brief = normalizeFromCliPrompt({
      project: "billing-api",
      idea: "Build billing API maybe later with TBD auth approach?",
      constraints: ["no-auth", "require authentication"],
      targetUsers: [],
    });

    const first = scoreIntakeAmbiguity(brief, DEFAULT_INTAKE_AMBIGUITY_POLICY);
    const second = scoreIntakeAmbiguity(brief, DEFAULT_INTAKE_AMBIGUITY_POLICY);

    expect(first).toEqual(second);
    expect(first.signals.map((signal) => signal.id)).toEqual(
      [...first.signals].sort((a, b) => a.id.localeCompare(b.id)).map((signal) => signal.id),
    );
  });

  it("marks clear requests below clarification threshold", () => {
    const brief = normalizeFromCliPrompt({
      project: "billing-api",
      idea: "Build an internal billing API with audit logs, role-based access control, and integration tests for finance operations.",
      constraints: ["SOC2", "type-safe"],
      targetUsers: ["finance-ops"],
    });

    expect(brief.ambiguity.score).toBeLessThan(brief.ambiguity.threshold);
    expect(brief.ambiguity.clarificationRequired).toBe(false);
    expect(brief.ambiguity.level).not.toBe("high");
    expect(shouldRequireClarification(brief.ambiguity)).toBe(false);
  });

  it("marks ambiguous requests at or above clarification threshold", () => {
    const core = buildIntakeBrief(
      {
        sourceType: "cli-prompt",
        channel: "dexter-cli",
        request: {
          project: "billing-api",
          description: "Build something for production security maybe?",
          constraints: [],
          targetUsers: [],
          labels: [],
          acceptanceSignals: [],
        },
      },
      DEFAULT_INTAKE_AMBIGUITY_POLICY,
    );

    expect(core.ambiguity.score).toBeGreaterThanOrEqual(core.ambiguity.threshold);
    expect(core.ambiguity.clarificationRequired).toBe(true);
    expect(core.ambiguity.level).not.toBe("low");
    expect(core.ambiguity.signals.some((signal) => signal.id === "vague-language")).toBe(true);
  });

  it("detects conflicting constraints", () => {
    const brief = normalizeFromCliPrompt({
      project: "billing-api",
      idea: "Add authentication middleware for all billing endpoints with comprehensive tests and rollout plan.",
      constraints: ["no-auth", "require authentication"],
      targetUsers: ["platform-team"],
    });

    expect(brief.ambiguity.signals.some((signal) => signal.id === "conflicting-constraints")).toBe(true);
  });

  it("respects policy threshold overrides", () => {
    const brief = normalizeFromCliPrompt({
      project: "billing-api",
      idea: "Build billing export endpoint for finance operations with CSV output and audit logging.",
      constraints: ["SOC2"],
      targetUsers: ["finance-ops"],
    });

    const strict = attachIntakeAmbiguity(brief, {
      ...DEFAULT_INTAKE_AMBIGUITY_POLICY,
      clarificationThreshold: 5,
    });
    const lenient = attachIntakeAmbiguity(brief, {
      ...DEFAULT_INTAKE_AMBIGUITY_POLICY,
      clarificationThreshold: 100,
    });

    expect(strict.ambiguity.clarificationRequired).not.toBe(lenient.ambiguity.clarificationRequired);
    expect(strict.ambiguity.threshold).toBe(5);
    expect(lenient.ambiguity.threshold).toBe(100);
  });
});
