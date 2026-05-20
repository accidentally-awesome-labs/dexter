import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { addLearning, sanitizeLearningText } from "../src/memory/global-learning-graph.js";

describe("global memory sanitization", () => {
  it("redacts secret and pii patterns", () => {
    const raw =
      "Contact john@example.com with key sk-1234567890abcdefghijklmnop and aws AKIAABCDEFGHIJKLMNOP card 4111 1111 1111 1111";
    const sanitized = sanitizeLearningText(raw);
    expect(sanitized).not.toContain("john@example.com");
    expect(sanitized).not.toContain("AKIAABCDEFGHIJKLMNOP");
    expect(sanitized).not.toContain("sk-1234567890abcdefghijklmnop");
    expect(sanitized).toContain("[REDACTED_EMAIL]");
    expect(sanitized).toContain("[REDACTED_API_KEY]");
    expect(sanitized).toContain("[REDACTED_AWS_KEY]");
    expect(sanitized).toContain("[REDACTED_PAN]");
  });

  it("stores sanitized nodes in graph", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-memory-"));
    await addLearning(rootDir, {
      category: "successful_fix",
      title: "Rotate sk-abcdef123456789012345678901234",
      lesson: "Notify admin@example.com about AKIAABCDEFGHIJKLMNOP",
      confidence: 1.8,
      tags: ["owner:dev@example.com"],
    });

    const graph = (await fs.readJson(path.join(rootDir, "global-memory", "graph.json"))) as Array<{
      title: string;
      lesson: string;
      confidence: number;
      tags: string[];
    }>;

    expect(graph[0].title).toContain("[REDACTED_API_KEY]");
    expect(graph[0].lesson).toContain("[REDACTED_EMAIL]");
    expect(graph[0].lesson).toContain("[REDACTED_AWS_KEY]");
    expect(graph[0].confidence).toBe(1);
    expect(graph[0].tags[0]).toContain("[REDACTED_EMAIL]");
  });
});
