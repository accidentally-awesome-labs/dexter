import path from "node:path";
import fs from "fs-extra";

export interface DeployManifest {
  schemaVersion: "1.0";
  runId: string;
  project: string;
  generatedAt: string;
  artifactType: "docker_image";
  image: string;
  tag: string;
  deployTag: string;
  coolify: {
    appName: string;
    force: boolean;
  };
  stampPath: string;
}

export interface BuildDeployManifestOptions {
  rootDir: string;
  runDir: string;
  runId: string;
  project: string;
}

function defaultImageRepo(project: string): string {
  return process.env.DEXTER_DEPLOY_IMAGE ?? `dexter/${project}`;
}

function runTag(runId: string): string {
  const short = runId.replace(/-/g, "").slice(0, 12);
  return `run-${short}`;
}

export async function readRunStamp(
  rootDir: string,
): Promise<{ runId: string; project: string; generatedAt: string } | null> {
  const stampPath = path.join(rootDir, "generated", "RUN_STAMP.json");
  if (!(await fs.pathExists(stampPath))) {
    return null;
  }
  const stamp = (await fs.readJson(stampPath)) as {
    runId?: string;
    project?: string;
    generatedAt?: string;
  };
  if (!stamp.runId) {
    return null;
  }
  return {
    runId: stamp.runId,
    project: stamp.project ?? "unknown",
    generatedAt: stamp.generatedAt ?? new Date().toISOString(),
  };
}

export async function buildDeployManifest(options: BuildDeployManifestOptions): Promise<DeployManifest> {
  const stamp =
    (await readRunStamp(options.rootDir)) ??
    ({
      runId: options.runId,
      project: options.project,
      generatedAt: new Date().toISOString(),
    } as const);

  const image = defaultImageRepo(options.project);
  const tag = runTag(stamp.runId);
  const deployTag = process.env.DEXTER_DEPLOY_TAG ?? tag;

  return {
    schemaVersion: "1.0",
    runId: stamp.runId,
    project: options.project,
    generatedAt: new Date().toISOString(),
    artifactType: "docker_image",
    image,
    tag,
    deployTag,
    coolify: {
      appName: process.env.DEXTER_COOLIFY_APP_NAME ?? options.project,
      force: process.env.DEXTER_DEPLOY_FORCE !== "false",
    },
    stampPath: path.join(options.rootDir, "generated", "RUN_STAMP.json"),
  };
}

export async function writeDeployManifest(
  options: BuildDeployManifestOptions,
): Promise<{ manifest: DeployManifest; manifestPath: string }> {
  const manifest = await buildDeployManifest(options);
  const manifestPath = path.join(options.runDir, "deploy_manifest.json");
  await fs.ensureDir(options.runDir);
  await fs.writeJson(manifestPath, manifest, { spaces: 2 });
  const releaseManifestDir = path.join(options.rootDir, "artifacts", "release");
  await fs.ensureDir(releaseManifestDir);
  await fs.writeJson(path.join(releaseManifestDir, "DEPLOY_MANIFEST.json"), manifest, {
    spaces: 2,
  });
  process.env.DEXTER_DEPLOY_MANIFEST_PATH = manifestPath;
  return { manifest, manifestPath };
}

export async function loadDeployManifest(manifestPath?: string): Promise<DeployManifest | null> {
  const resolved = manifestPath ?? process.env.DEXTER_DEPLOY_MANIFEST_PATH;
  if (!resolved || !(await fs.pathExists(resolved))) {
    return null;
  }
  return (await fs.readJson(resolved)) as DeployManifest;
}
