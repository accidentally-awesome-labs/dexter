import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { buildEscalationReport, writeEscalationReport } from "../src/skills/execution/escalation-report.js";
import type { ExecutionResult } from "../src/protocols/types.js";

describe("escalation report", () => {
  it("includes only required escalations", () => {
    const results: ExecutionResult[] = [
      {
        taskId: "t1",
        status: "failed",
        failureReason: "backend_unavailable",
        escalation: {
          required: true,
          target: "operator",
          reason: "backend_unavailable",
          action: "Configure backend",
        },
        logs: [],
        regressionsGenerated: [],
        attempts: 1,
      },
      {
        taskId: "t2",
        status: "skipped",
        failureReason: "dependency_blocked",
        escalation: {
          required: false,
          target: "none",
          reason: "dependency_blocked",
          action: "wait",
        },
        logs: [],
        regressionsGenerated: [],
      },
      {
        taskId: "t3",
        status: "failed",
        failureReason: "acceptance_failed",
        escalation: {
          required: true,
          target: "planner",
          reason: "retry_budget_exhausted",
          action: "replan",
        },
        logs: [],
        regressionsGenerated: [],
        attempts: 2,
      },
    ];
    const report = buildEscalationReport(results);
    expect(report.totalTasks).toBe(3);
    expect(report.requiredEscalations).toBe(2);
    expect(report.requiredByTarget.operator).toBe(1);
    expect(report.requiredByTarget.planner).toBe(1);
    expect(report.items.map((item) => item.taskId)).toEqual(["t1", "t3"]);
  });

  it("writes escalation artifacts for supervisor handoff", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-escalations-root-"));
    const runDir = path.join(rootDir, "runs", "test");
    await fs.ensureDir(runDir);
    const results: ExecutionResult[] = [
      {
        taskId: "t1",
        status: "failed",
        failureReason: "command_failed",
        escalation: {
          required: true,
          target: "planner",
          reason: "retry_budget_exhausted",
          action: "replan task",
        },
        logs: [],
        regressionsGenerated: [],
        attempts: 2,
      },
    ];
    const out = await writeEscalationReport(rootDir, runDir, results);
    expect(out.requiredEscalations).toBe(1);
    expect(await fs.pathExists(out.jsonPath)).toBe(true);
    expect(await fs.pathExists(out.markdownPath)).toBe(true);
    expect(await fs.pathExists(out.runPath)).toBe(true);
    await fs.remove(rootDir);
  });
});
