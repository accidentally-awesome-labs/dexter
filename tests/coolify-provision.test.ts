import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { ensureCoolifyApplication } from "../src/providers/deployment/coolify-provision.js";

function startMockCoolifyApi(
  handlers: Record<string, (method: string) => { status: number; body: unknown }>,
): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const handler = handlers[req.url ?? ""];
    if (!handler) {
      res.statusCode = 404;
      res.end(JSON.stringify({ message: "not found" }));
      return;
    }
    const result = handler(req.method ?? "GET");
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
        reject(new Error("bind failed"));
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

describe("coolify provision", () => {
  it("creates docker image application when missing", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-provision-"));
    await fs.ensureDir(path.join(rootDir, "infra", "coolify"));

    const mock = await startMockCoolifyApi({
      "/api/v1/applications": (method) =>
        method === "GET"
          ? { status: 200, body: [] }
          : { status: 405, body: { message: "method" } },
      "/api/v1/projects": () => ({ status: 200, body: [{ uuid: "proj-1", name: "default" }] }),
      "/api/v1/servers": () => ({ status: 200, body: [{ uuid: "srv-1", name: "localhost" }] }),
      "/api/v1/applications/dockerimage": () => ({
        status: 201,
        body: { uuid: "app-new-1", name: "dexter", fqdn: "http://dexter.local" },
      }),
    });

    process.env.COOLIFY_ORIGIN = `http://127.0.0.1:${mock.port}`;
    process.env.COOLIFY_API_TOKEN = "token";

    const result = await ensureCoolifyApplication({
      rootDir,
      appName: "dexter",
      image: "nginx",
      tag: "alpine",
    });

    expect(result.created).toBe(true);
    expect(result.uuid).toBe("app-new-1");
    const apps = await fs.readJson(path.join(rootDir, "infra", "coolify", "apps.json"));
    expect(apps.applications.dexter.uuid).toBe("app-new-1");

    delete process.env.COOLIFY_ORIGIN;
    delete process.env.COOLIFY_API_TOKEN;
    await mock.close();
    await fs.remove(rootDir);
  });
});
