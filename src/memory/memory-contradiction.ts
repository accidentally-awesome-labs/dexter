import path from "node:path";
import fs from "fs-extra";
import type { LearningNode } from "./global-learning-graph.js";
import {
  loadMemoryContradictionPolicy,
  type MemoryContradictionPolicy,
} from "./memory-contradiction-policy.js";
import { rankLessonsWithQuality, writeMemoryQualityScorecard } from "./memory-quality.js";

export interface LessonContradiction {
  id: string;
  lessonAId: string;
  lessonBId: string;
  ruleId: string;
  reason: string;
  severity: number;
}

export interface ContradictionPenalty {
  lessonId: string;
  maxSeverity: number;
  effectiveConfidence: number;
  contradictedWith: string[];
}

export interface MemoryContradictionReport {
  schemaVersion: "1.0";
  generatedAt: string;
  lessonsScanned: number;
  contradictionCount: number;
  highSeverityCount: number;
  deprioritizedLessonIds: string[];
  contradictions: LessonContradiction[];
  penalties: ContradictionPenalty[];
}

export interface RetrievedLesson {
  node: LearningNode;
  retrievalScore: number;
  contradictionPenalty: number;
  effectiveConfidence: number;
  effectiveScore: number;
  freshnessFactor: number;
  stale: boolean;
  contradictedWith: string[];
}

export function memoryContradictionJsonPath(rootDir: string): string {
  return path.join(rootDir, "global-memory", "MEMORY_CONTRADICTION_REPORT.json");
}

export function memoryContradictionMarkdownPath(rootDir: string): string {
  return path.join(rootDir, "global-memory", "MEMORY_CONTRADICTION_REPORT.md");
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ");
}

function containsPhrase(text: string, phrase: string): boolean {
  return normalizeText(text).includes(normalizeText(phrase));
}

function tagOverlap(left: LearningNode, right: LearningNode): number {
  return left.tags.filter((tag) => right.tags.includes(tag)).length;
}

function shouldCompare(left: LearningNode, right: LearningNode, policy: MemoryContradictionPolicy): boolean {
  if (left.id === right.id) {
    return false;
  }
  if (policy.requireCategoryMatch && left.category !== right.category) {
    return false;
  }
  return tagOverlap(left, right) >= policy.minTagOverlap;
}

export function detectLessonContradictions(
  lessons: LearningNode[],
  policy: MemoryContradictionPolicy,
): LessonContradiction[] {
  const contradictions: LessonContradiction[] = [];

  for (let i = 0; i < lessons.length; i += 1) {
    for (let j = i + 1; j < lessons.length; j += 1) {
      const left = lessons[i];
      const right = lessons[j];
      if (!shouldCompare(left, right, policy)) {
        continue;
      }

      const combinedA = `${left.title} ${left.lesson}`;
      const combinedB = `${right.title} ${right.lesson}`;

      for (const pair of policy.contradictionPairs) {
        const aHasLeft = containsPhrase(combinedA, pair.left);
        const aHasRight = containsPhrase(combinedA, pair.right);
        const bHasLeft = containsPhrase(combinedB, pair.left);
        const bHasRight = containsPhrase(combinedB, pair.right);

        if ((aHasLeft && bHasRight) || (aHasRight && bHasLeft)) {
          contradictions.push({
            id: `${left.id}:${right.id}:${pair.id}`,
            lessonAId: left.id,
            lessonBId: right.id,
            ruleId: pair.id,
            reason: `Contradiction (${pair.id}) between "${left.title}" and "${right.title}".`,
            severity: 0.8,
          });
          break;
        }
      }
    }
  }

  return contradictions.sort((a, b) => b.severity - a.severity || a.id.localeCompare(b.id));
}

export function buildContradictionPenalties(
  lessons: LearningNode[],
  contradictions: LessonContradiction[],
  policy: MemoryContradictionPolicy,
): ContradictionPenalty[] {
  const byLesson = new Map<string, { maxSeverity: number; contradictedWith: Set<string> }>();

  for (const lesson of lessons) {
    byLesson.set(lesson.id, { maxSeverity: 0, contradictedWith: new Set() });
  }

  for (const contradiction of contradictions) {
    for (const lessonId of [contradiction.lessonAId, contradiction.lessonBId]) {
      const entry = byLesson.get(lessonId);
      if (!entry) {
        continue;
      }
      entry.maxSeverity = Math.max(entry.maxSeverity, contradiction.severity);
      const otherId = lessonId === contradiction.lessonAId ? contradiction.lessonBId : contradiction.lessonAId;
      entry.contradictedWith.add(otherId);
    }
  }

  return lessons.map((lesson) => {
    const entry = byLesson.get(lesson.id) ?? { maxSeverity: 0, contradictedWith: new Set<string>() };
    const penalty = Math.round(entry.maxSeverity * policy.deprioritizePenaltyWeight * 1000) / 1000;
    const effectiveConfidence = Math.max(0.05, Math.round(lesson.confidence * (1 - penalty) * 1000) / 1000);
    return {
      lessonId: lesson.id,
      maxSeverity: entry.maxSeverity,
      effectiveConfidence,
      contradictedWith: [...entry.contradictedWith].sort(),
    };
  });
}

