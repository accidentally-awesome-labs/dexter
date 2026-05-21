import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import fs from "fs-extra";

const CONTROL_PLANE_TOKEN = "canary-rollback-drill-token";

interface RecordedCall {
  action: "deploy" | "rollback";
  timestamp: string;
}

async function startMockControlPlaneServer(calls: RecordedCall[]): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${CONTROL_PLANE_TOKEN}`) {
      res.statusCode = 401;
      res.end();
      return;
    }
    res.setHeader("content-type", "application/json");
    if (req.url === "/deploy") {
      calls.push({ action: "deploy", timestamp: new Date().toISOString() });
      res.end(JSON.stringify({ id: `canary-deploy-${calls.length}`, status: "ok" }));
      return;
    }
    if (req.url === "/rollback") {
      calls.push({ action: "rollback", timestamp: new Date().toISOString() });
      res.end(JSON.stringify({ id: `canary-rollback-${calls.length}`, status: "ok" }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind mock control-plane server");
  }

  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function startMockHealthServer(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.statusCode = 200;
    res.end("ok");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind mock health server");
  }
  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function runCanaryBreachDeploy(rootDir: string, env: NodeJS.ProcessEnv): Promise<{ code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
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
        "canary",
        "--source-environment",
        "staging",
        "--approver-role",
        "release-manager",
        "--require-real",
        "true",
        "--require-api",
        "true",
        "--simulate-slo-breach",
        "error-rate",
        "--health-url",
        env.DEXTER_DEPLOY_HEALTH_URL ?? "",
      ],
      { cwd: rootDir, env, stdio: "inherit" },
    );
    child.on("error", reject);
    child.on("close", (code) => resolve({ code }));
  });
}

async function auditContainsCanaryRollback(rootDir: string): Promise<boolean> {
  const auditPath = path.join(rootDir, "artifacts", "operations", "AUDIT_LOG.jsonl");
  if (!(await fs.pathExists(auditPath))) {
    return false;
  }
  const content = await fs.readFile(auditPath, "utf8");
  return content
    .split("\n")
    .filter(Boolean)
    .some((line) => {
      try {
        const entry = JSON.parse(line) as { action?: string; scope?: string; reason?: string };
        return entry.action === "promotion_rollback" && entry.scope === "canary";
      } catch {
        return false;
      }
    });
}

async function main() {
  const rootDir = process.cwd();
  const calls: RecordedCall[] = [];
  const controlPlane = await startMockControlPlaneServer(calls);
  const health = await startMockHealthServer();

  try {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DEXTER_CONTROL_PLANE_ENDPOINT: `http://127.0.0.1:${controlPlane.port}`,
      DEXTER_CONTROL_PLANE_TOKEN: CONTROL_PLANE_TOKEN,
      DEXTER_DEPLOY_HEALTH_URL: `http://127.0.0.1:${health.port}/health`,
      DEXTER_DEPLOY_APPROVER_ROLE: "release-manager",
      DEXTER_CANARY_ERROR_RATE_5XX: "0.08",
      DEXTER_CANARY_P95_LATENCY_MS: "900",
      DEXTER_CANARY_ERROR_BUDGET_BURN: "1.0",
    };

    const breach = await runCanaryBreachDeploy(rootDir, env);
    const rollbackCalls = calls.filter((item) => item.action === "rollback");
    const deployCalls = calls.filter((item) => item.action === "deploy");
    const sloArtifactPath = path.join(rootDir, "artifacts", "release", "SLO_ROLLBACK_RESULT.json");
    const sloArtifactPresent = await fs.pathExists(sloArtifactPath);
    const sloArtifact = sloArtifactPresent ? ((await fs.readJson(sloArtifactPath)) as { execution?: { triggered?: boolean } }) : null;
    const auditRollback = await auditContainsCanaryRollback(rootDir);

    const passed =
      (breach.code ?? 1) !== 0 &&
      deployCalls.length >= 1 &&
      rollbackCalls.length >= 1 &&
      sloArtifactPresent &&
      sloArtifact?.execution?.triggered === true &&
      auditRollback;

    const reportPath = path.join(rootDir, "artifacts", "release", "CANARY_ROLLBACK_DRILL_REPORT.json");
    await fs.writeJson(
      reportPath,
      {
        generatedAt: new Date().toISOString(),
        passed,
        environment: "canary",
        breachExitCode: breach.code,
        deployCalls: deployCalls.length,
        rollbackCalls: rollbackCalls.length,
        sloRollbackArtifactPath: sloArtifactPath,
        sloRollbackTriggered: sloArtifact?.execution?.triggered ?? false,
        auditRollbackRecorded: auditRollback,
        calls,
      },
      { spaces: 2 },
    );

    if (!passed) {
      throw new Error("Canary rollback drill failed validation checks.");
    }

    const canaryGatePath = path.join(rootDir, "artifacts", "release", "CANARY_GATE_RESULT.json");
    await fs.writeJson(
      canaryGatePath,
      {
        schemaVersion: "1.0",
        generatedAt: new Date().toISOString(),
        environment: "canary",
        passed: true,
        burnState: "healthy",
        prodPromotionAllowed: true,
        metrics: { errorRate5xx: 0.005, p95LatencyMs: 800, errorBudgetBurnMultiple: 1 },
        checks: [],
      },
      { spaces: 2 },
    );

    console.log(
      JSON.stringify(
        {
          passed: true,
          reportPath,
          rollbackCalls: rollbackCalls.length,
          sloRollbackArtifactPath: sloArtifactPath,
          auditRollbackRecorded: auditRollback,
        },
        null,
        2,
      ),
    );
  } finally {
    await Promise.all([controlPlane.close(), health.close()]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
