import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import {
  evaluateAlertEvents,
  loadAlertRules,
  routeAlertsFromOpsStatus,
} from "../src/operations/alert-routing.js";

describe("alert routing", () => {
  it("loads alert rules from docs/operations", async () => {
    const rootDir = process.cwd();
    const rules = await loadAlertRules(rootDir);
    expect(rules.schemaVersion).toBe("1.0");
    expect(rules.rules.some((rule) => rule.id === "run_blocked")).toBe(true);
    expect(rules.runbooks["blocked-run-triage"]).toContain("INCIDENT_RUNBOOK");
  });

  it("matches blocked and slo breach events with runbook paths", async () => {
    const rootDir = process.cwd();
    const rules = await loadAlertRules(rootDir);
    const events = evaluateAlertEvents(
      rules,
      {
        runId: "run-1",
        runStatus: "blocked",
        slo: { state: "breach" },
        queue: { backlogAging: { stale: 0 } },
        escalationAging: { oldestUnresolved: { bucket: "fresh" } },
      },
      rootDir,
    );
    expect(events.map((event) => event.ruleId).sort()).toEqual(["run_blocked", "slo_breach"]);
    expect(events[0]?.runbookPath).toContain("INCIDENT_RUNBOOK.md");
    expect(events.every((event) => event.runbookIndexPath.endsWith("RUNBOOK_LINKS.md"))).toBe(true);
  });

  it("routes alerts in dry-run mode and records delivery log", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-alert-route-"));
    await fs.copy(path.join(process.cwd(), "docs"), path.join(rootDir, "docs"));

    const result = await routeAlertsFromOpsStatus({
      rootDir,
      dryRun: true,
      context: {
        runId: "run-9",
        runStatus: "degraded",
        slo: { state: "warn" },
        queue: { backlogAging: { stale: 2 } },
        escalationAging: { oldestUnresolved: { bucket: "stale" } },
      },
    });

    expect(result.matchedRules.sort()).toEqual(
      ["escalation_stale", "queue_stale_backlog", "run_degraded", "slo_warn"].sort(),
    );
    expect(result.deliveries.length).toBeGreaterThan(0);
    expect(result.deliveries.every((delivery) => delivery.status === "skipped")).toBe(true);
    expect(result.deliveries[0]?.payload.runId).toBe("run-9");
    expect(result.deliveries[0]?.payload.runbook).toContain("docs/operations");
    expect(await fs.pathExists(result.deliveryLogPath)).toBe(true);

    await fs.remove(rootDir);
  });
});