export function rankLessonsForRetrieval(
  lessons: LearningNode[],
  tags: string[],
  penalties: ContradictionPenalty[],
  limit: number,
): RetrievedLesson[] {
  const penaltyById = new Map(penalties.map((item) => [item.lessonId, item]));

  const ranked = lessons
    .map((node) => {
      const penalty = penaltyById.get(node.id);
      const overlap = node.tags.filter((tag) => tags.includes(tag)).length;
      const contradictionPenalty = Math.round((penalty?.maxSeverity ?? 0) * 0.5 * 1000) / 1000;
      const effectiveConfidence = penalty?.effectiveConfidence ?? node.confidence;
      const retrievalScore = overlap * 2 + node.confidence;
      const effectiveScore = overlap * 2 + effectiveConfidence;
      return {
        node,
        retrievalScore,
        contradictionPenalty,
        effectiveConfidence,
        effectiveScore,
        freshnessFactor: 1,
        stale: false,
        contradictedWith: penalty?.contradictedWith ?? [],
      };
    })
    .sort((left, right) => right.effectiveScore - left.effectiveScore || right.retrievalScore - left.retrievalScore);

  return ranked.slice(0, limit);
}

export function buildMemoryContradictionReport(
  lessons: LearningNode[],
  contradictions: LessonContradiction[],
  penalties: ContradictionPenalty[],
  policy: MemoryContradictionPolicy,
  generatedAt = new Date().toISOString(),
): MemoryContradictionReport {
  const deprioritizedLessonIds = penalties
    .filter((item) => item.maxSeverity >= policy.highSeverityThreshold)
    .map((item) => item.lessonId)
    .sort();

  return {
    schemaVersion: "1.0",
    generatedAt,
    lessonsScanned: lessons.length,
    contradictionCount: contradictions.length,
    highSeverityCount: contradictions.filter((item) => item.severity >= policy.highSeverityThreshold).length,
    deprioritizedLessonIds,
    contradictions,
    penalties,
  };
}

export function renderMemoryContradictionMarkdown(report: MemoryContradictionReport): string {
  return [
    "# Memory Contradiction Report",
    "",
    `Generated at: ${report.generatedAt}`,
    `Lessons scanned: ${report.lessonsScanned}`,
    `Contradictions: ${report.contradictionCount}`,
    `High severity: ${report.highSeverityCount}`,
    `Deprioritized lessons: ${report.deprioritizedLessonIds.length}`,
    "",
    "## Contradictions",
    "",
    ...(report.contradictions.length === 0
      ? ["- None detected"]
      : report.contradictions.map(
          (item) =>
            `- [${item.severity}] ${item.lessonAId} vs ${item.lessonBId} (${item.ruleId}) — ${item.reason}`,
        )),
    "",
    "## Deprioritized Lessons",
    "",
    ...(report.deprioritizedLessonIds.length === 0
      ? ["- None"]
      : report.deprioritizedLessonIds.map((id) => {
          const penalty = report.penalties.find((item) => item.lessonId === id);
          return `- ${id} — effectiveConfidence ${penalty?.effectiveConfidence ?? "n/a"}`;
        })),
    "",
  ].join("\n");
}

export async function analyzeMemoryContradictions(
  rootDir: string,
  lessons: LearningNode[],
): Promise<MemoryContradictionReport> {
  const policy = await loadMemoryContradictionPolicy(rootDir);
  const contradictions = detectLessonContradictions(lessons, policy);
  const penalties = buildContradictionPenalties(lessons, contradictions, policy);
  const report = buildMemoryContradictionReport(lessons, contradictions, penalties, policy);
  await fs.ensureDir(path.join(rootDir, "global-memory"));
  await fs.writeJson(memoryContradictionJsonPath(rootDir), report, { spaces: 2 });
  await fs.writeFile(memoryContradictionMarkdownPath(rootDir), renderMemoryContradictionMarkdown(report));
  return report;
}

export async function retrieveLessonsForPlanning(
  rootDir: string,
  tags: string[],
  limit = 5,
): Promise<{ lessons: RetrievedLesson[]; report: MemoryContradictionReport }> {
  const graphPath = path.join(rootDir, "global-memory", "graph.json");
  const lessons: LearningNode[] = (await fs.pathExists(graphPath))
    ? ((await fs.readJson(graphPath)) as LearningNode[])
    : [];
  const report = await analyzeMemoryContradictions(rootDir, lessons);
  const scorecard = await writeMemoryQualityScorecard(rootDir, lessons, report.penalties);
  const penaltyById = new Map(report.penalties.map((item) => [item.lessonId, item]));
  const ranked = rankLessonsWithQuality(lessons, tags, scorecard.lessons, limit);
  return {
    lessons: ranked.map((item) => {
      const penalty = penaltyById.get(item.node.id);
      return {
        node: item.node,
        retrievalScore: item.retrievalScore,
        contradictionPenalty: Math.round((penalty?.maxSeverity ?? 0) * 0.5 * 1000) / 1000,
        effectiveConfidence: item.effectiveConfidence,
        effectiveScore: item.effectiveScore,
        freshnessFactor: item.freshnessFactor,
        stale: item.stale,
        contradictedWith: penalty?.contradictedWith ?? [],
      };
    }),
    report,
  };
}
