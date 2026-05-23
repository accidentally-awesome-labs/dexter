import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { buildDeployImage, ensureDeployDockerfile } from "../src/release/deploy-build.js";
import { buildDeployManifest } from "../src/release/deploy-manifest.js";

describe("deploy build", () => {
  it("scaffolds Dockerfile when missing", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-dockerfile-"));
    const created = await ensureDeployDockerfile(rootDir);
    expect(created).toBe(true);
    expect(await fs.pathExists(path.join(rootDir, "Dockerfile"))).toBe(true);
    await fs.remove(rootDir);
  });

  it("skips docker build when DEXTER_SKIP_DEPLOY_BUILD is true", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-skip-build-"));
    const previous = process.env.DEXTER_SKIP_DEPLOY_BUILD;
    process.env.DEXTER_SKIP_DEPLOY_BUILD = "true";
    const manifest = await buildDeployManifest({
      rootDir,
      runDir: path.join(rootDir, "runs", "run-1"),
      runId: "run-1",
      project: "sample",
    });
    const result = await buildDeployImage(rootDir, manifest);
    expect(result.skipped).toBe(true);
    if (previous) {
      process.env.DEXTER_SKIP_DEPLOY_BUILD = previous;
    } else {
      delete process.env.DEXTER_SKIP_DEPLOY_BUILD;
    }
    await fs.remove(rootDir);
  });
});
