import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import {
  resolveClosedLoopHealthUrl,
  validateClosedLoopWiring,
} from "../src/operations/closed-loop-e2e.js";

describe("closed-loop e2e helpers", () => {
  it("reports wiring blockers when bridge env is missing", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-closed-loop-"));
    const previousUrl = process.env.DEXTER_COOLIFY_API_URL;
    const previousToken = process.env.DEXTER_COOLIFY_TOKEN;
    delete process.env.DEXTER_COOLIFY_API_URL;
    delete process.env.DEXTER_COOLIFY_TOKEN;
    try {
      const blockers = await validateClosedLoopWiring(rootDir);
      expect(blockers.some((item) => item.includes("DEXTER_COOLIFY_API_URL"))).toBe(true);
    } finally {
      if (previousUrl) {
        process.env.DEXTER_COOLIFY_API_URL = previousUrl;
      }
      if (previousToken) {
        process.env.DEXTER_COOLIFY_TOKEN = previousToken;
      }
      await fs.remove(rootDir);
    }
  });

  it("prefers explicit DEXTER_DEPLOY_HEALTH_URL", async () => {
    const rootDir = process.cwd();
    const previous = process.env.DEXTER_DEPLOY_HEALTH_URL;
    process.env.DEXTER_DEPLOY_HEALTH_URL = "http://127.0.0.1:9000/health";
    try {
      const resolved = await resolveClosedLoopHealthUrl(rootDir, "dexter");
      expect(resolved.url).toBe("http://127.0.0.1:9000/health");
      expect(resolved.source).toBe("DEXTER_DEPLOY_HEALTH_URL");
    } finally {
      if (previous) {
        process.env.DEXTER_DEPLOY_HEALTH_URL = previous;
      } else {
        delete process.env.DEXTER_DEPLOY_HEALTH_URL;
      }
    }
  });
});
