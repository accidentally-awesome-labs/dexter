import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, describe, expect, it } from "vitest";
import { buildDeployManifest } from "../src/release/deploy-manifest.js";
import {
  applyPublishResult,
  publishDeployImage,
  resolvePublishImageRef,
} from "../src/release/deploy-publish.js";

const savedEnv: Record<string, string | undefined> = {};

function saveEnv(keys: string[]): void {
  for (const key of keys) {
    savedEnv[key] = process.env[key];
  }
}

function restoreEnv(keys: string[]): void {
  for (const key of keys) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
}

describe("deploy publish", () => {
  const envKeys = [
    "DEXTER_REGISTRY",
    "DEXTER_DEPLOY_IMAGE",
    "DEXTER_SKIP_DEPLOY_PUBLISH",
    "DEXTER_SKIP_DEPLOY_BUILD",
  ];

  afterEach(() => {
    restoreEnv(envKeys);
  });

  it("resolves GHCR-style image ref from DEXTER_REGISTRY", async () => {
    saveEnv(envKeys);
    process.env.DEXTER_REGISTRY = "ghcr.io/my-org";
    const manifest = await buildDeployManifest({
      rootDir: os.tmpdir(),
      runDir: path.join(os.tmpdir(), "runs", "run-1"),
      runId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      project: "sample-app",
    });
    const resolved = resolvePublishImageRef(manifest);
    expect(resolved.registry).toBe("ghcr.io/my-org");
    expect(resolved.imageRef).toBe("ghcr.io/my-org/sample-app:run-aaaaaaaabbbb");
    expect(resolved.repository).toBe("ghcr.io/my-org/sample-app");
  });

  it("applies publish result to manifest fields", async () => {
    saveEnv(envKeys);
    const manifest = await buildDeployManifest({
      rootDir: os.tmpdir(),
      runDir: path.join(os.tmpdir(), "runs", "run-2"),
      runId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      project: "dexter",
    });
    const updated = applyPublishResult(manifest, {
      published: true,
      skipped: false,
      registry: "ghcr.io/my-org",
      imageRef: "ghcr.io/my-org/dexter:run-bbbbbbbbbbbb",
      digest: "ghcr.io/my-org/dexter@sha256:abc",
      publishedAt: "2026-05-23T12:00:00.000Z",
      detail: "pushed",
    });
    expect(updated.image).toBe("ghcr.io/my-org/dexter");
    expect(updated.imageDigest).toBe("ghcr.io/my-org/dexter@sha256:abc");
    expect(updated.registry).toBe("ghcr.io/my-org");
    expect(updated.publish?.published).toBe(true);
  });

  it("skips publish when DEXTER_SKIP_DEPLOY_PUBLISH is true", async () => {
    saveEnv(envKeys);
    process.env.DEXTER_SKIP_DEPLOY_PUBLISH = "true";
    process.env.DEXTER_REGISTRY = "ghcr.io/my-org";
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-publish-skip-"));
    const manifest = await buildDeployManifest({
      rootDir,
      runDir: path.join(rootDir, "runs", "run-3"),
      runId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      project: "dexter",
    });
    const result = await publishDeployImage(rootDir, manifest);
    expect(result.skipped).toBe(true);
    expect(result.published).toBe(false);
    await fs.remove(rootDir);
  });
});
