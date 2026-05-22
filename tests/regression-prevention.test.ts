import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { buildEscalationReport, writeEscalationReport } from "../src/skills/execution/escalation-report.js";
import { evaluateRetryPolicy } from "../src/skills/execution/replan-loop.js";
import { routeEscalations } from "../src/supervisor/route-escalations.js";
import {
  buildRegressionRemediation,
  regressionPreventionIndexPath,
  resolveFailureClass,
  writeRegressionPreventionIndex,
} from "../src/verification/regression-prevention.js";
import { loadRegressionPreventionPolicy } from "../src/verification/regression-prevention-policy.js";
import type { ExecutionResult } from "../src/protocols/types.js";

describe("regression prevention", () => {
  it("maps execution and escalation reasons to taxonomy classes", async () => {
    const policy = await loadRegressionPreventionPolicy(process.cwd());
    expect(resolveFailureClass({ failureReason: "command_failed" })).toBe("execution.command_failed");
    expect(resolveFailureClass({ escalationReason: "cleanup_failed" })).toBe("execution.command_failed");
    const remediation = buildRegressionRemediation(policy, { failureReason: "acceptance_failed" });
    expect(remediation.failureClass).toBe("execution.acceptance_failed");
    expect(remediation.replanSuggestions.length).toBeGreaterThan(0);
  });

  it("enriches escalation artifacts with class-specific remediation", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-regression-root-"));
    const policy = await loadRegressionPreventionPolicy(process.cwd());
    await fs.ensureDir(path.join(rootDir, "docs", "operations"));
    await fs.writeJson(path.join(rootDir, "docs", "operations", "REGRESSION_PREVENTION_TEMPLATES.json"), policy, {
      spaces: 2,
    });
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
    const report = await buildEscalationReport(results, rootDir);
    expect(report.items[0]?.failureClass).toBe("execution.command_failed");
    expect(report.items[0]?.remediation.retryGuidance).toContain("worktree");
    await writeEscalationReport(rootDir, runDir, results);
    expect(await fs.pathExists(regressionPreventionIndexPath(rootDir))).toBe(true);
    const routed = await routeEscalations(rootDir);
    expect(routed.actionCount).toBe(1);
    const actions = await fs.readJson(path.join(rootDir, "artifacts", "execution", "SUPERVISOR_ACTIONS.json"));
    expect(actions.actions[0].failureClass).toBe("execution.command_failed");
    expect(actions.actions[0].remediation.replanSuggestions.length).toBeGreaterThan(0);
    await writeRegressionPreventionIndex(rootDir, policy);
    await fs.remove(rootDir);
  });

  it("uses class-specific retry hints when policy is provided", async () => {
    const policy = await loadRegressionPreventionPolicy(process.cwd());
    const baseTask = {
      id: "task-1",
      title: "Task one",
      description: "Task one description",
      mode: "AFK" as const,
      dependencies: [],
      acceptanceCriteria: ["done"],
      nfrTags: [],
      maxAttempts: 2,
      commands: [{ type: "shell" as const, command: "true" }],
      acceptanceChecks: [{ type: "shell" as const, command: "true" }],
    };
    const decision = evaluateRetryPolicy(baseTask, 1, "command_failed", policy);
    expect(decision.shouldRetry).toBe(true);
    expect(decision.hint).toContain("worktree");
    expect(decision.remediation?.failureClass).toBe("execution.command_failed");
  });
});
