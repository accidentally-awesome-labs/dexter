import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { generateClarificationCycle } from "../src/intake/clarification.js";
import { readClarificationLog, runClarificationGate } from "../src/intake/clarification-gate.js";
import { buildIntakeBrief } from "../src/intake/core.js";
import { normalizeFromCliPrompt } from "../src/intake/normalize.js";
import { processIntakeBrief } from "../src/intake/process-intake.js";

describe("intake clarification gate", () => {
  it("generates questions from ambiguity signals", () => {
    const brief = normalizeFromCliPrompt({
      project: "billing-api",
      idea: "Build something for production security maybe?",
      constraints: [],
      targetUsers: [],
    });

    const cycle = generateClarificationCycle(brief);
    expect(cycle.questions.length).toBeGreaterThan(0);
    expect(cycle.triggeringSignals.length).toBeGreaterThan(0);
    expect(cycle.status).toBe("pending_operator_response");
  });

  it("writes clarification log for ambiguous intake", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-clarify-"));
    const brief = buildIntakeBrief({
      sourceType: "cli-prompt",
      channel: "dexter-cli",
      request: {
        project: "billing-api",
        description: "Build something for production security maybe?",
        constraints: [],
        targetUsers: [],
        labels: [],
        acceptanceSignals: [],
      },
    });

    const gate = await runClarificationGate(rootDir, brief);
    expect(gate.passed).toBe(false);
    expect(gate.clarificationRequired).toBe(true);
    expect(gate.logPath).not.toBeNull();
    expect(await fs.pathExists(gate.logPath!)).toBe(true);
    expect(await fs.pathExists(gate.jsonPath!)).toBe(true);

    const saved = await readClarificationLog(rootDir);
    expect(saved?.cycleId).toBe(gate.cycle?.cycleId);
    expect(saved?.questions.length).toBeGreaterThan(0);
  });

  it("bypasses clarification for non-ambiguous intake", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-clarify-clear-"));
    const brief = normalizeFromCliPrompt({
      project: "billing-api",
      idea: "Build an internal billing API with audit logs, role-based access control, and integration tests for finance operations.",
      constraints: ["SOC2", "type-safe"],
      targetUsers: ["finance-ops"],
    });

    const gate = await runClarificationGate(rootDir, brief);
    expect(gate.passed).toBe(true);
    expect(gate.bypassed).toBe(true);
    expect(gate.logPath).toBeNull();
    expect(await fs.pathExists(path.join(rootDir, "artifacts", "intake", "CLARIFICATION_LOG.md"))).toBe(false);
  });

  it("clears stale clarification log when a later request bypasses", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-clarify-stale-"));
    const ambiguous = buildIntakeBrief({
      sourceType: "cli-prompt",
      channel: "dexter-cli",
      request: {
        project: "billing-api",
        description: "Build something for production security maybe?",
        constraints: [],
        targetUsers: [],
        labels: [],
        acceptanceSignals: [],
      },
    });
    await runClarificationGate(rootDir, ambiguous);
    expect(await fs.pathExists(path.join(rootDir, "artifacts", "intake", "CLARIFICATION_LOG.md"))).toBe(true);

    const clear = normalizeFromCliPrompt({
      project: "billing-api",
      idea: "Build an internal billing API with audit logs, role-based access control, and integration tests for finance operations.",
      constraints: ["SOC2"],
      targetUsers: ["finance-ops"],
    });
    const gate = await runClarificationGate(rootDir, clear);
    expect(gate.passed).toBe(true);
    expect(await fs.pathExists(path.join(rootDir, "artifacts", "intake", "CLARIFICATION_LOG.md"))).toBe(false);
  });

  it("processIntakeBrief writes brief and applies gate", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-process-intake-"));
    const brief = normalizeFromCliPrompt({
      project: "billing-api",
      idea: "Build an internal billing API with audit logs and finance operations integration tests.",
      constraints: ["SOC2"],
      targetUsers: ["finance-ops"],
    });

    const result = await processIntakeBrief(rootDir, brief);
    expect(await fs.pathExists(result.jsonPath)).toBe(true);
    expect(result.clarification.passed).toBe(true);
  });
});
