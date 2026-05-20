import { describe, expect, it } from "vitest";
import type { TaskSpec } from "../src/protocols/types.js";
import { topologicallySortTasks, validateTaskGraph } from "../src/skills/planning/graph-validator.js";

const baseTasks: TaskSpec[] = [
  {
    id: "a",
    title: "A",
    description: "a",
    mode: "AFK",
    dependencies: [],
    acceptanceCriteria: ["x"],
    nfrTags: [],
  },
  {
    id: "b",
    title: "B",
    description: "b",
    mode: "AFK",
    dependencies: ["a"],
    acceptanceCriteria: ["x"],
    nfrTags: [],
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
      { ...baseTasks[0], dependencies: ["b"] },
      { ...baseTasks[1], dependencies: ["a"] },
    ];
    const result = validateTaskGraph(cyclic);
    expect(result.valid).toBe(false);
    expect(result.errors.some((item) => item.includes("cycle"))).toBe(true);
  });

  it("sorts tasks topologically", () => {
    const ordered = topologicallySortTasks([baseTasks[1], baseTasks[0]]);
    expect(ordered.map((task) => task.id)).toEqual(["a", "b"]);
  });
});
