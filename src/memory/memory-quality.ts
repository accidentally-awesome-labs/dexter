import path from "node:path";
import fs from "fs-extra";
import type { LearningNode } from "./global-learning-graph.js";
import type { ContradictionPenalty } from "./memory-contradiction.js";
import { loadMemoryQualityPolicy, type MemoryQualityPolicy } from "./memory-quality-policy.js";

export interface LessonQualityScore {
  lessonId: string;
  title: string;
  category: LearningNode["category"];
  createdAt: string;
  ageDays: number;
  rawConfidence: number;
  freshnessFactor: number;
  contradictionPenalty: number;
  effectiveConfidence: number;
  influenceScore: number;
  stale: boolean;
  lowConfidence: boolean;
}

export interface MemoryQualityScorecard {
  schemaVersion: "1.0";
  generatedAt: string;
  totalLessons: number;
  staleLessonCount: number;
  lowConfidenceCount: number;
  averageFreshnessFactor: number;
  averageInfluenceScore: number;
  lessons: LessonQualityScore[];
}

export function memoryQualityScorecardJsonPath(rootDir: string): string {
  return path.join(rootDir, "global-memory", "MEMORY_QUALITY_SCORECARD.json");
}

export function memoryQualityScorecardMarkdownPath(rootDir: string): string {
  return path.join(rootDir, "global-memory", "MEMORY_QUALITY_SCORECARD.md");
}

export function computeAgeDays(createdAt: string, now = Date.now()): number {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) {
    return 0;
  }
  return Math.max(0, Math.round((now - created) / 86_400_000));
}

export function computeFreshnessFactor(ageDays: number, policy: MemoryQualityPolicy): number {
  const decay = 0.5 ** (ageDays / policy.freshnessHalfLifeDays);
  return Math.max(policy.minFreshnessFactor, Math.round(decay * 1000) / 1000);
}

export function buildLessonQualityScores(
  lessons: LearningNode[],
  penalties: ContradictionPenalty[],
  policy: MemoryQualityPolicy,
  now = Date.now(),
): LessonQualityScore[] {
  const penaltyById = new Map(penalties.map((item) => [item.lessonId, item]));

  return lessons
    .map((lesson) => {
      const penalty = penaltyById.get(lesson.id);
      const ageDays = computeAgeDays(lesson.createdAt, now);
      const freshnessFactor = computeFreshnessFactor(ageDays, policy);
      const afterContradiction =
        penalty?.effectiveConfidence ?? Math.max(0.05, lesson.confidence * (1 - (penalty?.maxSeverity ?? 0) * 0.5));
      const effectiveConfidence = Math.round(afterContradiction * freshnessFactor * 1000) / 1000;
      const influenceScore = effectiveConfidence;
      const stale = ageDays >= policy.staleAfterDays || freshnessFactor <= policy.minFreshnessFactor + 0.01;
      const lowConfidence = lesson.confidence < policy.lowConfidenceThreshold;

      return {
        lessonId: lesson.id,
        title: lesson.title,
        category: lesson.category,
        createdAt: lesson.createdAt,
        ageDays,
        rawConfidence: lesson.confidence,
        freshnessFactor,
        contradictionPenalty: Math.round((penalty?.maxSeverity ?? 0) * 0.5 * 1000) / 1000,
        effectiveConfidence,
        influenceScore,
        stale,
        lowConfidence,
      };
    })
    .sort((left, right) => right.influenceScore - left.influenceScore || left.lessonId.localeCompare(right.lessonId));
}

