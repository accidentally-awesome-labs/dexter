import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, describe, expect, it } from "vitest";
import { generatePlanningSignatures } from "../src/planning/signature.js";
import {
  runProductionPreflight,
  writeProductionPreflightArtifacts,
} from "../src/operations/production-preflight.js";

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

const envKeys = [
  "DEXTER_COOLIFY_API_URL",
  "DEXTER_COOLIFY_TOKEN",
  "DEXTER_DEPLOY_HEALTH_URL",
  "DEXTER_DEPLOY_AUTH_KEY",
  "DEXTER_POLICY_BUNDLE_KEY",
  "DEXTER_ALERT_WEBHOOK_URL",
];

afterEach(() => {
  restoreEnv(envKeys);
});

async function seedPromotionArtifacts(rootDir: string): Promise<void> {
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
  await fs.ensureDir(path.join(rootDir, "artifacts", "execution"));
  await fs.writeJson(path.join(rootDir, "artifacts", "execution", "ESCALATION_STATE.json"), {
    generatedAt: new Date().toISOString(),
    items: [],
  });
  await fs.ensureDir(path.join(rootDir, "artifacts", "release"));
  await fs.writeJson(path.join(rootDir, "artifacts", "release", "SOAK_STATUS.json"), {
    gateSatisfied: true,
    currentStreak: 10,
    targetStreak: 10,
  });
  await fs.writeJson(path.join(rootDir, "artifacts", "release", "READINESS_REPORT.json"), {
    passRate: 1,
    memoryHitRate: 1,
    repeatedFailureRate: 0,
    avgTimeToReadyMs: 100,
  });
}

describe("production preflight", () => {
  it("fails when control plane credentials are missing", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-prod-preflight-"));
    await seedPromotionArtifacts(rootDir);
    delete process.env.DEXTER_COOLIFY_API_URL;
    delete process.env.DEXTER_COOLIFY_TOKEN;

    const report = await runProductionPreflight({
      rootDir,
      requireApiProbe: false,
    });
    expect(report.passed).toBe(false);
    expect(report.checks.find((check) => check.id === "control_plane_credentials")?.passed).toBe(false);
    await fs.remove(rootDir);
  });

  it("passes with mock API, health URL, and governance artifacts", async () => {
    saveEnv(envKeys);
    const server = http.createServer((_req, res) => {
      res.statusCode = 200;
      res.end("ok");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("failed to bind test server");
    }

    process.env.DEXTER_COOLIFY_API_URL = `http://127.0.0.1:${address.port}`;
    process.env.DEXTER_COOLIFY_TOKEN = "test-token";
    process.env.DEXTER_DEPLOY_HEALTH_URL = "http://127.0.0.1:9999/health";
    process.env.DEXTER_DEPLOY_AUTH_KEY = "prod-deploy-key-test";
    process.env.DEXTER_POLICY_BUNDLE_KEY = "prod-policy-key-test";

    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-prod-preflight-pass-"));
    await seedPromotionArtifacts(rootDir);

    const report = await runProductionPreflight({
      rootDir,
      requireApiProbe: true,
      requireAlerts: false,
      strictSecrets: true,
    });

    const artifacts = await writeProductionPreflightArtifacts(rootDir, report);
    expect(await fs.pathExists(artifacts.jsonPath)).toBe(true);
    expect(report.checks.find((check) => check.id === "control_plane_credentials")?.passed).toBe(true);
    expect(report.checks.find((check) => check.id === "control_plane_reachable")?.passed).toBe(true);
    expect(report.checks.find((check) => check.id === "deploy_health_url")?.passed).toBe(true);

    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await fs.remove(rootDir);
  });
});
