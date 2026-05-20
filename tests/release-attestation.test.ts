import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, describe, expect, it } from "vitest";
import { generateAttestation, verifyAttestation } from "../src/release/attestation.js";
import { generateKeyPairSync } from "node:crypto";
import { generateProvenance } from "../src/release/provenance.js";

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
  await generateProvenance(rootDir, { runId: "test-run", project: "test-project" });
}

describe("release attestation", () => {
  afterEach(() => {
    delete process.env.DEXTER_ATTESTATION_KEY;
    delete process.env.DEXTER_ATTESTATION_KEY_ID;
    delete process.env.DEXTER_ATTESTATION_TRUSTED_KEYS;
  });

  it("verifies generated attestation", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-attest-"));
    await seedRelease(rootDir);
    const attestation = await generateAttestation(rootDir);
    expect(attestation.files.some((file) => file.path === "artifacts/verification/SBOM_AND_PROVENANCE.md")).toBe(true);
    expect(attestation.files.some((file) => file.path === "artifacts/release/PROVENANCE.intoto.json")).toBe(true);
    await expect(verifyAttestation(rootDir)).resolves.toBe(true);
  });

  it("fails verification if artifact changes after signing", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-attest-mut-"));
    await seedRelease(rootDir);
    await generateAttestation(rootDir);
    await fs.writeFile(path.join(rootDir, "artifacts", "release", "RELEASE_NOTES.md"), "mutated");
    await expect(verifyAttestation(rootDir)).resolves.toBe(false);
  });

  it("supports key rotation via trusted key ring", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-attest-rotate-"));
    await seedRelease(rootDir);

    process.env.DEXTER_ATTESTATION_KEY = "old-key";
    process.env.DEXTER_ATTESTATION_KEY_ID = "old-key-id";
    await generateAttestation(rootDir);

    process.env.DEXTER_ATTESTATION_KEY = "new-key";
    process.env.DEXTER_ATTESTATION_TRUSTED_KEYS = "old-key";
    await expect(verifyAttestation(rootDir)).resolves.toBe(true);
  });

  it("supports asymmetric signing and verification", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-attest-asym-"));
    await seedRelease(rootDir);

    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    process.env.DEXTER_ATTESTATION_PRIVATE_KEY = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    process.env.DEXTER_ATTESTATION_PUBLIC_KEY = publicKey.export({ format: "pem", type: "spki" }).toString();
    process.env.DEXTER_ATTESTATION_KEY_ID = "ed25519-current";

    const attestation = await generateAttestation(rootDir);
    expect(attestation.signatureAlg).toBe("ed25519");
    expect(attestation.schemaVersion).toBe("1.2");
    await expect(verifyAttestation(rootDir)).resolves.toBe(true);
  });
});
