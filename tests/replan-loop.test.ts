import { describe, expect, it } from "vitest";
import { evaluateRetryPolicy } from "../src/skills/execution/replan-loop.js";
import type { TaskSpec } from "../src/protocols/types.js";

const baseTask: TaskSpec = {
  id: "task-1",
  title: "Task one",
  description: "Task one description",
  mode: "AFK",
  dependencies: [],
  acceptanceCriteria: ["done"],
  nfrTags: [],
  maxAttempts: 2,
  commands: [{ type: "shell", command: "true" }],
  acceptanceChecks: [{ type: "shell", command: "true" }],
};

describe("replan retry policy", () => {
  it("retries command failures within budget", () => {
    const decision = evaluateRetryPolicy(baseTask, 1, "command_failed");
    expect(decision.shouldRetry).toBe(true);
    expect(decision.escalation.required).toBe(false);
    expect(decision.escalation.target).toBe("none");
  });

  it("escalates cleanup failures immediately", () => {
    const decision = evaluateRetryPolicy(baseTask, 1, "cleanup_failed");
    expect(decision.shouldRetry).toBe(false);
    expect(decision.escalation.required).toBe(true);
    expect(decision.escalation.target).toBe("operator");
  });

  it("escalates exhausted acceptance failures", () => {
    const decision = evaluateRetryPolicy(baseTask, 2, "acceptance_failed");
    expect(decision.shouldRetry).toBe(false);
    expect(decision.escalation.required).toBe(true);
    expect(decision.escalation.target).toBe("planner");
  });
});