export function buildMemoryQualityScorecard(
  scores: LessonQualityScore[],
  generatedAt = new Date().toISOString(),
): MemoryQualityScorecard {
  const total = scores.length;
  const staleLessonCount = scores.filter((item) => item.stale).length;
  const lowConfidenceCount = scores.filter((item) => item.lowConfidence).length;
  const averageFreshnessFactor =
    total === 0
      ? 0
      : Math.round((scores.reduce((sum, item) => sum + item.freshnessFactor, 0) / total) * 1000) / 1000;
  const averageInfluenceScore =
    total === 0
      ? 0
      : Math.round((scores.reduce((sum, item) => sum + item.influenceScore, 0) / total) * 1000) / 1000;

  return {
    schemaVersion: "1.0",
    generatedAt,
    totalLessons: total,
    staleLessonCount,
    lowConfidenceCount,
    averageFreshnessFactor,
    averageInfluenceScore,
    lessons: scores,
  };
}

export function renderMemoryQualityScorecardMarkdown(scorecard: MemoryQualityScorecard): string {
  const top = scorecard.lessons.slice(0, 15);
  const stale = scorecard.lessons.filter((item) => item.stale).slice(0, 15);

  return [
    "# Memory Quality Scorecard",
    "",
    `Generated at: ${scorecard.generatedAt}`,
    `Total lessons: ${scorecard.totalLessons}`,
    `Stale lessons: ${scorecard.staleLessonCount}`,
    `Low confidence lessons: ${scorecard.lowConfidenceCount}`,
    `Average freshness factor: ${scorecard.averageFreshnessFactor}`,
    `Average influence score: ${scorecard.averageInfluenceScore}`,
    "",
    "## Top Influence Lessons",
    "",
    "| Lesson | Age (days) | Freshness | Effective confidence | Stale |",
    "| --- | ---: | ---: | ---: | --- |",
    ...top.map(
      (item) =>
        `| ${item.title} | ${item.ageDays} | ${item.freshnessFactor} | ${item.effectiveConfidence} | ${item.stale ? "yes" : "no"} |`,
    ),
    "",
    "## Stale Lessons",
    "",
    ...(stale.length === 0
      ? ["- None"]
      : stale.map(
          (item) =>
            `- ${item.title} (${item.lessonId}) — age ${item.ageDays}d, freshness ${item.freshnessFactor}, influence ${item.influenceScore}`,
        )),
    "",
  ].join("\n");
}

export async function writeMemoryQualityScorecard(
  rootDir: string,
  lessons: LearningNode[],
  penalties: ContradictionPenalty[],
): Promise<MemoryQualityScorecard> {
  const policy = await loadMemoryQualityPolicy(rootDir);
  const scores = buildLessonQualityScores(lessons, penalties, policy).slice(0, policy.maxLessonsInScorecard);
  const scorecard = buildMemoryQualityScorecard(scores);
  await fs.ensureDir(path.join(rootDir, "global-memory"));
  await fs.writeJson(memoryQualityScorecardJsonPath(rootDir), scorecard, { spaces: 2 });
  await fs.writeFile(memoryQualityScorecardMarkdownPath(rootDir), renderMemoryQualityScorecardMarkdown(scorecard));
  return scorecard;
}

export function rankLessonsWithQuality(
  lessons: LearningNode[],
  tags: string[],
  scores: LessonQualityScore[],
  limit: number,
): Array<{
  node: LearningNode;
  retrievalScore: number;
  effectiveScore: number;
  freshnessFactor: number;
  effectiveConfidence: number;
  stale: boolean;
}> {
  const scoreById = new Map(scores.map((item) => [item.lessonId, item]));

  return lessons
    .map((node) => {
      const quality = scoreById.get(node.id);
      const overlap = node.tags.filter((tag) => tags.includes(tag)).length;
      const retrievalScore = overlap * 2 + node.confidence;
      const effectiveConfidence = quality?.effectiveConfidence ?? node.confidence;
      const effectiveScore = overlap * 2 + effectiveConfidence;
      return {
        node,
        retrievalScore,
        effectiveScore,
        freshnessFactor: quality?.freshnessFactor ?? 1,
        effectiveConfidence,
        stale: quality?.stale ?? false,
      };
    })
    .sort((left, right) => right.effectiveScore - left.effectiveScore || right.retrievalScore - left.retrievalScore)
    .slice(0, limit);
}
