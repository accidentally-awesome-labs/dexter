import { spawn } from "node:child_process";
import type { DeployManifest } from "./deploy-manifest.js";
import { buildDeployImage } from "./deploy-build.js";

export interface PublishDeployImageResult {
  published: boolean;
  skipped: boolean;
  registry: string | null;
  imageRef: string;
  digest: string | null;
  publishedAt: string | null;
  detail: string;
}

function commandExists(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-lc", `command -v ${command}`], { stdio: "ignore" });
    child.on("close", (code) => resolve(code === 0));
  });
}

async function runShell(command: string, cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-lc", command], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
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

export function resolvePublishImageRef(manifest: DeployManifest): {
  registry: string | null;
  imageRef: string;
  localRef: string;
  repository: string;
} {
  const localRef = manifest.imageRef ?? `${manifest.image}:${manifest.deployTag}`;
  const registry = process.env.DEXTER_REGISTRY?.trim().replace(/\/$/, "") ?? null;

  let repository = stripImageTag(process.env.DEXTER_DEPLOY_IMAGE?.trim() ?? manifest.image);
  if (registry) {
    if (!repository.includes("/") || repository.startsWith("dexter/")) {
      repository = `${registry}/${manifest.project}`;
    } else if (!repository.startsWith(registry)) {
      repository = `${registry}/${repository.split("/").pop() ?? manifest.project}`;
    }
  }

  const imageRef = `${repository}:${manifest.deployTag}`;
  return { registry, imageRef, localRef, repository };
}

export function applyPublishResult(
  manifest: DeployManifest,
  result: PublishDeployImageResult,
): DeployManifest {
  if (!result.published) {
    return manifest;
  }
  manifest.image = stripImageTag(result.imageRef);
  manifest.imageRef = result.imageRef;
  manifest.registry = result.registry ?? undefined;
  manifest.imageDigest = result.digest ?? undefined;
  manifest.publishedAt = result.publishedAt ?? undefined;
  manifest.publish = {
    published: result.published,
    skipped: result.skipped,
    registry: result.registry,
    imageRef: result.imageRef,
    digest: result.digest,
    publishedAt: result.publishedAt,
    detail: result.detail,
  };
  return manifest;
}

export async function publishDeployImage(
  rootDir: string,
  manifest: DeployManifest,
  options?: { ensureBuilt?: boolean },
): Promise<PublishDeployImageResult> {
  const { registry, imageRef, localRef } = resolvePublishImageRef(manifest);

  if (process.env.DEXTER_SKIP_DEPLOY_PUBLISH === "true") {
    return {
      published: false,
      skipped: true,
      registry,
      imageRef,
      digest: null,
      publishedAt: null,
      detail: "DEXTER_SKIP_DEPLOY_PUBLISH=true",
    };
  }

  if (!registry && !process.env.DEXTER_DEPLOY_IMAGE?.includes("/")) {
    return {
      published: false,
      skipped: true,
      registry: null,
      imageRef,
      digest: null,
      publishedAt: null,
      detail: "Set DEXTER_REGISTRY or a registry-hosted DEXTER_DEPLOY_IMAGE to publish",
    };
  }

  const dockerAvailable = await commandExists("docker");
  if (!dockerAvailable) {
    return {
      published: false,
      skipped: true,
      registry,
      imageRef,
      digest: null,
      publishedAt: null,
      detail: "docker not available",
    };
  }

  if (options?.ensureBuilt !== false) {
    await buildDeployImage(rootDir, manifest);
  }

  const tag = await runShell(`docker tag ${JSON.stringify(localRef)} ${JSON.stringify(imageRef)}`, rootDir);
  if (tag.code !== 0) {
    throw new Error(`docker tag failed: ${tag.stderr || tag.stdout}`);
  }

  const push = await runShell(`docker push ${JSON.stringify(imageRef)}`, rootDir);
  if (push.code !== 0) {
    throw new Error(`docker push failed: ${push.stderr || push.stdout}`);
  }

  const inspect = await runShell(
    `docker image inspect ${JSON.stringify(imageRef)} --format '{{index .RepoDigests 0}}'`,
    rootDir,
  );
  const digest =
    inspect.code === 0 && inspect.stdout.trim() && inspect.stdout.trim() !== "<no value>"
      ? inspect.stdout.trim()
      : null;

  return {
    published: true,
    skipped: false,
    registry,
    imageRef,
    digest,
    publishedAt: new Date().toISOString(),
    detail: digest ? `pushed ${imageRef} (${digest})` : `pushed ${imageRef}`,
  };
}
