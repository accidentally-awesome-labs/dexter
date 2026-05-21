import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { archivePromotionManifest } from "../src/operations/promotion-history.js";
import { verifyPromotionRepeatability } from "../src/operations/promotion-repeatability.js";
import { DEFAULT_PROMOTION_STAGES } from "../src/operations/run-promotion-pipeline.js";
import type { PromotionPipelineManifest } from "../src/operations/run-promotion-pipeline.js";

function buildManifest(id: string, target: string): PromotionPipelineManifest {
  const releaseDir = (root: string) => path.join(root, "artifacts", "release");
  return {
    schemaVersion: "1.0",
    promotionId: id,
    generatedAt: new Date().toISOString(),
    appName: target,
    controlPlane: "coolify",
    targetService: target,
    releaseDecision: "GO",
    unresolvedEscalations: 0,
    unresolvedOperatorHigh: 0,
    stages: DEFAULT_PROMOTION_STAGES.map((stage, index) => ({
      environment: stage.environment,
      sourceEnvironment: stage.sourceEnvironment,
      approverRole: stage.approverRole,
      exitCode: 0,
      deploymentId: `deploy-${index}`,
      deploymentMode: "api",
      artifacts:
        stage.environment === "canary"
          ? { canaryGateResult: path.join(releaseDir(""), "CANARY_GATE_RESULT.json") }
          : {},
    })),
    artifactTrail: [],
    audit: {
      logPath: "artifacts/operations/AUDIT_LOG.jsonl",
      eventsBefore: 0,
      eventsAfter: 6,
      eventsDelta: 6,
      pipelineActions: ["promotion_pipeline_started", "promotion_pipeline_completed"],
    },
    passed: true,
  };
}

describe("promotion repeatability", () => {
  it("passes when three promotions share gate behavior", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-repeatability-"));
    await fs.ensureDir(path.join(rootDir, "artifacts", "release"));
    await fs.writeJson(path.join(rootDir, "artifacts", "release", "CANARY_GATE_RESULT.json"), {
      passed: true,
      prodPromotionAllowed: true,
    });

    for (const target of ["dexter", "dexter-ops-api", "dexter-worker"]) {
      const manifest = buildManifest(`promotion-${target}`, target);
      for (const stage of manifest.stages) {
        if (stage.environment === "canary" && stage.artifacts.canaryGateResult) {
          stage.artifacts.canaryGateResult = path.join(rootDir, "artifacts", "release", "CANARY_GATE_RESULT.json");
        }
      }
      await archivePromotionManifest(rootDir, manifest);
    }

    const report = await verifyPromotionRepeatability(rootDir, 3);
    expect(report.passed).toBe(true);
    expect(report.promotionCount).toBe(3);
  });
});
