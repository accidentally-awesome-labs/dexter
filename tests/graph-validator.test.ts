import { describe, expect, it } from "vitest";
import type { TaskSpec } from "../src/protocols/types.js";
import { topologicallySortTasks, validateTaskGraph } from "../src/skills/planning/graph-validator.js";

const baseTasks: TaskSpec[] = [
  {
    id: "ta",
    title: "Task A",
    description: "Task A description",
    mode: "AFK",
    dependencies: [],
    acceptanceCriteria: ["x"],
    nfrTags: [],
    maxAttempts: 2,
    commands: [{ type: "shell", command: "true" }],
    acceptanceChecks: [{ type: "shell", command: "true" }],
  },
  {
    id: "tb",
    title: "Task B",
    description: "Task B description",
    mode: "AFK",
    dependencies: ["ta"],
    acceptanceCriteria: ["x"],
    nfrTags: [],
    maxAttempts: 2,
    commands: [{ type: "shell", command: "true" }],
    acceptanceChecks: [{ type: "shell", command: "true" }],
  },
];

describe("graph validator", () => {
  it("accepts valid DAG", () => {
    const result = validateTaskGraph(baseTasks);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects cyclic graph", () => {
    const cyclic: TaskSpec[] = [
      { ...baseTasks[0], dependencies: ["tb"] },
      { ...baseTasks[1], dependencies: ["ta"] },
    ];
    const result = validateTaskGraph(cyclic);
    expect(result.valid).toBe(false);
    expect(result.errors.some((item) => item.includes("cycle"))).toBe(true);
  });

  it("sorts tasks topologically", () => {
    const ordered = topologicallySortTasks([baseTasks[1], baseTasks[0]]);
    expect(ordered.map((task) => task.id)).toEqual(["ta", "tb"]);
  });

  it("rejects AFK tasks missing execution contract", () => {
    const invalid: TaskSpec[] = [
      {
        ...baseTasks[0],
        id: "invalid-afk",
        maxAttempts: undefined,
        commands: [],
        acceptanceChecks: [],
      },
    ];
    const result = validateTaskGraph(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((item) => item.includes("AFK tasks must define maxAttempts"))).toBe(true);
    expect(result.errors.some((item) => item.includes("AFK tasks must define at least one command"))).toBe(true);
    expect(result.errors.some((item) => item.includes("AFK tasks must define at least one acceptance check"))).toBe(
      true,
    );
  });
});
