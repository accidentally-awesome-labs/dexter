import path from "node:path";
import fs from "fs-extra";
import { buildDeployImage, type BuildDeployImageResult } from "./deploy-build.js";

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
  imageRef?: string;
  registry?: string;
  imageDigest?: string;
  publishedAt?: string;
  build?: {
    built: boolean;
    skipped: boolean;
    detail: string;
  };
  publish?: {
    published: boolean;
    skipped: boolean;
    registry: string | null;
    imageRef: string;
    digest: string | null;
    publishedAt: string | null;
    detail: string;
  };
}

export interface BuildDeployManifestOptions {
  rootDir: string;
  runDir: string;
  runId: string;
  project: string;
}

function defaultImageRepo(project: string): string {
  const deployImage = process.env.DEXTER_DEPLOY_IMAGE?.trim();
  if (deployImage) {
    return stripImageTag(deployImage);
  }
  const registry = process.env.DEXTER_REGISTRY?.trim().replace(/\/$/, "");
  if (registry) {
    return `${registry}/${project}`;
  }
  return `dexter/${project}`;
}

function stripImageTag(image: string): string {
  const trimmed = image.trim();
  const lastSlash = trimmed.lastIndexOf("/");
  const lastColon = trimmed.lastIndexOf(":");
  if (lastColon > lastSlash) {
    return trimmed.slice(0, lastColon);
  }
  return trimmed;
}

function runTag(runId: string): string {
  const short = runId.replace(/-/g, "").slice(0, 12);
  return `run-${short}`;
}

export async function readRunStamp(
  rootDir: string,
): Promise<{ runId: string; project: string; generatedAt: string } | null> {
  const stampPath = process.env.DEXTER_RUN_STAMP_PATH?.trim()
    ? path.resolve(rootDir, process.env.DEXTER_RUN_STAMP_PATH.trim())
    : path.join(rootDir, "generated", "RUN_STAMP.json");
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
    stampPath: "generated/RUN_STAMP.json",
  };
}

export async function prepareDeployArtifact(
  options: BuildDeployManifestOptions,
): Promise<{ manifest: DeployManifest; build: BuildDeployImageResult }> {
  const manifest = await buildDeployManifest(options);
  const build = await buildDeployImage(options.rootDir, manifest);
  manifest.imageRef = build.imageRef;
  manifest.build = {
    built: build.built,
    skipped: build.skipped,
    detail: build.detail,
  };
  return { manifest, build };
}

export async function writeDeployManifest(
  options: BuildDeployManifestOptions,
  prepared?: { manifest: DeployManifest },
): Promise<{ manifest: DeployManifest; manifestPath: string }> {
  const manifest = prepared?.manifest ?? (await prepareDeployArtifact(options)).manifest;
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
