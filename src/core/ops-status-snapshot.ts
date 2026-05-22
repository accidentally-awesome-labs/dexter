import path from "node:path";
import fs from "fs-extra";
import { readPolicyJson } from "../lib/read-policy-json.js";
import {
  estimateCostUsd,
  readDogfoodBenchmark,
  readRunSummaryCostInput,
} from "./ops-metrics-sources.js";

export type SloBurnState = "healthy" | "warn" | "breach" | "unknown";

export interface OpsStatusPolicy {
  schemaVersion: "1.0";
  description?: string;
  costModel: { hourlyRateUsd: number; currency: string };
  queue: { backlogStatuses: string[]; maxEntriesInDashboard?: number };
  escalationAgingBucketsHours: { fresh: number; stale: number };
  backlogAgingBucketsHours: { fresh: number; stale: number };
}

export interface EscalationAgingItem {
  key: string;
  target: string;
  priority: string;
  status: string;
  ageMs: number;
  bucket: "fresh" | "aging" | "stale";
}

export interface OpsCostSnapshot {
  present: boolean;
  durationMs: number | null;
  estimatedCostUsd: number | null;
  currency: string;
  hourlyRateUsd: number | null;
  source: "run_summary.explicit" | "run_summary.duration" | "dogfood.benchmark" | "missing";
  degraded: boolean;
  degradationReasons: string[];
  tasksTotal: number | null;
  tasksPassed: number | null;
  dogfoodBenchmark: {
    present: boolean;
    avgTimeToReadyMs: number | null;
    totalRuns: number | null;
    artifactPath: string;
  };
}

export interface OpsQueueBacklogEntry {
  runId: string;
  runStatus: string;
  ageMs: number;
  bucket: "fresh" | "aging" | "stale" | "unknown";
  startedAt: string | null;
}

export interface OpsQueueSnapshot {
  present: boolean;
  depth: number;
  blockedCount: number;
  degradedCount: number;
  oldestBacklogAgeMs: number | null;
  oldestBacklogRunId: string | null;
  averageBacklogAgeMs: number | null;
  backlogAging: { fresh: number; aging: number; stale: number; unknown: number };
  entries: OpsQueueBacklogEntry[];
  degraded: boolean;
  degradationReasons: string[];
  missingStartedAtCount: number;
  source: "runs_directory" | "missing";
}

export interface OpsSloSnapshot {
  present: boolean;
  state: SloBurnState;
  canaryBurnState: SloBurnState;
  sloRollbackTriggered: boolean;
  sources: {
    canaryGate: boolean;
    sloRollback: boolean;
  };
}

export interface OpsEscalationAgingSnapshot {
  present: boolean;
  unresolvedCount: number;
  oldestUnresolved: {
    key: string;
    ageMs: number;
    target: string;
    priority: string;
    bucket: "fresh" | "aging" | "stale";
  } | null;
  buckets: {
    fresh: number;
    aging: number;
    stale: number;
  };
  items: EscalationAgingItem[];
}

const DEFAULT_POLICY: OpsStatusPolicy = {
  schemaVersion: "1.0",
  costModel: { hourlyRateUsd: 5, currency: "USD" },
  queue: { backlogStatuses: ["blocked", "degraded"], maxEntriesInDashboard: 10 },
  escalationAgingBucketsHours: { fresh: 1, stale: 24 },
  backlogAgingBucketsHours: { fresh: 6, stale: 48 },
};

const POLICY_PATH = path.join("docs", "operations", "OPS_STATUS_POLICY.json");

export async function loadOpsStatusPolicy(rootDir: string): Promise<OpsStatusPolicy> {
  try {
    return await readPolicyJson(rootDir, POLICY_PATH, (raw) => raw as OpsStatusPolicy);
  } catch {
    return DEFAULT_POLICY;
  }
}

