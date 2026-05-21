import path from "node:path";
import fs from "fs-extra";
import type { PromotionPipelineManifest } from "./run-promotion-pipeline.js";

export interface PromotionHistoryEntry {
  promotionId: string;
  targetService: string;
  appName: string;
  generatedAt: string;
  passed: boolean;
  manifestPath: string;
  stages: string[];
}

export interface PromotionHistoryIndex {
  schemaVersion: "1.0";
  updatedAt: string;
  promotions: PromotionHistoryEntry[];
}

const historyPath = (rootDir: string) => path.join(rootDir, "artifacts", "release", "PROMOTION_HISTORY.json");
const promotionsDir = (rootDir: string) => path.join(rootDir, "artifacts", "release", "promotions");

export function promotionArchivePath(rootDir: string, promotionId: string): string {
  const safeId = promotionId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(promotionsDir(rootDir), `${safeId}.json`);
}

export function promotionCanaryGateArchivePath(rootDir: string, promotionId: string): string {
  const safeId = promotionId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(promotionsDir(rootDir), `${safeId}.canary_gate.json`);
}

export async function archivePromotionManifest(
  rootDir: string,
  manifest: PromotionPipelineManifest,
): Promise<{ archivePath: string; historyPath: string }> {
  const archivePath = promotionArchivePath(rootDir, manifest.promotionId);
  await fs.ensureDir(path.dirname(archivePath));

  const canaryGateSource = path.join(rootDir, "artifacts", "release", "CANARY_GATE_RESULT.json");
  if (await fs.pathExists(canaryGateSource)) {
    const canaryArchive = promotionCanaryGateArchivePath(rootDir, manifest.promotionId);
    await fs.copy(canaryGateSource, canaryArchive);
    for (const stage of manifest.stages) {
      if (stage.environment === "canary") {
        stage.artifacts.canaryGateResult = canaryArchive;
      }
    }
  }

  await fs.writeJson(archivePath, manifest, { spaces: 2 });

  const indexPath = historyPath(rootDir);
  const current: PromotionHistoryIndex = (await fs.pathExists(indexPath))
    ? ((await fs.readJson(indexPath)) as PromotionHistoryIndex)
    : { schemaVersion: "1.0", updatedAt: new Date().toISOString(), promotions: [] };

  const entry: PromotionHistoryEntry = {
    promotionId: manifest.promotionId,
    targetService: manifest.targetService,
    appName: manifest.appName,
    generatedAt: manifest.generatedAt,
    passed: manifest.passed,
    manifestPath: archivePath,
    stages: manifest.stages.map((stage) => stage.environment),
  };

  const withoutDuplicate = current.promotions.filter((item) => item.promotionId !== entry.promotionId);
  withoutDuplicate.push(entry);
  withoutDuplicate.sort((a, b) => Date.parse(a.generatedAt) - Date.parse(b.generatedAt));

  const index: PromotionHistoryIndex = {
    schemaVersion: "1.0",
    updatedAt: new Date().toISOString(),
    promotions: withoutDuplicate,
  };
  await fs.writeJson(indexPath, index, { spaces: 2 });
  return { archivePath, historyPath: indexPath };
}

export async function readPromotionHistory(rootDir: string): Promise<PromotionHistoryIndex> {
  const indexPath = historyPath(rootDir);
  if (!(await fs.pathExists(indexPath))) {
    return { schemaVersion: "1.0", updatedAt: new Date().toISOString(), promotions: [] };
  }
  return (await fs.readJson(indexPath)) as PromotionHistoryIndex;
}
