import path from "node:path";
import fs from "fs-extra";
import { DEFAULT_PROMOTION_STAGES } from "./run-promotion-pipeline.js";
import { promotionArchivePath, promotionCanaryGateArchivePath, readPromotionHistory } from "./promotion-history.js";
import type { PromotionPipelineManifest } from "./run-promotion-pipeline.js";

export interface RepeatabilityCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface PromotionRepeatabilityReport {
  schemaVersion: "1.0";
  generatedAt: string;
  passed: boolean;
  promotionCount: number;
  checks: RepeatabilityCheck[];
}

const reportJsonPath = (rootDir: string) =>
  path.join(rootDir, "artifacts", "release", "PROMOTION_REPEATABILITY.json");

export async function verifyPromotionRepeatability(
  rootDir: string,
  minimumPromotions = 3,
): Promise<PromotionRepeatabilityReport> {
  const history = await readPromotionHistory(rootDir);
  const expectedStages = DEFAULT_PROMOTION_STAGES.map((stage) => stage.environment);
  const expectedRoles = DEFAULT_PROMOTION_STAGES.map((stage) => stage.approverRole);
  const checks: RepeatabilityCheck[] = [];

  checks.push({
    name: "promotion_count",
    passed: history.promotions.length >= minimumPromotions,
    detail: `Found ${history.promotions.length} promotions (required >= ${minimumPromotions}).`,
  });

  const manifests: PromotionPipelineManifest[] = [];
  for (const entry of history.promotions) {
    const archivePath = promotionArchivePath(rootDir, entry.promotionId);
    if (!(await fs.pathExists(archivePath))) {
      checks.push({
        name: `archive_present_${entry.promotionId}`,
        passed: false,
        detail: `Missing archive: ${archivePath}`,
      });
      continue;
    }
    manifests.push((await fs.readJson(archivePath)) as PromotionPipelineManifest);
  }

  for (const manifest of manifests) {
    const stageEnvs = manifest.stages.map((stage) => stage.environment);
    const stageRoles = manifest.stages.map((stage) => stage.approverRole);
    const allStagesPassed = manifest.stages.every((stage) => stage.exitCode === 0);
    const stagesMatch =
      stageEnvs.length === expectedStages.length && stageEnvs.every((env, idx) => env === expectedStages[idx]);
    const rolesMatch =
      stageRoles.length === expectedRoles.length && stageRoles.every((role, idx) => role === expectedRoles[idx]);

    checks.push({
      name: `stage_consistency_${manifest.promotionId}`,
      passed: stagesMatch && rolesMatch,
      detail: `stages=${stageEnvs.join("->")}, roles=${stageRoles.join(",")}`,
    });
    checks.push({
      name: `stage_success_${manifest.promotionId}`,
      passed: allStagesPassed && manifest.passed,
      detail: allStagesPassed ? "All stages exited 0." : "One or more stages failed.",
    });
    checks.push({
      name: `audit_trail_${manifest.promotionId}`,
      passed:
        manifest.audit.eventsDelta > 0 &&
        manifest.audit.pipelineActions.includes("promotion_pipeline_started") &&
        manifest.audit.pipelineActions.includes("promotion_pipeline_completed"),
      detail: `auditDelta=${manifest.audit.eventsDelta}`,
    });
    const canaryStage = manifest.stages.find((stage) => stage.environment === "canary");
    const canaryCandidates = [
      promotionCanaryGateArchivePath(rootDir, manifest.promotionId),
      canaryStage?.artifacts.canaryGateResult,
    ].filter((value): value is string => !!value);
    let canaryPath: string | undefined;
    for (const candidate of canaryCandidates) {
      if (await fs.pathExists(candidate)) {
        canaryPath = candidate;
        break;
      }
    }
    if (canaryPath) {
      const canaryResult = (await fs.readJson(canaryPath)) as { passed?: boolean; prodPromotionAllowed?: boolean };
      checks.push({
        name: `canary_gate_${manifest.promotionId}`,
        passed: canaryResult.passed === true && canaryResult.prodPromotionAllowed === true,
        detail: `canary passed=${canaryResult.passed}, prodAllowed=${canaryResult.prodPromotionAllowed}`,
      });
    }
  }

  if (manifests.length >= 2) {
    const firstStages = manifests[0]!.stages.map((stage) => stage.environment).join("->");
    const allSamePath = manifests.every(
      (manifest) => manifest.stages.map((stage) => stage.environment).join("->") === firstStages,
    );
    checks.push({
      name: "cross_promotion_stage_path",
      passed: allSamePath,
      detail: allSamePath ? `All promotions used ${firstStages}` : "Promotion stage paths diverged.",
    });
  }

  const passed = checks.every((check) => check.passed);
  const report: PromotionRepeatabilityReport = {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    passed,
    promotionCount: history.promotions.length,
    checks,
  };

  await fs.ensureDir(path.dirname(reportJsonPath(rootDir)));
  await fs.writeJson(reportJsonPath(rootDir), report, { spaces: 2 });
  return report;
}
