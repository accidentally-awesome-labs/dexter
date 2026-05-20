import http from "node:http";
import { describe, expect, it } from "vitest";
import { runDeploymentHealthChecks } from "../src/runtime/deployment-health.js";

describe("deployment health checks", () => {
  it("skips when no health urls are configured", async () => {
    const result = await runDeploymentHealthChecks({ urls: [] });
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.checks).toHaveLength(0);
  });

  it("passes when endpoint returns success", async () => {
    const server = http.createServer((_req, res) => {
      res.statusCode = 200;
      res.end("ok");
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("failed to bind test server");
    }
    const url = `http://127.0.0.1:${address.port}/health`;
    const result = await runDeploymentHealthChecks({ urls: [url], timeoutMs: 1000 });
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.checks[0]?.status).toBe("pass");
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  it("fails when endpoint is unhealthy", async () => {
    const server = http.createServer((_req, res) => {
      res.statusCode = 503;
      res.end("down");
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("failed to bind test server");
    }
    const url = `http://127.0.0.1:${address.port}/health`;
    const result = await runDeploymentHealthChecks({ urls: [url], timeoutMs: 1000 });
    expect(result.passed).toBe(false);
    expect(result.checks[0]?.status).toBe("fail");
    expect(result.checks[0]?.statusCode).toBe(503);
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });
});
