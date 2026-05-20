import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { generatePlanningSignatures } from "../src/planning/signature.js";
import {
  consumeDeployNonce,
  generateDeployAuthorization,
  isDeployAuthorizationRevoked,
  revokeDeployAuthorizationNonce,
  verifyDeployAuthorization,
  verifyDeployAuthorizationPolicy,
  verifyDeployAuthorizationScope,
} from "../src/deploy/authorization.js";

async function seed(rootDir: string) {
  const planningDir = path.join(rootDir, "artifacts", "planning");
  await fs.ensureDir(planningDir);
  await fs.writeFile(path.join(planningDir, "PRD.md"), "prd");
  await fs.writeFile(path.join(planningDir, "TASK_GRAPH.json"), "{\"tasks\":[]}");
  await fs.writeFile(path.join(planningDir, "ARCHITECTURE_SPEC.md"), "arch");
  await fs.writeFile(path.join(planningDir, "NFR_SPEC.md"), "nfr");
  await fs.writeFile(path.join(planningDir, "TEST_STRATEGY.md"), "tests");
  await generatePlanningSignatures(rootDir);

  await fs.ensureDir(path.join(rootDir, "runs", "latest"));
  await fs.writeJson(path.join(rootDir, "runs", "latest", "supply_chain_gate.json"), {
    provenanceValid: true,
    attestationValid: true,
    passed: true,
  });
}

describe("deploy authorization", () => {
  it("generates and verifies valid authorization", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-deploy-auth-"));
    await seed(rootDir);
    const auth = await generateDeployAuthorization(rootDir, "dexter-app", {
      approvedBy: "ops-user",
      environment: "production",
      controlPlane: "coolify",
      tenantId: "tenant-a",
    });
    if (!auth) {
      throw new Error("expected authorization");
    }
    expect(verifyDeployAuthorization("dexter-app", auth)).toBe(true);
    expect(
      verifyDeployAuthorizationScope(auth, {
        environment: "production",
        controlPlane: "coolify",
        tenantId: "tenant-a",
      }),
    ).toBe(true);
  });

  it("rejects auth for different app", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-deploy-auth2-"));
    await seed(rootDir);
    const auth = await generateDeployAuthorization(rootDir, "dexter-app");
    if (!auth) {
      throw new Error("expected authorization");
    }
    expect(verifyDeployAuthorization("other-app", auth)).toBe(false);
  });

  it("rejects nonce replay", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-deploy-auth3-"));
    await seed(rootDir);
    const auth = await generateDeployAuthorization(rootDir, "dexter-app");
    if (!auth) {
      throw new Error("expected authorization");
    }
    await expect(consumeDeployNonce(rootDir, auth)).resolves.toBe(true);
    await expect(consumeDeployNonce(rootDir, auth)).resolves.toBe(false);
  });

  it("rejects revoked authorization", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-deploy-auth4-"));
    await seed(rootDir);
    const auth = await generateDeployAuthorization(rootDir, "dexter-app");
    if (!auth) {
      throw new Error("expected authorization");
    }
    await revokeDeployAuthorizationNonce(rootDir, auth.nonce, "compromised", auth.expiresAt);
    await expect(isDeployAuthorizationRevoked(rootDir, auth)).resolves.toBe(true);
  });

  it("rejects cross-environment policy mismatch by default", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-deploy-auth5-"));
    await seed(rootDir);
    const auth = await generateDeployAuthorization(rootDir, "dexter-app", {
      environment: "production",
      sourceEnvironment: "staging",
      controlPlane: "coolify",
      tenantId: "tenant-a",
    });
    if (!auth) {
      throw new Error("expected authorization");
    }
    await expect(verifyDeployAuthorizationPolicy(rootDir, auth, "production")).resolves.toBe(false);
  });

  it("rejects policy-tampered bundle", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-deploy-auth6-"));
    await seed(rootDir);
    const auth = await generateDeployAuthorization(rootDir, "dexter-app");
    if (!auth) {
      throw new Error("expected authorization");
    }

    const bundlePath = path.join(rootDir, "docs", "specs", "DEPLOY_AUTH_POLICY.bundle.json");
    const bundle = await fs.readJson(bundlePath);
    bundle.policyDigest = "bad-digest";
    await fs.writeJson(bundlePath, bundle, { spaces: 2 });

    await expect(verifyDeployAuthorizationPolicy(rootDir, auth, auth.environment)).resolves.toBe(false);
  });
});
