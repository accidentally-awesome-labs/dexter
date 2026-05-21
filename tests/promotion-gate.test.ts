import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { generateDeployAuthorization, verifyDeployAuthorizationPolicy } from "../src/deploy/authorization.js";
import { assertPromotionAllowed, verifyPromotionAuthPolicy } from "../src/operations/promotion-gate.js";
import { generatePlanningSignatures } from "../src/planning/signature.js";

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

  await fs.ensureDir(path.join(rootDir, "docs", "operations"));
  await fs.copy(
    path.join(process.cwd(), "docs", "operations", "RBAC_POLICY.json"),
    path.join(rootDir, "docs", "operations", "RBAC_POLICY.json"),
  );
  await fs.copy(
    path.join(process.cwd(), "docs", "specs", "DEPLOY_AUTH_POLICY.json"),
    path.join(rootDir, "docs", "specs", "DEPLOY_AUTH_POLICY.json"),
  );
  await fs.copy(
    path.join(process.cwd(), "docs", "operations", "CANARY_SLO_POLICY.json"),
    path.join(rootDir, "docs", "operations", "CANARY_SLO_POLICY.json"),
  );
}

describe("promotion gate", () => {
  it("allows dev to staging promotion for operator role", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-promotion-gate-"));
    await seed(rootDir);

    const promotion = await assertPromotionAllowed({
      rootDir,
      targetEnvironment: "staging",
      sourceEnvironment: "dev",
      controlPlane: "coolify",
      approvedBy: "ops-user",
      approverRole: "operator",
    });

    expect(promotion).toEqual({
      sourceEnvironment: "dev",
      targetEnvironment: "staging",
      approverRole: "operator",
    });

    const auth = await generateDeployAuthorization(rootDir, "dexter-app", {
      approvedBy: "ops-user",
      environment: "staging",
      sourceEnvironment: "dev",
      controlPlane: "coolify",
      tenantId: "tenant-a",
    });
    if (!auth) {
      throw new Error("expected authorization");
    }
    await expect(verifyPromotionAuthPolicy(rootDir, auth, "staging")).resolves.toBe(true);
    await expect(verifyDeployAuthorizationPolicy(rootDir, auth, "staging")).resolves.toBe(true);
  });

  it("blocks staging promotion for observer role", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-promotion-gate2-"));
    await seed(rootDir);

    await expect(
      assertPromotionAllowed({
        rootDir,
        targetEnvironment: "staging",
        sourceEnvironment: "dev",
        controlPlane: "coolify",
        approvedBy: "read-only",
        approverRole: "observer",
      }),
    ).rejects.toThrow(/RBAC/i);
  });

  it("blocks invalid transition", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-promotion-gate3-"));
    await seed(rootDir);

    await expect(
      assertPromotionAllowed({
        rootDir,
        targetEnvironment: "prod",
        sourceEnvironment: "dev",
        controlPlane: "coolify",
        approvedBy: "ops-user",
        approverRole: "release-manager",
      }),
    ).rejects.toThrow(/transition/i);
  });
});
