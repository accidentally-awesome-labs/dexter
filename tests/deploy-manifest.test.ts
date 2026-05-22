import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import {
  buildDeployManifest,
  loadDeployManifest,
  readRunStamp,
  writeDeployManifest,
} from "../src/release/deploy-manifest.js";

describe("deploy manifest", () => {
  it("builds manifest from run stamp when present", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-manifest-"));
    const runId = "655e012f-b152-45ab-9e8f-6cc710b9ce4e";
    await fs.ensureDir(path.join(rootDir, "generated"));
    await fs.writeJson(path.join(rootDir, "generated", "RUN_STAMP.json"), {
      schemaVersion: "1.0",
      runId,
      project: "sample-app",
      generatedAt: "2026-05-21T12:00:00.000Z",
    });

    const manifest = await buildDeployManifest({
      rootDir,
      runDir: path.join(rootDir, "runs", runId),
      runId,
      project: "sample-app",
    });

    expect(manifest.runId).toBe(runId);
    expect(manifest.project).toBe("sample-app");
    expect(manifest.deployTag).toBe("run-655e012fb152");
    expect(manifest.image).toBe("dexter/sample-app");
    await fs.remove(rootDir);
  });

  it("writes manifest to run dir and sets env path", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-manifest-write-"));
    const runId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const runDir = path.join(rootDir, "runs", runId);
    await fs.ensureDir(runDir);

    const { manifestPath, manifest } = await writeDeployManifest({
      rootDir,
      runDir,
      runId,
      project: "dexter",
    });

    expect(await fs.pathExists(manifestPath)).toBe(true);
    expect(process.env.DEXTER_DEPLOY_MANIFEST_PATH).toBe(manifestPath);
    const loaded = await loadDeployManifest();
    expect(loaded?.deployTag).toBe(manifest.deployTag);
    await fs.remove(rootDir);
    delete process.env.DEXTER_DEPLOY_MANIFEST_PATH;
  });

  it("returns null stamp when file missing", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-manifest-stamp-"));
    const stamp = await readRunStamp(rootDir);
    expect(stamp).toBeNull();
    await fs.remove(rootDir);
  });
});
