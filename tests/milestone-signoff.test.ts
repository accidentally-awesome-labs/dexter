import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { archivePromotionManifest } from "../src/operations/promotion-history.js";
import { generateMilestone1Signoff } from "../src/operations/milestone-signoff.js";
import { DEFAULT_PROMOTION_STAGES } from "../src/operations/run-promotion-pipeline.js";
import type { PromotionPipelineManifest } from "../src/operations/run-promotion-pipeline.js";

function manifest(id: string, service: string): PromotionPipelineManifest {
  return {
    schemaVersion: "1.0",
    promotionId: id,
    generatedAt: new Date().toISOString(),
    appName: service,
    controlPlane: "coolify",
    targetService: service,
    releaseDecision: "GO",
    unresolvedEscalations: 0,
    unresolvedOperatorHigh: 0,
    stages: DEFAULT_PROMOTION_STAGES.map((stage) => ({
      environment: stage.environment,
      sourceEnvironment: stage.sourceEnvironment,
      approverRole: stage.approverRole,
      exitCode: 0,
      deploymentMode: "api",
      artifacts: {},
    })),
    artifactTrail: [],
    audit: {
      logPath: "artifacts/operations/AUDIT_LOG.jsonl",
      eventsBefore: 0,
      eventsAfter: 5,
      eventsDelta: 5,
      pipelineActions: [
        "promotion_pipeline_started",
        "promotion_pipeline_stage:staging",
        "promotion_pipeline_completed",
      ],
    },
    passed: true,
  };
}

describe("milestone 1 signoff", () => {
  it("passes when all milestone gates are satisfied", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-m1-signoff-"));
    await fs.copy(path.join(process.cwd(), "docs/operations"), path.join(rootDir, "docs/operations"));
    await fs.copy(path.join(process.cwd(), "docs/specs"), path.join(rootDir, "docs/specs"));
    await fs.ensureDir(path.join(rootDir, "artifacts/release"));
    await fs.writeJson(path.join(rootDir, "artifacts/release/CANARY_GATE_RESULT.json"), {
      passed: true,
      prodPromotionAllowed: true,
    });
    await fs.ensureDir(path.join(rootDir, "artifacts/operations"));
    await fs.appendFile(path.join(rootDir, "artifacts/operations/AUDIT_LOG.jsonl"), `${JSON.stringify({ action: "test" })}\n`);

    for (let i = 0; i < 5; i += 1) {
      const runDir = path.join(rootDir, "runs", `run-${i}`);
      await fs.ensureDir(runDir);
      await fs.writeJson(path.join(runDir, "run_summary.json"), {
        runId: `run-${i}`,
        project: "dexter",
        durationMs: 1000,
        verificationPassed: true,
        deployed: true,
        memoryLessonsRetrieved: 1,
        tasksTotal: 1,
        tasksPassed: 1,
      });
    }

    for (const service of ["dexter", "dexter-ops-api", "dexter-worker"]) {
      const item = manifest(`promotion-${service}`, service);
      for (const stage of item.stages) {
        if (stage.environment === "canary") {
          stage.artifacts.canaryGateResult = path.join(rootDir, "artifacts/release/CANARY_GATE_RESULT.json");
        }
      }
      await archivePromotionManifest(rootDir, item);
    }

    await fs.writeJson(path.join(rootDir, "artifacts/release/CANARY_ROLLBACK_DRILL_REPORT.json"), { passed: true });
    await fs.writeJson(path.join(rootDir, "artifacts/release/SLO_ROLLBACK_RESULT.json"), {
      execution: { triggered: true },
    });

    const report = await generateMilestone1Signoff(rootDir);
    const failed = report.gates.filter((gate) => !gate.passed);
    expect(failed, failed.map((gate) => `${gate.id}: ${gate.detail}`).join("; ")).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.gates.every((gate) => gate.passed)).toBe(true);
  });
});