export async function buildCostSnapshot(input: {
  rootDir: string;
  runDir: string;
  policy: OpsStatusPolicy;
}): Promise<OpsCostSnapshot> {
  const summary = await readRunSummaryCostInput(input.runDir);
  const dogfood = await readDogfoodBenchmark(input.rootDir);
  const estimate = estimateCostUsd({
    summary,
    policy: input.policy,
    dogfoodAvgTimeToReadyMs: dogfood.avgTimeToReadyMs,
  });

  return {
    present: estimate.estimatedCostUsd !== null,
    durationMs: summary.durationMs,
    estimatedCostUsd: estimate.estimatedCostUsd,
    currency: input.policy.costModel.currency,
    hourlyRateUsd: input.policy.costModel.hourlyRateUsd,
    source: estimate.source,
    degraded: estimate.degraded,
    degradationReasons: estimate.degradationReasons,
    tasksTotal: summary.tasksTotal,
    tasksPassed: summary.tasksPassed,
    dogfoodBenchmark: {
      present: dogfood.present,
      avgTimeToReadyMs: dogfood.avgTimeToReadyMs,
      totalRuns: dogfood.totalRuns,
      artifactPath: dogfood.path,
    },
  };
}

interface RunQueueEntry {
  runId: string;
  runStatus: string;
  startedAt: string | null;
  ageMs: number;
  bucket: "fresh" | "aging" | "stale" | "unknown";
}

function backlogBucket(
  ageMs: number,
  buckets: OpsStatusPolicy["backlogAgingBucketsHours"],
): "fresh" | "aging" | "stale" {
  const freshMs = buckets.fresh * 3_600_000;
  const staleMs = buckets.stale * 3_600_000;
  if (ageMs < freshMs) {
    return "fresh";
  }
  if (ageMs < staleMs) {
    return "aging";
  }
  return "stale";
}

export async function buildQueueSnapshot(rootDir: string, policy: OpsStatusPolicy): Promise<OpsQueueSnapshot> {
  const runsDir = path.join(rootDir, "runs");
  if (!(await fs.pathExists(runsDir))) {
    return {
      present: false,
      depth: 0,
      blockedCount: 0,
      degradedCount: 0,
      oldestBacklogAgeMs: null,
      oldestBacklogRunId: null,
      averageBacklogAgeMs: null,
      backlogAging: { fresh: 0, aging: 0, stale: 0, unknown: 0 },
      entries: [],
      degraded: true,
      degradationReasons: ["runs directory missing"],
      missingStartedAtCount: 0,
      source: "missing",
    };
  }

  const backlogStatuses = new Set(policy.queue.backlogStatuses);
  const now = Date.now();
  const entries: RunQueueEntry[] = [];

  for (const runId of await fs.readdir(runsDir)) {
    if (runId === "README.md") {
      continue;
    }
    const summaryPath = path.join(runsDir, runId, "run_summary.json");
    if (!(await fs.pathExists(summaryPath))) {
      continue;
    }
    const summary = (await fs.readJson(summaryPath)) as {
      runStatus?: string;
      startedAt?: string;
    };
    const runStatus = summary.runStatus ?? "unknown";
    if (!backlogStatuses.has(runStatus)) {
      continue;
    }
    const startedAt = summary.startedAt ?? null;
    const startedMs = startedAt ? Date.parse(startedAt) : NaN;
    const hasStartedAt = Number.isFinite(startedMs);
    const ageMs = hasStartedAt ? Math.max(0, now - startedMs) : 0;
    const bucket = hasStartedAt ? backlogBucket(ageMs, policy.backlogAgingBucketsHours) : "unknown";
    entries.push({ runId, runStatus, startedAt, ageMs, bucket });
  }

  const blockedCount = entries.filter((entry) => entry.runStatus === "blocked").length;
  const degradedCount = entries.filter((entry) => entry.runStatus === "degraded").length;
  const sorted = entries.slice().sort((left, right) => right.ageMs - left.ageMs);
  const oldest = sorted[0];
  const knownAge = sorted.filter((entry) => entry.bucket !== "unknown");
  const averageBacklogAgeMs =
    knownAge.length === 0
      ? null
      : Math.round(knownAge.reduce((sum, entry) => sum + entry.ageMs, 0) / knownAge.length);
  const missingStartedAtCount = entries.filter((entry) => entry.bucket === "unknown").length;
  const backlogAging = {
    fresh: entries.filter((entry) => entry.bucket === "fresh").length,
    aging: entries.filter((entry) => entry.bucket === "aging").length,
    stale: entries.filter((entry) => entry.bucket === "stale").length,
    unknown: missingStartedAtCount,
  };
  const maxEntries = policy.queue.maxEntriesInDashboard ?? 10;
  const degradationReasons: string[] = [];
  if (missingStartedAtCount > 0) {
    degradationReasons.push(`${missingStartedAtCount} backlog run(s) missing startedAt`);
  }

  return {
    present: true,
    depth: entries.length,
    blockedCount,
    degradedCount,
    oldestBacklogAgeMs: oldest?.ageMs ?? null,
    oldestBacklogRunId: oldest?.runId ?? null,
    averageBacklogAgeMs,
    backlogAging,
    entries: sorted.slice(0, maxEntries).map((entry) => ({
      runId: entry.runId,
      runStatus: entry.runStatus,
      ageMs: entry.ageMs,
      bucket: entry.bucket,
      startedAt: entry.startedAt,
    })),
    degraded: degradationReasons.length > 0,
    degradationReasons,
    missingStartedAtCount,
    source: "runs_directory",
  };
}

