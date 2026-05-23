/**
 * Build a smoke deploy image and push to DEXTER_REGISTRY (GHCR drill).
 * Used locally and in .github/workflows/registry-publish.yml.
 */
import crypto from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import {
  applyPublishResult,
  publishDeployImage,
} from "../release/deploy-publish.js";
import {
  buildDeployManifest,
  prepareDeployArtifact,
} from "../release/deploy-manifest.js";

async function main(): Promise<void> {
  const rootDir = process.cwd();
  const owner =
    process.env.GITHUB_REPOSITORY_OWNER?.trim() ||
    process.env.GHCR_OWNER?.trim() ||
    "accidentally-awesome-labs";
  const registry =
    process.env.DEXTER_REGISTRY?.trim() || `ghcr.io/${owner.replace(/\/$/, "")}`;
  process.env.DEXTER_REGISTRY = registry;

  const project = process.env.DEXTER_REGISTRY_DRILL_PROJECT?.trim() || "dexter";
  const runId = crypto.randomUUID();
  const runDir = path.join(rootDir, "runs", runId);
  await fs.ensureDir(runDir);

  const manifest = await buildDeployManifest({ rootDir, runDir, runId, project });
  const prepared = await prepareDeployArtifact({
    rootDir,
    runDir,
    runId,
    project: manifest.project,
  });

  const publish = await publishDeployImage(rootDir, prepared.manifest, { ensureBuilt: false });
  applyPublishResult(prepared.manifest, publish);
  await fs.writeJson(path.join(runDir, "deploy_manifest.json"), prepared.manifest, { spaces: 2 });
  await fs.writeJson(path.join(runDir, "deploy_publish.json"), publish, { spaces: 2 });
  await fs.ensureDir(path.join(rootDir, "artifacts", "release"));
  await fs.writeJson(path.join(rootDir, "artifacts", "release", "REGISTRY_PUBLISH_DRILL.json"), publish, {
    spaces: 2,
  });

  console.log(
    JSON.stringify(
      {
        registry,
        published: publish.published,
        skipped: publish.skipped,
        imageRef: publish.imageRef,
        digest: publish.digest,
        detail: publish.detail,
        runId,
      },
      null,
      2,
    ),
  );

  if (!publish.published) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
