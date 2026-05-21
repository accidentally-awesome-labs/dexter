import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it, vi } from "vitest";
import {
  evaluateSloRollbackTriggers,
  executePromotionRollback,
  loadSloThresholds,
  simulatedBreachMetrics,
  writeSloRollbackArtifact,
} from "../src/operations/slo-rollback.js";
import type { ControlPlaneAdapter } from "../src/runtime/control-plane.js";

async function seedPolicy(rootDir: string) {
  await fs.ensureDir(path.join(rootDir, "docs", "operations"));
  await fs.copy(
    path.join(process.cwd(), "docs", "operations", "CANARY_SLO_POLICY.json"),
    path.join(rootDir, "docs", "operations", "CANARY_SLO_POLICY.json"),
  );
}

describe("slo rollback", () => {
  it("detects error-rate breach", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-slo-rollback-"));
    await seedPolicy(rootDir);
    const policy = await loadSloThresholds(rootDir);
    const evaluation = evaluateSloRollbackTriggers(simulatedBreachMetrics("error-rate"), policy);
    expect(evaluation.triggered).toBe(true);
    expect(evaluation.triggers.some((item) => item.trigger === "error_rate_breach")).toBe(true);
  });

  it("detects latency breach", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-slo-rollback2-"));
    await seedPolicy(rootDir);
    const policy = await loadSloThresholds(rootDir);
    const evaluation = evaluateSloRollbackTriggers(simulatedBreachMetrics("latency"), policy);
    expect(evaluation.triggered).toBe(true);
    expect(evaluation.triggers.some((item) => item.trigger === "latency_breach")).toBe(true);
  });

  it("executes rollback through control-plane adapter", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-slo-rollback3-"));
    await seedPolicy(rootDir);
    const adapter: ControlPlaneAdapter = {
      id: "coolify",
      deploy: vi.fn(),
      rollback: vi.fn().mockResolvedValue({
        rollbackId: "rollback-123",
        status: "ok",
        mode: "api",
      }),
    };
    const policy = await loadSloThresholds(rootDir);
    const evaluation = evaluateSloRollbackTriggers(simulatedBreachMetrics("error-rate"), policy);
    const execution = await executePromotionRollback({
      rootDir,
      adapter,
      appName: "dexter",
      environment: "staging",
      actor: "tester",
      reason: "error_rate_breach",
      triggers: evaluation.triggers,
    });
    expect(execution.rollbackId).toBe("rollback-123");
    expect(adapter.rollback).toHaveBeenCalledWith("dexter");

    const artifact = await writeSloRollbackArtifact(rootDir, {
      generatedAt: new Date().toISOString(),
      environment: "staging",
      appName: "dexter",
      execution,
      evaluation,
    });
    expect(await fs.pathExists(artifact.jsonPath)).toBe(true);
    const saved = await fs.readJson(artifact.jsonPath);
    expect(saved.execution.rollbackId).toBe("rollback-123");
  });
});
