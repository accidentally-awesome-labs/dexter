import { describe, expect, it } from "vitest";
import type { LearningNode } from "../src/memory/global-learning-graph.js";
import {
  buildLessonQualityScores,
  buildMemoryQualityScorecard,
  computeFreshnessFactor,
  rankLessonsWithQuality,
} from "../src/memory/memory-quality.js";
import type { MemoryQualityPolicy } from "../src/memory/memory-quality-policy.js";

const policy: MemoryQualityPolicy = {
  schemaVersion: "1.0",
  freshnessHalfLifeDays: 30,
  minFreshnessFactor: 0.2,
  staleAfterDays: 90,
  lowConfidenceThreshold: 0.5,
  maxLessonsInScorecard: 100,
};

function lesson(id: string, createdAt: string, confidence = 0.9): LearningNode {
  return {
    id,
    createdAt,
    category: "decision_heuristic",
    title: `Lesson ${id}`,
    lesson: `Lesson body ${id}`,
    confidence,
    tags: ["policy"],
  };
}

describe("memory quality and stale decay", () => {
  it("reduces freshness factor as lessons age", () => {
    const fresh = computeFreshnessFactor(0, policy);
    const mid = computeFreshnessFactor(30, policy);
    const old = computeFreshnessFactor(120, policy);
    expect(fresh).toBe(1);
    expect(mid).toBeCloseTo(0.5, 2);
    expect(old).toBe(policy.minFreshnessFactor);
  });

  it("marks old lessons stale and lowers influence score", () => {
    const now = Date.parse("2026-05-21T00:00:00.000Z");
    const scores = buildLessonQualityScores(
      [
        lesson("new", "2026-05-20T00:00:00.000Z", 0.9),
        lesson("old", "2025-12-01T00:00:00.000Z", 0.9),
      ],
      [],
      policy,
      now,
    );
    const fresh = scores.find((item) => item.lessonId === "new");
    const stale = scores.find((item) => item.lessonId === "old");
    expect(stale?.stale).toBe(true);
    expect(fresh?.stale).toBe(false);
    expect(fresh?.influenceScore ?? 0).toBeGreaterThan(stale?.influenceScore ?? 0);
  });

  it("prefers fresh lessons over stale lessons during retrieval ranking", () => {
    const lessons = [
      lesson("new", "2026-05-20T00:00:00.000Z", 0.85),
      lesson("old", "2025-01-01T00:00:00.000Z", 0.95),
    ];
    const scores = buildLessonQualityScores(lessons, [], policy, Date.parse("2026-05-21T00:00:00.000Z"));
    const ranked = rankLessonsWithQuality(lessons, ["policy"], scores, 2);
    expect(ranked[0]?.node.id).toBe("new");
    expect(ranked[1]?.stale).toBe(true);
  });

  it("builds scorecard summary metrics", () => {
    const scores = buildLessonQualityScores(
      [lesson("a", "2026-05-20T00:00:00.000Z"), lesson("b", "2024-01-01T00:00:00.000Z")],
      [],
      policy,
      Date.parse("2026-05-21T00:00:00.000Z"),
    );
    const scorecard = buildMemoryQualityScorecard(scores);
    expect(scorecard.totalLessons).toBe(2);
    expect(scorecard.staleLessonCount).toBeGreaterThan(0);
    expect(scorecard.averageFreshnessFactor).toBeGreaterThan(0);
  });
});
