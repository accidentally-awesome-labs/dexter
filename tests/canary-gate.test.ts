import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import {
  evaluateCanaryGate,
  readCanaryGateStatus,
  writeCanaryGateArtifact,
} from "../src/operations/canary-gate.js";
import { assertPromotionAllowed } from "../src/operations/promotion-gate.js";

async function seedPolicies(rootDir: string) {
  await fs.ensureDir(path.join(rootDir, "docs", "operations"));
  await fs.copy(
    path.join(process.cwd(), "docs", "operations", "RBAC_POLICY.json"),
    path.join(rootDir, "docs", "operations", "RBAC_POLICY.json"),
  );
  await fs.copy(
    path.join(process.cwd(), "docs", "operations", "CANARY_SLO_POLICY.json"),
    path.join(rootDir, "docs", "operations", "CANARY_SLO_POLICY.json"),
  );
  await fs.copy(
    path.join(process.cwd(), "docs", "specs", "DEPLOY_AUTH_POLICY.json"),
    path.join(rootDir, "docs", "specs", "DEPLOY_AUTH_POLICY.json"),
  );
}

describe("canary gate", () => {
  it("passes when metrics are within thresholds", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-canary-gate-"));
    await seedPolicies(rootDir);

    const result = await evaluateCanaryGate(rootDir, {
      errorRate5xx: 0.01,
      p95LatencyMs: 900,
      errorBudgetBurnMultiple: 1.2,
    });
    expect(result.passed).toBe(true);
    expect(result.prodPromotionAllowed).toBe(true);

    const artifact = await writeCanaryGateArtifact(rootDir, result);
    expect(await fs.pathExists(artifact.jsonPath)).toBe(true);
    expect(await fs.pathExists(artifact.markdownPath)).toBe(true);

    const status = await readCanaryGateStatus(rootDir);
    expect(status.present).toBe(true);
    expect(status.passed).toBe(true);
    expect(status.prodPromotionAllowed).toBe(true);
  });

  it("fails when metrics breach thresholds", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-canary-gate2-"));
    await seedPolicies(rootDir);

    const result = await evaluateCanaryGate(rootDir, {
      errorRate5xx: 0.05,
      p95LatencyMs: 2000,
      errorBudgetBurnMultiple: 3,
    });
    expect(result.passed).toBe(false);
    expect(result.burnState).toBe("breach");
    await writeCanaryGateArtifact(rootDir, result);
    const status = await readCanaryGateStatus(rootDir);
    expect(status.prodPromotionAllowed).toBe(false);
  });
});

describe("prod promotion canary prerequisite", () => {
  it("blocks prod when canary gate failed", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-canary-gate3-"));
    await seedPolicies(rootDir);
    const failed = await evaluateCanaryGate(rootDir, {
      errorRate5xx: 0.1,
      p95LatencyMs: 3000,
      errorBudgetBurnMultiple: 4,
    });
    await writeCanaryGateArtifact(rootDir, failed);

    await expect(
      assertPromotionAllowed({
        rootDir,
        targetEnvironment: "prod",
        sourceEnvironment: "canary",
        controlPlane: "coolify",
        approvedBy: "release-manager",
        approverRole: "release-manager",
      }),
    ).rejects.toThrow(/canary gates failed/i);
  });

  it("allows prod when canary gate passed", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-canary-gate4-"));
    await seedPolicies(rootDir);
    const passed = await evaluateCanaryGate(rootDir, {
      errorRate5xx: 0,
      p95LatencyMs: 100,
      errorBudgetBurnMultiple: 0.5,
    });
    await writeCanaryGateArtifact(rootDir, passed);

    const promotion = await assertPromotionAllowed({
      rootDir,
      targetEnvironment: "prod",
      sourceEnvironment: "canary",
      controlPlane: "coolify",
      approvedBy: "release-manager",
      approverRole: "release-manager",
    });
    expect(promotion.targetEnvironment).toBe("prod");
  });
});
