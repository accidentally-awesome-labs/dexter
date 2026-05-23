import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import {
  isStrictHealthEnabled,
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

  it("uses explicit health URL when panel override is enabled", async () => {
    const rootDir = process.cwd();
    const previousUrl = process.env.DEXTER_DEPLOY_HEALTH_URL;
    const previousAllow = process.env.DEXTER_E2E_ALLOW_PANEL_HEALTH;
    process.env.DEXTER_DEPLOY_HEALTH_URL = "http://127.0.0.1:9000/health";
    process.env.DEXTER_E2E_ALLOW_PANEL_HEALTH = "true";
    try {
      const resolved = await resolveClosedLoopHealthUrl(rootDir, "dexter");
      expect(resolved.url).toBe("http://127.0.0.1:9000/health");
      expect(resolved.source).toBe("DEXTER_DEPLOY_HEALTH_URL");
      expect(resolved.fallbackUsed).toBe(false);
    } finally {
      if (previousUrl) {
        process.env.DEXTER_DEPLOY_HEALTH_URL = previousUrl;
      } else {
        delete process.env.DEXTER_DEPLOY_HEALTH_URL;
      }
      if (previousAllow) {
        process.env.DEXTER_E2E_ALLOW_PANEL_HEALTH = previousAllow;
      } else {
        delete process.env.DEXTER_E2E_ALLOW_PANEL_HEALTH;
      }
    }
  });

  it("defaults strict health to enabled", () => {
    const previous = process.env.DEXTER_E2E_STRICT_HEALTH;
    delete process.env.DEXTER_E2E_STRICT_HEALTH;
    try {
      expect(isStrictHealthEnabled()).toBe(true);
      expect(isStrictHealthEnabled({ strictHealth: false })).toBe(false);
    } finally {
      if (previous) {
        process.env.DEXTER_E2E_STRICT_HEALTH = previous;
      }
    }
  });
});
