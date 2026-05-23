import path from "node:path";
import dotenv from "dotenv";
import fs from "fs-extra";
import {
  applyPublishResult,
  publishDeployImage,
} from "../release/deploy-publish.js";
import {
  buildDeployManifest,
  loadDeployManifest,
  prepareDeployArtifact,
  type DeployManifest,
} from "../release/deploy-manifest.js";

dotenv.config();

function parseArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0 || index + 1 >= process.argv.length) {
    return undefined;
  }
  return process.argv[index + 1];
}

async function findLatestRunManifest(rootDir: string): Promise<{ runId: string; manifestPath: string } | null> {
  const runsDir = path.join(rootDir, "runs");
  if (!(await fs.pathExists(runsDir))) {
    return null;
  }
  const entries = await fs.readdir(runsDir);
  let latest: { runId: string; manifestPath: string; mtime: number } | null = null;
  for (const runId of entries) {
    const manifestPath = path.join(runsDir, runId, "deploy_manifest.json");
    if (!(await fs.pathExists(manifestPath))) {
      continue;
    }
    const stat = await fs.stat(manifestPath);
    if (!latest || stat.mtimeMs > latest.mtime) {
      latest = { runId, manifestPath, mtime: stat.mtimeMs };
    }
  }
  return latest ? { runId: latest.runId, manifestPath: latest.manifestPath } : null;
}

async function main(): Promise<void> {
  const rootDir = path.resolve(parseArg("--root-dir") ?? process.cwd());
  const runIdArg = parseArg("--run-id");
  const manifestArg = parseArg("--manifest");
  const skipBuild = process.argv.includes("--skip-build");

  let manifest: DeployManifest | null = null;
  let runId = runIdArg;
  let manifestPath = manifestArg;

  if (manifestPath) {
    manifest = await loadDeployManifest(manifestPath);
  } else if (runId) {
    manifestPath = path.join(rootDir, "runs", runId, "deploy_manifest.json");
    manifest = await loadDeployManifest(manifestPath);
  } else {
    const latest = await findLatestRunManifest(rootDir);
    if (latest) {
      runId = latest.runId;
      manifestPath = latest.manifestPath;
      manifest = await loadDeployManifest(manifestPath);
    }
  }

  if (!manifest || !manifestPath) {
    throw new Error("No deploy manifest found. Pass --run-id, --manifest, or run factory:e2e first.");
  }

  runId = runId ?? manifest.runId;
  const runDir = path.dirname(manifestPath);

  if (!manifest.imageRef && !skipBuild) {
    const built = await prepareDeployArtifact({
      rootDir,
      runDir,
      runId,
      project: manifest.project,
    });
    manifest = built.manifest;
  }

  const publish = await publishDeployImage(rootDir, manifest, { ensureBuilt: !skipBuild && !manifest.imageRef });
  applyPublishResult(manifest, publish);

  await fs.writeJson(manifestPath, manifest, { spaces: 2 });
  await fs.ensureDir(path.join(rootDir, "artifacts", "release"));
  await fs.writeJson(path.join(rootDir, "artifacts", "release", "DEPLOY_MANIFEST.json"), manifest, {
    spaces: 2,
  });
  await fs.writeJson(path.join(runDir, "deploy_publish.json"), publish, { spaces: 2 });

  console.log(
    JSON.stringify(
      {
        published: publish.published,
        skipped: publish.skipped,
        imageRef: publish.imageRef,
        digest: publish.digest,
        manifestPath,
        detail: publish.detail,
      },
      null,
      2,
    ),
  );

  if (!publish.published && !publish.skipped) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