export function buildSloSnapshot(input: {
  canaryPresent: boolean;
  canaryBurnState: SloBurnState | null;
  sloRollbackPresent: boolean;
  sloRollbackTriggered: boolean;
}): OpsSloSnapshot {
  const canaryBurnState = input.canaryPresent ? (input.canaryBurnState ?? "unknown") : "unknown";
  let state: SloBurnState = "unknown";

  if (input.sloRollbackTriggered) {
    state = "breach";
  } else if (canaryBurnState === "breach") {
    state = "breach";
  } else if (canaryBurnState === "warn") {
    state = "warn";
  } else if (canaryBurnState === "healthy") {
    state = "healthy";
  }

  const present = input.canaryPresent || input.sloRollbackPresent;

  return {
    present,
    state,
    canaryBurnState,
    sloRollbackTriggered: input.sloRollbackTriggered,
    sources: {
      canaryGate: input.canaryPresent,
      sloRollback: input.sloRollbackPresent,
    },
  };
}

function escalationBucket(
  ageMs: number,
  buckets: OpsStatusPolicy["escalationAgingBucketsHours"],
): "fresh" | "aging" | "stale" {
  const freshMs = buckets.fresh * 3_600_000;
  const staleMs = buckets.stale * 3_600_000;
  if (ageMs < freshMs) {
    return "fresh";
  }
  if (ageMs < staleMs) {
    return "aging";
  }
  return "stale";
}

export function buildEscalationAgingSnapshot(input: {
  items: Array<{
    key: string;
    status: string;
    target: string;
    priority: string;
    firstSeenAt?: string;
    lastSeenAt?: string;
  }>;
  policy: OpsStatusPolicy;
  nowMs?: number;
}): OpsEscalationAgingSnapshot {
  const nowMs = input.nowMs ?? Date.now();
  const unresolvedStatuses = new Set(["open", "in_progress"]);
  const unresolved = input.items.filter((item) => unresolvedStatuses.has(item.status));

  const agingItems: EscalationAgingItem[] = unresolved.map((item) => {
    const anchor = item.firstSeenAt ?? item.lastSeenAt ?? new Date(nowMs).toISOString();
    const anchorMs = Date.parse(anchor);
    const ageMs = Number.isFinite(anchorMs) ? Math.max(0, nowMs - anchorMs) : 0;
    const bucket = escalationBucket(ageMs, input.policy.escalationAgingBucketsHours);
    return {
      key: item.key,
      target: item.target,
      priority: item.priority,
      status: item.status,
      ageMs,
      bucket,
    };
  });

  const buckets = {
    fresh: agingItems.filter((item) => item.bucket === "fresh").length,
    aging: agingItems.filter((item) => item.bucket === "aging").length,
    stale: agingItems.filter((item) => item.bucket === "stale").length,
  };

  const oldest = agingItems.sort((left, right) => right.ageMs - left.ageMs)[0];

  return {
    present: input.items.length > 0,
    unresolvedCount: unresolved.length,
    oldestUnresolved: oldest
      ? {
          key: oldest.key,
          ageMs: oldest.ageMs,
          target: oldest.target,
          priority: oldest.priority,
          bucket: oldest.bucket,
        }
      : null,
    buckets,
    items: agingItems,
  };
}
