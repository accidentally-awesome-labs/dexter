import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import fs from "fs-extra";
import { startCoolifyBridgeServer } from "../providers/deployment/coolify-bridge-server.js";
import { defaultCoolifyAppsConfigPath } from "../providers/deployment/coolify-client.js";

const COOLIFY_API_TOKEN = "integration-coolify-token";
const BRIDGE_TOKEN = "integration-bridge-token";

interface MockCoolifyState {
  applications: Array<{ uuid: string; name: string; git_commit_sha: string }>;
  deployCount: number;
  restartCount: number;
}

async function startMockCoolifyApi(state: MockCoolifyState): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.headers.authorization !== `Bearer ${COOLIFY_API_TOKEN}`) {
      res.statusCode = 401;
      res.end(JSON.stringify({ message: "unauthorized" }));
      return;
    }

    const url = req.url ?? "";
    if (req.method === "GET" && url === "/api/v1/applications") {
      res.statusCode = 200;
      res.end(JSON.stringify(state.applications));
      return;
    }

    if (req.method === "POST" && url === "/api/v1/deploy") {
      state.deployCount += 1;
      const deploymentUuid = `dep-${state.deployCount}`;
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          deployments: [
            {
              deployment_uuid: deploymentUuid,
              resource_uuid: state.applications[0]?.uuid,
              message: "Application dexter deployment queued.",
            },
          ],
        }),
      );
      return;
    }

    const restartMatch = url.match(/^\/api\/v1\/applications\/([^/]+)\/restart$/);
    if (req.method === "POST" && restartMatch) {
      state.restartCount += 1;
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          message: "Restart queued",
          deployment_uuid: `restart-${state.restartCount}`,
        }),
      );
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ message: "not found" }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind mock coolify api");
  }
  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function startHealthServer(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.statusCode = 200;
    res.end("ok");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind health server");
  }
  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function seedGovernanceArtifacts(rootDir: string): Promise<void> {
  const planningDir = path.join(rootDir, "artifacts", "planning");
  await fs.ensureDir(planningDir);
  await fs.writeFile(path.join(planningDir, "PRD.md"), "prd");
  await fs.writeFile(path.join(planningDir, "TASK_GRAPH.json"), "{\"tasks\":[]}");
  await fs.writeFile(path.join(planningDir, "ARCHITECTURE_SPEC.md"), "arch");
  await fs.writeFile(path.join(planningDir, "NFR_SPEC.md"), "nfr");
  await fs.writeFile(path.join(planningDir, "TEST_STRATEGY.md"), "tests");

  const { generatePlanningSignatures } = await import("../planning/signature.js");
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

async function runCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), env, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => resolve(code));
  });
}

async function main(): Promise<void> {
  const rootDir = process.cwd();
  const state: MockCoolifyState = {
    applications: [{ uuid: crypto.randomUUID(), name: "dexter", git_commit_sha: "abc123" }],
    deployCount: 0,
    restartCount: 0,
  };

  const mockCoolify = await startMockCoolifyApi(state);
  const health = await startHealthServer();
  const appsPath = defaultCoolifyAppsConfigPath(rootDir);
  await fs.ensureDir(path.dirname(appsPath));
  await fs.writeJson(appsPath, {
    schemaVersion: "1.0",
    applications: {
      dexter: { uuid: state.applications[0].uuid },
    },
  });

  process.env.COOLIFY_ORIGIN = `http://127.0.0.1:${mockCoolify.port}`;
  process.env.COOLIFY_API_TOKEN = COOLIFY_API_TOKEN;
  process.env.DEXTER_BRIDGE_TOKEN = BRIDGE_TOKEN;
  process.env.DEXTER_BRIDGE_HOST = "127.0.0.1";

  const bridge = startCoolifyBridgeServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => bridge.once("listening", resolve));
  const bridgeAddress = bridge.address();
  if (!bridgeAddress || typeof bridgeAddress === "string") {
    throw new Error("bridge failed to listen");
  }
  const bridgeUrl = `http://127.0.0.1:${bridgeAddress.port}`;

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DEXTER_COOLIFY_API_URL: bridgeUrl,
    DEXTER_COOLIFY_TOKEN: BRIDGE_TOKEN,
    DEXTER_DEPLOY_HEALTH_URL: `http://127.0.0.1:${health.port}/health`,
    DEXTER_DEPLOY_AUTH_KEY: "integration-deploy-key",
    DEXTER_POLICY_BUNDLE_KEY: "integration-policy-key",
  };

  try {
    await seedGovernanceArtifacts(rootDir);

    const preflightCode = await runCommand("npx", ["tsx", "src/dev/run-production-preflight.ts", "--probe-api", "true"], env);
    if (preflightCode !== 0) {
      throw new Error(`production:preflight failed with code ${preflightCode}`);
    }

    const deployCode = await runCommand(
      "npx",
      [
        "tsx",
        "src/index.ts",
        "deploy-self",
        "--control-plane",
        "coolify",
        "--app",
        "dexter",
        "--environment",
        "staging",
        "--source-environment",
        "dev",
        "--approver-role",
        "operator",
        "--require-real",
        "true",
        "--require-api",
        "true",
        "--health-url",
        `http://127.0.0.1:${health.port}/health`,
      ],
      env,
    );
    if (deployCode !== 0) {
      throw new Error(`deploy:self failed with code ${deployCode}`);
    }

    const deployResult = (await fs.readJson(
      path.join(rootDir, "artifacts", "release", "self_deploy_result.json"),
    )) as { mode?: string; deploymentId?: string };
    if (deployResult.mode !== "api") {
      throw new Error(`Expected mode=api, got ${String(deployResult.mode)}`);
    }

    console.log(
      JSON.stringify(
        {
          status: "ok",
          step: "coolify-integration-drill",
          mockCoolifyPort: mockCoolify.port,
          bridgeUrl,
          healthUrl: `http://127.0.0.1:${health.port}/health`,
          deployCount: state.deployCount,
          mode: deployResult.mode,
          deploymentId: deployResult.deploymentId,
        },
        null,
        2,
      ),
    );
  } finally {
    bridge.close();
    await mockCoolify.close();
    await health.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
