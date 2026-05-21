import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { generatePlanningSignatures } from "../src/planning/signature.js";
import {
  DEFAULT_PROMOTION_STAGES,
  runPromotionPipeline,
  runPromotionPreflight,
  type DeploySelfRunner,
} from "../src/operations/run-promotion-pipeline.js";

async function seedReleaseInputs(rootDir: string) {
  const planningDir = path.join(rootDir, "artifacts", "planning");
  await fs.ensureDir(planningDir);
  await fs.writeFile(path.join(planningDir, "PRD.md"), "prd");
  await fs.writeFile(path.join(planningDir, "TASK_GRAPH.json"), "{\"tasks\":[]}");
  await fs.writeFile(path.join(planningDir, "ARCHITECTURE_SPEC.md"), "arch");
  await fs.writeFile(path.join(planningDir, "NFR_SPEC.md"), "nfr");
  await fs.writeFile(path.join(planningDir, "TEST_STRATEGY.md"), "tests");
  await generatePlanningSignatures(rootDir);

  await fs.ensureDir(path.join(rootDir, "runs", "latest"));
  await fs.writeJson(path.join(rootDir, "runs", "latest", "supply_chain_gate.json"), {
    provenanceValid: true,
    attestationValid: true,
    passed: true,
  });

  await fs.ensureDir(path.join(rootDir, "docs", "operations"));
  await fs.copy(path.join(process.cwd(), "docs", "operations", "RBAC_POLICY.json"), path.join(rootDir, "docs", "operations", "RBAC_POLICY.json"));
  await fs.copy(
    path.join(process.cwd(), "docs", "operations", "CANARY_SLO_POLICY.json"),
    path.join(rootDir, "docs", "operations", "CANARY_SLO_POLICY.json"),
  );
  await fs.copy(path.join(process.cwd(), "docs", "specs", "DEPLOY_AUTH_POLICY.json"), path.join(rootDir, "docs", "specs", "DEPLOY_AUTH_POLICY.json"));

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
}

describe("promotion pipeline", () => {
  it("runs default dev->staging->canary->prod stages with manifest and audit trail", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-promotion-pipeline-"));
    await seedReleaseInputs(rootDir);

    let stageIndex = 0;
    const deployRunner: DeploySelfRunner = async () => {
      const stage = DEFAULT_PROMOTION_STAGES[stageIndex]!;
      stageIndex += 1;
      const releaseDir = path.join(rootDir, "artifacts", "release");
      await fs.ensureDir(releaseDir);
      await fs.writeJson(path.join(releaseDir, "self_deploy_result.json"), {
        deploymentMode: "api",
        deploymentId: `mock-${stage.environment}`,
        environment: stage.environment,
      });
      if (stage.environment === "canary") {
        await fs.writeJson(path.join(releaseDir, "CANARY_GATE_RESULT.json"), {
          schemaVersion: "1.0",
          generatedAt: new Date().toISOString(),
          environment: "canary",
          passed: true,
          prodPromotionAllowed: true,
          burnState: "healthy",
          metrics: { errorRate5xx: 0.001, p95LatencyMs: 100, errorBudgetBurnMultiple: 0.5 },
          checks: [],
        });
      }
      return {
        code: 0,
        stdout: JSON.stringify({ deploymentMode: "api", deploymentId: `mock-${stage.environment}` }),
      };
    };

    const preflight = await runPromotionPreflight(rootDir);
    expect(preflight.releaseDecision).toBe("GO");

    const manifest = await runPromotionPipeline({
      rootDir,
      deployRunner,
      requireApi: false,
      stages: DEFAULT_PROMOTION_STAGES,
      promotionId: "promotion-test-001",
      minimumPromotionsForGovernance: 1,
    });

    expect(manifest.passed).toBe(true);
    expect(manifest.stages).toHaveLength(4);
    expect(manifest.stages.map((stage) => stage.environment)).toEqual(["dev", "staging", "canary", "prod"]);
    expect(await fs.pathExists(path.join(rootDir, "artifacts", "release", "PROMOTION_PIPELINE_MANIFEST.json"))).toBe(true);
    expect(manifest.audit.eventsDelta).toBeGreaterThan(0);
    expect(manifest.artifactTrail.length).toBeGreaterThan(2);

    const audit = await fs.readFile(path.join(rootDir, "artifacts", "operations", "AUDIT_LOG.jsonl"), "utf8");
    expect(audit).toContain("promotion_pipeline_started");
    expect(audit).toContain("promotion_pipeline_completed");
  });
});
