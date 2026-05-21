import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import {
  evaluatePilotBatch,
  loadPilotRequests,
  processPilotRequest,
  runIntakePilotBatch,
} from "../src/intake/pilot-batch.js";

describe("intake pilot batch", () => {
  it("evaluates auto-decomposition and HITL compliance", () => {
    const evaluation = evaluatePilotBatch([
      {
        requestId: "a",
        project: "p1",
        completed: true,
        highRisk: true,
        clarificationRequired: false,
        allTasksRoutedHitl: true,
        autoDecomposed: true,
        manualTaskDecompositionOverride: false,
        manualInterventions: [],
      },
      {
        requestId: "b",
        project: "p2",
        completed: true,
        highRisk: false,
        clarificationRequired: false,
        allTasksRoutedHitl: false,
        autoDecomposed: true,
        manualTaskDecompositionOverride: false,
        manualInterventions: [],
      },
      {
        requestId: "c",
        project: "p3",
        completed: true,
        highRisk: false,
        clarificationRequired: true,
        allTasksRoutedHitl: false,
        autoDecomposed: true,
        manualTaskDecompositionOverride: false,
        manualInterventions: [{ type: "clarification_bypassed", details: "bypassed" }],
      },
      {
        requestId: "d",
        project: "p4",
        completed: true,
        highRisk: false,
        clarificationRequired: false,
        allTasksRoutedHitl: false,
        autoDecomposed: true,
        manualTaskDecompositionOverride: false,
        manualInterventions: [],
      },
      {
        requestId: "e",
        project: "p5",
        completed: false,
        highRisk: false,
        clarificationRequired: true,
        allTasksRoutedHitl: false,
        autoDecomposed: false,
        manualTaskDecompositionOverride: true,
        manualInterventions: [],
      },
    ]);

    expect(evaluation.autoDecompositionRate).toBe(0.8);
    expect(evaluation.autoDecompositionPassed).toBe(true);
    expect(evaluation.highRiskHitlPassed).toBe(true);
    expect(evaluation.passed).toBe(false);
  });

  it("processes catalog requests through intake and planning", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-pilot-batch-"));
    await fs.ensureDir(path.join(rootDir, "docs", "operations"));
    await fs.copy(
      path.join(process.cwd(), "docs", "operations", "INTAKE_PILOT_REQUESTS.json"),
      path.join(rootDir, "docs", "operations", "INTAKE_PILOT_REQUESTS.json"),
    );
    const catalog = await loadPilotRequests(rootDir);
    expect(catalog.length).toBeGreaterThanOrEqual(10);

    const copiedCatalogRoot = rootDir;
    await fs.copy(
      path.join(process.cwd(), "docs", "operations", "INTAKE_AMBIGUITY_POLICY.json"),
      path.join(copiedCatalogRoot, "docs", "operations", "INTAKE_AMBIGUITY_POLICY.json"),
    );
    await fs.copy(
      path.join(process.cwd(), "docs", "operations", "INTAKE_RISK_PRIORITY_POLICY.json"),
      path.join(copiedCatalogRoot, "docs", "operations", "INTAKE_RISK_PRIORITY_POLICY.json"),
    );
    await fs.copy(
      path.join(process.cwd(), "docs", "operations", "INTAKE_MODE_ROUTING_POLICY.json"),
      path.join(copiedCatalogRoot, "docs", "operations", "INTAKE_MODE_ROUTING_POLICY.json"),
    );

    const { report } = await runIntakePilotBatch(copiedCatalogRoot, {
      fullRun: false,
      skipClarificationGate: true,
      requestOffset: 0,
      requestLimit: 5,
      batchId: "m2-day9",
    });

    expect(report.requestsTotal).toBe(5);
    expect(report.evaluation.autoDecompositionPassed).toBe(true);
    expect(report.evaluation.highRiskHitlPassed).toBe(true);
    expect(report.evaluation.completedCount).toBe(5);

    for (const request of catalog.slice(0, 5)) {
      const result = report.results.find((item) => item.requestId === request.id);
      expect(result).toBeDefined();
      if (request.expectHighRisk !== undefined) {
        expect(result?.highRisk).toBe(request.expectHighRisk);
      }
      if (request.expectHighRisk) {
        expect(result?.allTasksRoutedHitl).toBe(true);
      }
    }

    const ambiguous = report.results.find((result) => result.requestId === "req-05-ambiguous-data-platform");
    expect(ambiguous?.clarificationRequired).toBe(true);
    expect(
      ambiguous?.manualInterventions.some((item) => item.type === "clarification_required"),
    ).toBe(true);

    expect(await fs.pathExists(path.join(copiedCatalogRoot, "artifacts", "intake", "pilot-batch", "PILOT_BATCH_REPORT.json"))).toBe(
      true,
    );
    expect(await fs.pathExists(path.join(copiedCatalogRoot, "artifacts", "intake", "pilot-batch", "PILOT_BATCH_INTERVENTIONS.md"))).toBe(
      true,
    );
  });

  it("records manual decomposition override when flagged", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-pilot-override-"));
    await fs.ensureDir(path.join(rootDir, "docs", "operations"));
    await fs.copy(
      path.join(process.cwd(), "docs", "operations", "INTAKE_AMBIGUITY_POLICY.json"),
      path.join(rootDir, "docs", "operations", "INTAKE_AMBIGUITY_POLICY.json"),
    );
    await fs.copy(
      path.join(process.cwd(), "docs", "operations", "INTAKE_RISK_PRIORITY_POLICY.json"),
      path.join(rootDir, "docs", "operations", "INTAKE_RISK_PRIORITY_POLICY.json"),
    );
    await fs.copy(
      path.join(process.cwd(), "docs", "operations", "INTAKE_MODE_ROUTING_POLICY.json"),
      path.join(rootDir, "docs", "operations", "INTAKE_MODE_ROUTING_POLICY.json"),
    );

    const result = await processPilotRequest(
      rootDir,
      {
        id: "req-override-test",
        project: "internal-tools",
        idea: "Add a staging developer dashboard widget that summarizes test coverage for platform engineers.",
        constraints: ["type-safe"],
        targetUsers: ["platform-team"],
        labels: [],
        manualTaskDecompositionOverride: true,
      },
      { skipClarificationGate: true },
    );

    expect(result.autoDecomposed).toBe(false);
    expect(result.manualInterventions.some((item) => item.type === "manual_task_decomposition_override")).toBe(
      true,
    );
  });

  it("processes day-10 catalog slice through intake and planning", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-pilot-day10-"));
    await fs.ensureDir(path.join(rootDir, "docs", "operations"));
    await fs.copy(
      path.join(process.cwd(), "docs", "operations", "INTAKE_PILOT_REQUESTS.json"),
      path.join(rootDir, "docs", "operations", "INTAKE_PILOT_REQUESTS.json"),
    );
    for (const name of [
      "INTAKE_AMBIGUITY_POLICY.json",
      "INTAKE_RISK_PRIORITY_POLICY.json",
      "INTAKE_MODE_ROUTING_POLICY.json",
    ]) {
      await fs.copy(
        path.join(process.cwd(), "docs", "operations", name),
        path.join(rootDir, "docs", "operations", name),
      );
    }

    const catalog = await loadPilotRequests(rootDir);
    const { report } = await runIntakePilotBatch(rootDir, {
      fullRun: false,
      skipClarificationGate: true,
      requestOffset: 5,
      requestLimit: 5,
      batchId: "m2-day10",
    });

    expect(report.requestsTotal).toBe(5);
    expect(report.batch).toBe("m2-day10");
    expect(report.evaluation.autoDecompositionPassed).toBe(true);
    expect(report.evaluation.highRiskHitlPassed).toBe(true);

    for (const request of catalog.slice(5, 10)) {
      const result = report.results.find((item) => item.requestId === request.id);
      expect(result).toBeDefined();
      if (request.expectHighRisk !== undefined) {
        expect(result?.highRisk).toBe(request.expectHighRisk);
      }
      if (request.expectHighRisk) {
        expect(result?.allTasksRoutedHitl).toBe(true);
      }
    }
  });
});
