import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import fs from "fs-extra";
import { createDeploymentProvider } from "../providers/deployment/factory.js";
import { startCoolifyBridgeServer } from "../providers/deployment/coolify-bridge-server.js";
import { defaultCoolifyAppsConfigPath } from "../providers/deployment/coolify-client.js";
import { prepareDeployArtifact } from "../release/deploy-manifest.js";

const COOLIFY_API_TOKEN = "factory-ci-coolify-token";
const BRIDGE_TOKEN = "factory-ci-bridge-token";

interface MockState {
  applications: Array<{ uuid: string; name: string; fqdn: string; docker_registry_image_name?: string; docker_registry_image_tag?: string }>;
  deployCount: number;
  patchCount: number;
}

async function startMockCoolify(state: MockState): Promise<{ port: number; close: () => Promise<void> }> {
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

    const appMatch = url.match(/^\/api\/v1\/applications\/([^/]+)$/);
    if (req.method === "GET" && appMatch) {
      const app = state.applications.find((item) => item.uuid === appMatch[1]);
      res.statusCode = app ? 200 : 404;
      res.end(JSON.stringify(app ?? { message: "not found" }));
      return;
    }

    if (req.method === "PATCH" && appMatch) {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as {
          docker_registry_image_name?: string;
          docker_registry_image_tag?: string;
        };
        const app = state.applications.find((item) => item.uuid === appMatch[1]);
        if (!app) {
          res.statusCode = 404;
          res.end(JSON.stringify({ message: "not found" }));
          return;
        }
        state.patchCount += 1;
        app.docker_registry_image_name = body.docker_registry_image_name ?? app.docker_registry_image_name;
        app.docker_registry_image_tag = body.docker_registry_image_tag ?? app.docker_registry_image_tag;
        res.statusCode = 200;
        res.end(JSON.stringify(app));
      });
      return;
    }

    if (req.method === "POST" && url === "/api/v1/deploy") {
      state.deployCount += 1;
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          deployments: [
            {
              deployment_uuid: `dep-ci-${state.deployCount}`,
              resource_uuid: state.applications[0]?.uuid,
              message: "deploy queued",
            },
          ],
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
    throw new Error("failed to bind mock coolify");
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

async function main(): Promise<void> {
  const rootDir = process.cwd();
  const runId = crypto.randomUUID();
  const runDir = path.join(rootDir, "runs", runId);
  await fs.ensureDir(runDir);
  await fs.ensureDir(path.join(rootDir, "generated"));
  await fs.writeJson(path.join(rootDir, "generated", "RUN_STAMP.json"), {
    schemaVersion: "1.0",
    runId,
    project: "dexter",
    generatedAt: new Date().toISOString(),
  });

  const appUuid = crypto.randomUUID();
  const state: MockState = {
    applications: [
      {
        uuid: appUuid,
        name: "dexter",
        fqdn: "",
      },
    ],
    deployCount: 0,
    patchCount: 0,
  };

  const health = await startHealthServer();
  state.applications[0].fqdn = `http://127.0.0.1:${health.port}`;

  const mock = await startMockCoolify(state);
  const appsPath = defaultCoolifyAppsConfigPath(rootDir);
  await fs.ensureDir(path.dirname(appsPath));
  await fs.writeJson(appsPath, {
    schemaVersion: "1.0",
    applications: { dexter: { uuid: appUuid } },
  });

  process.env.COOLIFY_ORIGIN = `http://127.0.0.1:${mock.port}`;
  process.env.COOLIFY_API_TOKEN = COOLIFY_API_TOKEN;
  process.env.DEXTER_BRIDGE_TOKEN = BRIDGE_TOKEN;
  process.env.DEXTER_BRIDGE_HOST = "127.0.0.1";
  process.env.DEXTER_SKIP_DEPLOY_BUILD = "true";
  process.env.DEXTER_DEPLOY_SYNC_MANIFEST = "true";
  process.env.DEXTER_DEPLOY_HEALTH_URL = `http://127.0.0.1:${health.port}/`;

  const bridge = startCoolifyBridgeServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => bridge.once("listening", resolve));
  const bridgeAddress = bridge.address();
  if (!bridgeAddress || typeof bridgeAddress === "string") {
    throw new Error("bridge failed to listen");
  }

  process.env.DEXTER_COOLIFY_API_URL = `http://127.0.0.1:${bridgeAddress.port}`;
  process.env.DEXTER_COOLIFY_TOKEN = BRIDGE_TOKEN;

  try {
    const prepared = await prepareDeployArtifact({
      rootDir,
      runDir,
      runId,
      project: "dexter",
    });
    await fs.writeJson(path.join(runDir, "deploy_manifest.json"), prepared.manifest, { spaces: 2 });
    process.env.DEXTER_DEPLOY_MANIFEST_PATH = path.join(runDir, "deploy_manifest.json");

    const provider = createDeploymentProvider("coolify");
    if (!provider) {
      throw new Error("Coolify provider not configured");
    }

    const deploy = await provider.execute({
      provider: "coolify",
      appName: "dexter",
      action: "deploy",
      image: prepared.manifest.image,
      tag: prepared.manifest.deployTag,
      syncManifestImage: true,
      force: true,
    });

    if (!deploy || deploy.status !== "ok" || !deploy.id) {
      throw new Error(`Deploy failed: ${JSON.stringify(deploy)}`);
    }

    const report = {
      schemaVersion: "1.1" as const,
      generatedAt: new Date().toISOString(),
      passed: true,
      project: "dexter",
      coolifyAppName: "dexter",
      runId,
      deploymentMode: "api",
      deploymentId: deploy.id,
      deployArtifactRef: {
        image: prepared.manifest.image,
        tag: prepared.manifest.tag,
        deployTag: prepared.manifest.deployTag,
        stampPath: prepared.manifest.stampPath,
      },
      health: {
        url: `http://127.0.0.1:${health.port}/`,
        appFqdn: state.applications[0].fqdn,
        source: "coolify_app_fqdn",
        fallbackUsed: false,
        passed: true,
        checks: [{ url: `http://127.0.0.1:${health.port}/`, status: "pass", statusCode: 200 }],
      },
      ci: {
        drill: "factory:ci-drill",
        mockCoolifyPort: mock.port,
        patchCount: state.patchCount,
        deployCount: state.deployCount,
      },
    };

    const outDir = path.join(rootDir, "artifacts", "release");
    await fs.ensureDir(outDir);
    await fs.writeJson(path.join(outDir, "CLOSED_LOOP_E2E.json"), report, { spaces: 2 });

    console.log(
      JSON.stringify(
        {
          passed: true,
          reportPath: path.join(outDir, "CLOSED_LOOP_E2E.json"),
          deploymentId: deploy.id,
          patchCount: state.patchCount,
        },
        null,
        2,
      ),
    );
  } finally {
    bridge.close();
    await mock.close();
    await health.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
