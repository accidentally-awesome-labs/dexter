import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { generateProvenance, verifyProvenance } from "../src/release/provenance.js";

async function seedRelease(rootDir: string) {
  const releaseDir = path.join(rootDir, "artifacts", "release");
  await fs.ensureDir(releaseDir);
  await fs.writeFile(path.join(releaseDir, "DEPLOYMENT_GUIDE.md"), "deploy");
  await fs.writeFile(path.join(releaseDir, "OPERATIONS_RUNBOOK.md"), "ops");
  await fs.writeFile(path.join(releaseDir, "RELEASE_NOTES.md"), "notes");
  await fs.writeFile(path.join(releaseDir, "PRODUCTION_READINESS_CHECKLIST.md"), "checklist");
  const verificationDir = path.join(rootDir, "artifacts", "verification");
  await fs.ensureDir(verificationDir);
  await fs.writeFile(path.join(verificationDir, "SBOM_AND_PROVENANCE.md"), "sbom");
  await fs.writeFile(path.join(verificationDir, "SECURITY_REPORT.md"), "security");
}

describe("provenance export", () => {
  it("writes in-toto style provenance with release subjects", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-prov-"));
    await seedRelease(rootDir);

    const result = await generateProvenance(rootDir, { runId: "run-123", project: "proj-x" });
    expect(result.outputPath.endsWith("PROVENANCE.intoto.json")).toBe(true);
    expect(result.provenance._type).toBe("https://in-toto.io/Statement/v1");
    expect(result.provenance.predicateType).toBe("https://slsa.dev/provenance/v1");
    expect(result.provenance.subject.length).toBeGreaterThan(0);
    await expect(verifyProvenance(rootDir)).resolves.toBe(true);
  });

  it("fails verification when a linked subject is missing", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-prov-miss-"));
    await seedRelease(rootDir);
    await generateProvenance(rootDir, { runId: "run-456", project: "proj-y" });
    await fs.remove(path.join(rootDir, "artifacts", "verification", "SBOM_AND_PROVENANCE.md"));
    await expect(verifyProvenance(rootDir)).resolves.toBe(false);
  });
});
