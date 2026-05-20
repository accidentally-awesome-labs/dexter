import path from "node:path";
import fs from "fs-extra";
import type { ReleaseBundle } from "../../protocols/types.js";

export async function createReleaseBundle(rootDir: string): Promise<ReleaseBundle> {
  const releaseDir = path.join(rootDir, "artifacts", "release");
  await fs.ensureDir(releaseDir);

  const deploymentGuidePath = path.join(releaseDir, "DEPLOYMENT_GUIDE.md");
  const operationsRunbookPath = path.join(releaseDir, "OPERATIONS_RUNBOOK.md");
  const releaseNotesPath = path.join(releaseDir, "RELEASE_NOTES.md");
  const readinessChecklistPath = path.join(releaseDir, "PRODUCTION_READINESS_CHECKLIST.md");

  await fs.ensureFile(deploymentGuidePath);
  await fs.ensureFile(operationsRunbookPath);
  await fs.ensureFile(releaseNotesPath);
  await fs.ensureFile(readinessChecklistPath);

  return {
    deploymentGuidePath,
    operationsRunbookPath,
    releaseNotesPath,
    readinessChecklistPath,
  };
}
