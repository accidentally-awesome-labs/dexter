import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, describe, expect, it } from "vitest";
import { CoolifyClient } from "../src/providers/deployment/coolify-client.js";
import { handleBridgeRequest } from "../src/providers/deployment/coolify-bridge-server.js";

function startMockCoolifyApi(
  handlers: Record<string, (req: http.IncomingMessage) => { status: number; body: unknown }>,
): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const handler = handlers[req.url ?? ""];
    if (!handler) {
      res.statusCode = 404;
      res.end(JSON.stringify({ message: "not found" }));
      return;
    }
    const result = handler(req);
    res.statusCode = result.status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(result.body));
  });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error) => {
      if (error) {
        reject(error);
        return;
      }
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("failed to bind mock coolify api"));
        return;
      }
      resolve({
        port: address.port,
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((closeError) => (closeError ? closeReject(closeError) : closeResolve()));
          }),
      });
    });
  });
}

describe("CoolifyClient", () => {
  it("deploys by application uuid from apps config", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-coolify-client-"));
    await fs.ensureDir(path.join(rootDir, "infra", "coolify"));
    await fs.writeJson(path.join(rootDir, "infra", "coolify", "apps.json"), {
      schemaVersion: "1.0",
      applications: {
        dexter: { uuid: "app-uuid-1" },
      },
    });

    const mock = await startMockCoolifyApi({
      "/api/v1/deploy": () => ({
        status: 200,
        body: {
          deployments: [
            {
              deployment_uuid: "dep-123",
              resource_uuid: "app-uuid-1",
              message: "queued",
            },
          ],
        },
      }),
    });

    const client = new CoolifyClient({
      origin: `http://127.0.0.1:${mock.port}`,
      apiToken: "coolify-token",
      appsConfigPath: path.join(rootDir, "infra", "coolify", "apps.json"),
    });

    const result = await client.deployApplication("dexter", { rootDir });
    expect(result.deploymentId).toBe("dep-123");
    await mock.close();
    await fs.remove(rootDir);
  });

  it("rolls back via application restart endpoint", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-coolify-rollback-"));
    await fs.ensureDir(path.join(rootDir, "infra", "coolify"));
    await fs.writeJson(path.join(rootDir, "infra", "coolify", "apps.json"), {
      schemaVersion: "1.0",
      applications: { dexter: { uuid: "app-uuid-1" } },
    });

    const mock = await startMockCoolifyApi({
      "/api/v1/applications/app-uuid-1/restart": () => ({
        status: 200,
        body: { message: "restart queued", deployment_uuid: "restart-1" },
      }),
    });

    const client = new CoolifyClient({
      origin: `http://127.0.0.1:${mock.port}`,
      apiToken: "coolify-token",
      appsConfigPath: path.join(rootDir, "infra", "coolify", "apps.json"),
    });

    const result = await client.rollbackApplication("dexter", { rootDir, mode: "restart" });
    expect(result.mode).toBe("restart");
    expect(result.rollbackId).toBe("restart-1");
    await mock.close();
    await fs.remove(rootDir);
  });
});

describe("Coolify bridge server", () => {
  const savedBridgeToken = process.env.DEXTER_BRIDGE_TOKEN;

  afterEach(() => {
    if (savedBridgeToken === undefined) {
      delete process.env.DEXTER_BRIDGE_TOKEN;
    } else {
      process.env.DEXTER_BRIDGE_TOKEN = savedBridgeToken;
    }
  });

  it("translates Dexter deploy contract to Coolify deploy", async () => {
    process.env.DEXTER_BRIDGE_TOKEN = "bridge-token";
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-coolify-bridge-"));
    await fs.ensureDir(path.join(rootDir, "infra", "coolify"));
    await fs.writeJson(path.join(rootDir, "infra", "coolify", "apps.json"), {
      schemaVersion: "1.0",
      applications: { dexter: { uuid: "app-uuid-1" } },
    });

    const mock = await startMockCoolifyApi({
      "/api/v1/deploy": () => ({
        status: 200,
        body: {
          deployments: [{ deployment_uuid: "dep-bridge", resource_uuid: "app-uuid-1", message: "ok" }],
        },
      }),
    });

    const client = new CoolifyClient({
      origin: `http://127.0.0.1:${mock.port}`,
      apiToken: "coolify-token",
      appsConfigPath: path.join(rootDir, "infra", "coolify", "apps.json"),
    });

    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const bridge = http.createServer((req, res) => {
        void handleBridgeRequest(req, res, client);
      });
      bridge.listen(0, "127.0.0.1", () => {
        const address = bridge.address();
        if (!address || typeof address === "string") {
          reject(new Error("bind failed"));
          return;
        }
        const request = http.request(
          {
            hostname: "127.0.0.1",
            port: address.port,
            path: "/deploy",
            method: "POST",
            headers: {
              authorization: "Bearer bridge-token",
              "content-type": "application/json",
            },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
            res.on("end", () => {
              bridge.close();
              resolve({ status: res.statusCode ?? 500, body: Buffer.concat(chunks).toString("utf8") });
            });
          },
        );
        request.on("error", (error) => {
          bridge.close();
          reject(error);
        });
        request.end(JSON.stringify({ appName: "dexter", action: "deploy", provider: "coolify" }));
      });
    });

    const payload = JSON.parse(response.body) as { deploymentId: string; status: string };
    expect(response.status).toBe(200);
    expect(payload.deploymentId).toBe("dep-bridge");
    expect(payload.status).toBe("ok");

    await mock.close();
    await fs.remove(rootDir);
  });
});
