import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { appendAuditLogEvent } from "../src/operations/audit-log.js";

describe("audit log", () => {
  it("appends immutable jsonl entries", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-audit-log-"));
    const first = await appendAuditLogEvent(rootDir, {
      actor: "dexter-ops",
      action: "promotion_deploy",
      scope: "staging",
      reason: "test",
      runId: "run-1",
      metadata: { deploymentId: "dep-1" },
    });
    await appendAuditLogEvent(rootDir, {
      actor: "dexter-ops",
      action: "promotion_rollback",
      scope: "staging",
      reason: "test-rollback",
      runId: "run-1",
      metadata: { rollbackId: "rb-1" },
    });

    const lines = (await fs.readFile(first.path, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean);
    expect(lines).toHaveLength(2);
    const entries = lines.map((line) => JSON.parse(line) as { action: string; actor: string });
    expect(entries[0]?.action).toBe("promotion_deploy");
    expect(entries[1]?.action).toBe("promotion_rollback");
    expect(entries.every((entry) => entry.actor === "dexter-ops")).toBe(true);
    await fs.remove(rootDir);
  });
});
