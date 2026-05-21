import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { archivePromotionManifest } from "../src/operations/promotion-history.js";
import { verifyGovernance } from "../src/operations/governance-verify.js";
import type { PromotionPipelineManifest } from "../src/operations/run-promotion-pipeline.js";
import { DEFAULT_PROMOTION_STAGES } from "../src/operations/run-promotion-pipeline.js";

function sampleManifest(promotionId: string, targetService: string): PromotionPipelineManifest {
  return {
    schemaVersion: "1.0",
    promotionId,
    generatedAt: new Date().toISOString(),
    appName: targetService,
    controlPlane: "coolify",
    targetService,
    releaseDecision: "GO",
    unresolvedEscalations: 0,
    unresolvedOperatorHigh: 0,
    stages: DEFAULT_PROMOTION_STAGES.map((stage) => ({
      environment: stage.environment,
      sourceEnvironment: stage.sourceEnvironment,
      approverRole: stage.approverRole,
      exitCode: 0,
      deploymentId: `deploy-${stage.environment}`,
      deploymentMode: "api",
      artifacts: {},
    })),
    artifactTrail: [],
    audit: {
      logPath: "artifacts/operations/AUDIT_LOG.jsonl",
      eventsBefore: 0,
      eventsAfter: 5,
      eventsDelta: 5,
      pipelineActions: ["promotion_pipeline_started", "promotion_pipeline_stage:staging", "promotion_pipeline_completed"],
    },
    passed: true,
  };
}

describe("governance verify", () => {
  it("passes with complete waiver metadata and consistent promotion history", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-governance-"));
    await fs.ensureDir(path.join(rootDir, "docs", "operations"));
    await fs.copy(path.join(process.cwd(), "docs", "operations", "RBAC_POLICY.json"), path.join(rootDir, "docs", "operations", "RBAC_POLICY.json"));

    await fs.ensureDir(path.join(rootDir, "artifacts", "execution"));
    await fs.writeJson(path.join(rootDir, "artifacts", "execution", "ESCALATION_STATE.json"), {
      generatedAt: new Date().toISOString(),
      items: [
        {
          key: "task-1:operator:reason",
          taskId: "task-1",
          target: "operator",
          priority: "medium",
          reason: "reason",
          action: "review",
          status: "waived",
          firstSeenAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
          lastRunId: "run-1",
          waiver: {
            approvedBy: "operator",
            reason: "accepted risk",
            scope: "run",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
        },
      ],
    });

    await archivePromotionManifest(rootDir, sampleManifest("promotion-001", "dexter"));
    await archivePromotionManifest(rootDir, sampleManifest("promotion-002", "dexter-ops-api"));

    const report = await verifyGovernance({ rootDir, minimumPromotions: 2 });
    expect(report.passed).toBe(true);
    expect(report.checks.every((check) => check.passed)).toBe(true);
  });

  it("fails when waived escalation metadata is incomplete", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-governance2-"));
    await fs.ensureDir(path.join(rootDir, "docs", "operations"));
    await fs.copy(path.join(process.cwd(), "docs", "operations", "RBAC_POLICY.json"), path.join(rootDir, "docs", "operations", "RBAC_POLICY.json"));
    await fs.ensureDir(path.join(rootDir, "artifacts", "execution"));
    await fs.writeJson(path.join(rootDir, "artifacts", "execution", "ESCALATION_STATE.json"), {
      generatedAt: new Date().toISOString(),
      items: [
        {
          key: "task-1:operator:reason",
          taskId: "task-1",
          target: "operator",
          priority: "medium",
          reason: "reason",
          action: "review",
          status: "waived",
          firstSeenAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
          lastRunId: "run-1",
          waiver: {
            approvedBy: "operator",
            reason: "",
            scope: "run",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
        },
      ],
    });

    const report = await verifyGovernance({ rootDir, minimumPromotions: 0 });
    expect(report.passed).toBe(false);
    expect(report.checks.some((check) => check.name.startsWith("waiver_metadata_") && !check.passed)).toBe(true);
  });
});
