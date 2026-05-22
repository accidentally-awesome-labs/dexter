import { describe, expect, it } from "vitest";
import type { LearningNode } from "../src/memory/global-learning-graph.js";
import {
  buildContradictionPenalties,
  detectLessonContradictions,
  rankLessonsForRetrieval,
} from "../src/memory/memory-contradiction.js";
import type { MemoryContradictionPolicy } from "../src/memory/memory-contradiction-policy.js";

const policy: MemoryContradictionPolicy = {
  schemaVersion: "1.0",
  minTagOverlap: 1,
  requireCategoryMatch: false,
  contradictionPairs: [
    { id: "always-never", left: "always", right: "never" },
    { id: "approve-block", left: "approve", right: "block" },
  ],
  deprioritizePenaltyWeight: 0.5,
  highSeverityThreshold: 0.6,
};

function lesson(
  id: string,
  title: string,
  body: string,
  tags: string[],
  confidence = 0.9,
): LearningNode {
  return {
    id,
    createdAt: "2026-05-21T00:00:00.000Z",
    category: "decision_heuristic",
    title,
    lesson: body,
    confidence,
    tags,
  };
}

describe("memory contradiction detection", () => {
  it("detects opposing guidance between lessons with shared tags", () => {
    const contradictions = detectLessonContradictions(
      [
        lesson("a", "Gate policy", "Always use deploy gates for production.", ["policy"]),
        lesson("b", "Gate policy", "Never use deploy gates for production.", ["policy"]),
      ],
      policy,
    );

    expect(contradictions.length).toBe(1);
    expect(contradictions[0]?.ruleId).toBe("always-never");
  });

  it("deprioritizes contradictory lessons in retrieval ranking", () => {
    const lessons = [
      lesson("stable", "Stable lesson", "Run policy gate before every deploy.", ["policy"], 0.95),
      lesson("conflict-a", "Conflict A", "Always approve hotfix deploys without rollback.", ["policy"], 0.95),
      lesson("conflict-b", "Conflict B", "Never approve hotfix deploys without rollback.", ["policy"], 0.95),
    ];
    const contradictions = detectLessonContradictions(lessons, policy);
    const penalties = buildContradictionPenalties(lessons, contradictions, policy);
    const ranked = rankLessonsForRetrieval(lessons, ["policy"], penalties, 3);

    const stable = ranked.find((item) => item.node.id === "stable");
    const conflictA = ranked.find((item) => item.node.id === "conflict-a");
    expect(stable?.contradictionPenalty ?? 1).toBe(0);
    expect((conflictA?.contradictionPenalty ?? 0) > 0).toBe(true);
    expect(stable?.effectiveScore ?? 0).toBeGreaterThan(conflictA?.effectiveScore ?? 0);
  });

  it("does not flag aligned lessons as contradictory", () => {
    const contradictions = detectLessonContradictions(
      [
        lesson("a", "Policy gate", "Always run policy gate before deploy.", ["policy"]),
        lesson("b", "Rollback gate", "Always run rollback checks after deploy.", ["policy"]),
      ],
      policy,
    );
    expect(contradictions.length).toBe(0);
  });
});
