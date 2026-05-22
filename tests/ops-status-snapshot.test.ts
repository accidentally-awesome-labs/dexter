import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { estimateCostUsd } from "../src/core/ops-metrics-sources.js";
import {
  buildCostSnapshot,
  buildEscalationAgingSnapshot,
  buildQueueSnapshot,
  buildSloSnapshot,
} from "../src/core/ops-status-snapshot.js";

describe("ops status snapshot builders", () => {
  const policy = {
    schemaVersion: "1.0" as const,
    costModel: { hourlyRateUsd: 10, currency: "USD" },
    queue: { backlogStatuses: ["blocked", "degraded"] },
    escalationAgingBucketsHours: { fresh: 1, stale: 24 },
  };

  it("estimates run cost from duration", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-cost-duration-"));
    const runDir = path.join(rootDir, "runs", "run-1");
    await fs.ensureDir(runDir);
    await fs.writeJson(path.join(runDir, "run_summary.json"), {
      durationMs: 3_600_000,
      tasksTotal: 3,
      tasksPassed: 3,
    });
    const cost = await buildCostSnapshot({ rootDir, runDir, policy });
    expect(cost.present).toBe(true);
    expect(cost.estimatedCostUsd).toBe(10);
    expect(cost.source).toBe("run_summary.duration");
    expect(cost.degraded).toBe(false);
    await fs.remove(rootDir);
  });

  it("falls back to dogfood benchmark when duration is missing", () => {
    const estimate = estimateCostUsd({
      summary: {
        durationMs: null,
        explicitCostUsd: null,
        tasksTotal: null,
        tasksPassed: null,
        project: null,
      },
      policy,
      dogfoodAvgTimeToReadyMs: 3_600_000,
    });
    expect(estimate.source).toBe("dogfood.benchmark");
    expect(estimate.degraded).toBe(true);
    expect(estimate.estimatedCostUsd).toBe(10);
  });

  it("classifies backlog runs into aging buckets", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-queue-aging-"));
    const runsDir = path.join(rootDir, "runs");
    await fs.ensureDir(path.join(runsDir, "blocked-old"));
    await fs.ensureDir(path.join(runsDir, "degraded-fresh"));
    const now = Date.now();
    await fs.writeJson(path.join(runsDir, "blocked-old", "run_summary.json"), {
      runStatus: "blocked",
      startedAt: new Date(now - 72 * 3_600_000).toISOString(),
    });
    await fs.writeJson(path.join(runsDir, "degraded-fresh", "run_summary.json"), {
      runStatus: "degraded",
      startedAt: new Date(now - 3_600_000).toISOString(),
    });
    const queue = await buildQueueSnapshot(rootDir, {
      ...policy,
      backlogAgingBucketsHours: { fresh: 6, stale: 48 },
    });
    expect(queue.depth).toBe(2);
    expect(queue.backlogAging.stale).toBe(1);
    expect(queue.backlogAging.fresh).toBe(1);
    expect(queue.entries).toHaveLength(2);
    await fs.remove(rootDir);
  });

  it("derives overall SLO state from canary and rollback signals", () => {
    expect(
      buildSloSnapshot({
        canaryPresent: true,
        canaryBurnState: "healthy",
        sloRollbackPresent: false,
        sloRollbackTriggered: false,
      }).state,
    ).toBe("healthy");
    expect(
      buildSloSnapshot({
        canaryPresent: true,
        canaryBurnState: "warn",
        sloRollbackPresent: false,
        sloRollbackTriggered: false,
      }).state,
    ).toBe("warn");
    expect(
      buildSloSnapshot({
        canaryPresent: true,
        canaryBurnState: "healthy",
        sloRollbackPresent: true,
        sloRollbackTriggered: true,
      }).state,
    ).toBe("breach");
  });

  it("buckets escalation age into fresh, aging, and stale", () => {
    const nowMs = Date.parse("2026-05-22T12:00:00.000Z");
    const aging = buildEscalationAgingSnapshot({
      policy,
      nowMs,
      items: [
        {
          key: "a",
          status: "open",
          target: "operator",
          priority: "high",
          firstSeenAt: "2026-05-22T11:30:00.000Z",
        },
        {
          key: "b",
          status: "open",
          target: "planner",
          priority: "medium",
          firstSeenAt: "2026-05-21T10:00:00.000Z",
        },
      ],
    });
    expect(aging.unresolvedCount).toBe(2);
    expect(aging.buckets.fresh).toBe(1);
    expect(aging.buckets.stale).toBe(1);
    expect(aging.oldestUnresolved?.key).toBe("b");
    expect(aging.oldestUnresolved?.bucket).toBe("stale");
  });
});
