import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import fs from "fs-extra";

interface RecordedCall {
  action: "deploy" | "rollback";
  appName: string;
  timestamp: string;
}

const CONTROL_PLANE_TOKEN = "local-mock-token";

async function startMockControlPlaneServer(calls: RecordedCall[]): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${CONTROL_PLANE_TOKEN}`) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString("utf8");
      const parsed = rawBody ? (JSON.parse(rawBody) as { appName?: string; action?: "deploy" | "rollback" }) : {};
      const action = req.url === "/deploy" ? "deploy" : req.url === "/rollback" ? "rollback" : parsed.action;
      if (!action || (action !== "deploy" && action !== "rollback")) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "unknown-action" }));
        return;
      }

      const appName = parsed.appName ?? "unknown-app";
      calls.push({
        action,
        appName,
        timestamp: new Date().toISOString(),
      });

      const suffix = action === "deploy" ? "deploymentId" : "rollbackId";
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ [suffix]: `mock-${action}-${calls.length}`, status: "ok", revision: `rev-${calls.length}` }));
    });
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
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
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
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

async function runDeployDrillWithEnv(rootDir: string, env: NodeJS.ProcessEnv): Promise<{ code: number | null }> {
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
        "--rollback-drill",
        "true",
        "--require-real",
        "true",
        "--require-api",
        "true",
      ],
      {
        cwd: rootDir,
        env,
        stdio: "inherit",
      },
    );
    child.on("error", reject);
    child.on("close", (code) => resolve({ code }));
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
      DEXTER_COOLIFY_API_URL: `http://127.0.0.1:${controlPlane.port}`,
      DEXTER_COOLIFY_TOKEN: CONTROL_PLANE_TOKEN,
      DEXTER_DEPLOY_HEALTH_URL: `http://127.0.0.1:${health.port}/health`,
    };
    const { code } = await runDeployDrillWithEnv(rootDir, env);
    const outputPath = path.join(rootDir, "artifacts", "release", "local_api_drill_report.json");
    await fs.ensureDir(path.dirname(outputPath));
    await fs.writeJson(
      outputPath,
      {
        generatedAt: new Date().toISOString(),
        passed: code === 0,
        commandExitCode: code,
        calls,
      },
      { spaces: 2 },
    );
    if (code !== 0) {
      throw new Error(`Local API drill failed with exit code ${code ?? "null"}.`);
    }
    console.log(
      JSON.stringify(
        {
          outputPath,
          passed: true,
          callCount: calls.length,
          callsByAction: {
            deploy: calls.filter((item) => item.action === "deploy").length,
            rollback: calls.filter((item) => item.action === "rollback").length,
          },
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
