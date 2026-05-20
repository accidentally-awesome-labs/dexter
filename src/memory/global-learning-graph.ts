import path from "node:path";
import fs from "fs-extra";
import { randomUUID } from "node:crypto";

export interface LearningNode {
  id: string;
  category: "failure_pattern" | "successful_fix" | "decision_heuristic" | "rejected_approach";
  title: string;
  lesson: string;
  confidence: number;
  createdAt: string;
  tags: string[];
}

const graphPath = (rootDir: string) => path.join(rootDir, "global-memory", "graph.json");

const redactPatterns: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: "[REDACTED_AWS_KEY]" },
  { pattern: /\bsk-[A-Za-z0-9]{20,}\b/g, replacement: "[REDACTED_API_KEY]" },
  { pattern: /\b(?:\d[ -]*?){13,19}\b/g, replacement: "[REDACTED_PAN]" },
  {
    pattern:
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replacement: "[REDACTED_EMAIL]",
  },
];

export function sanitizeLearningText(input: string): string {
  return redactPatterns.reduce(
    (sanitized, { pattern, replacement }) => sanitized.replace(pattern, replacement),
    input,
  );
}

function clampConfidence(confidence: number): number {
  return Math.max(0, Math.min(1, Number(confidence.toFixed(3))));
}

export async function addLearning(rootDir: string, node: Omit<LearningNode, "id" | "createdAt">) {
  const file = graphPath(rootDir);
  await fs.ensureDir(path.dirname(file));

  const current: LearningNode[] = (await fs.pathExists(file))
    ? ((await fs.readJson(file)) as LearningNode[])
    : [];

  const nextNode: LearningNode = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    category: node.category,
    title: sanitizeLearningText(node.title),
    lesson: sanitizeLearningText(node.lesson),
    confidence: clampConfidence(node.confidence),
    tags: node.tags.map((tag) => sanitizeLearningText(tag)),
  };
  current.push(nextNode);

  await fs.writeJson(file, current, { spaces: 2 });
  return nextNode;
}

export async function retrieveLessons(rootDir: string, tags: string[], limit = 5): Promise<LearningNode[]> {
  const file = graphPath(rootDir);
  if (!(await fs.pathExists(file))) {
    return [];
  }

  const data = (await fs.readJson(file)) as LearningNode[];
  const score = (node: LearningNode) => {
    const overlap = node.tags.filter((t) => tags.includes(t)).length;
    return overlap * 2 + node.confidence;
  };

  return data
    .sort((a, b) => score(b) - score(a))
    .slice(0, limit);
}
