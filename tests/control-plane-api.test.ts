import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, describe, expect, it } from "vitest";
import { createControlPlaneAdapter } from "../src/runtime/control-plane.js";
import { generateDeployAuthorization } from "../src/deploy/authorization.js";
import { generatePlanningSignatures } from "../src/planning/signature.js";

const cleanupEnv = () => {
  delete process.env.DEXTER_CONTROL_PLANE_ENDPOINT;
  delete process.env.DEXTER_CONTROL_PLANE_TOKEN;
};

afterEach(() => {
  cleanupEnv();
});

describe("control plane adapter api mode", () => {
  async function seedForDeployAuth(rootDir: string) {
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
  }

  it("uses external API when configured", async () => {
    const server = http.createServer((req, res) => {
      if (req.headers.authorization !== "Bearer test-token") {
        res.statusCode = 401;
        res.end();
        return;
      }
      res.setHeader("content-type", "application/json");
      if (req.url === "/deploy") {
        res.end(JSON.stringify({ id: "api-deploy-123" }));
        return;
      }
      if (req.url === "/rollback") {
        res.end(JSON.stringify({ id: "api-rollback-123" }));
        return;
      }
      res.statusCode = 404;
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("failed to bind test server");
    }

    process.env.DEXTER_CONTROL_PLANE_ENDPOINT = `http://127.0.0.1:${address.port}`;
    process.env.DEXTER_CONTROL_PLANE_TOKEN = "test-token";

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-api-"));
    await seedForDeployAuth(root);
    const auth = await generateDeployAuthorization(root, "dexter-app", {
      approvedBy: "test",
      environment: "production",
      controlPlane: "coolify",
      tenantId: "tenant-1",
    });
    if (!auth) {
      throw new Error("failed to generate deploy auth");
    }
    const adapter = createControlPlaneAdapter(root, "coolify");
    const deployResult = await adapter.deploy("dexter-app", auth, {
      environment: "production",
      tenantId: "tenant-1",
    });
    const rollbackResult = await adapter.rollback("dexter-app");

    expect(deployResult.mode).toBe("api");
    expect(deployResult.deploymentId).toBe("api-deploy-123");
    expect(rollbackResult.mode).toBe("api");
    expect(rollbackResult.rollbackId).toBe("api-rollback-123");

    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });
});
