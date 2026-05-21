import path from "node:path";
import fs from "fs-extra";

type EscalationStatus = "open" | "in_progress" | "resolved" | "waived";
type RunStatus = "healthy" | "degraded" | "blocked";

interface EscalationWaiver {
  approvedBy: string;
  reason: string;
  expiresAt: string;
  scope: string;
}

interface SupervisorActionsPlan {
  actions: Array<{
    taskId: string;
    target: "operator" | "planner";
    priority: "high" | "medium";
    reason: string;
    action: string;
  }>;
}

interface EscalationStateItem {
  key: string;
  taskId: string;
  target: "operator" | "planner";
  priority: "high" | "medium";
  reason: string;
  action: string;
  status: EscalationStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  lastRunId: string;
  resolvedAt?: string;
  waiver?: EscalationWaiver;
}

interface EscalationState {
  generatedAt: string;
  items: EscalationStateItem[];
}

export interface EscalationLifecycleSummary {
  statePath: string;
  markdownPath: string;
  runStatus: RunStatus;
  unresolvedRequired: number;
  unresolvedOperatorHigh: number;
}

function keyFor(item: { taskId: string; target: "operator" | "planner"; reason: string }): string {
  return `${item.taskId}:${item.target}:${item.reason}`;
}

function deriveRunStatus(state: EscalationState): {
  runStatus: RunStatus;
  unresolvedRequired: number;
  unresolvedOperatorHigh: number;
} {
  const unresolved = state.items.filter((item) => item.status === "open" || item.status === "in_progress");
  const unresolvedOperatorHigh = unresolved.filter((item) => item.target === "operator" && item.priority === "high").length;
  const runStatus: RunStatus = unresolvedOperatorHigh > 0 ? "blocked" : unresolved.length > 0 ? "degraded" : "healthy";
  return {
    runStatus,
    unresolvedRequired: unresolved.length,
    unresolvedOperatorHigh,
  };
}

function normalizeExpiredWaivers(state: EscalationState): EscalationState {
  const nowMs = Date.now();
  const items = state.items.map((item) => {
    if (item.status !== "waived" || !item.waiver?.expiresAt) {
      return item;
    }
    const expiryMs = Date.parse(item.waiver.expiresAt);
    if (!Number.isFinite(expiryMs) || expiryMs > nowMs) {
      return item;
    }
    return {
      ...item,
      status: "open" as const,
      resolvedAt: undefined,
      action: `${item.action} | waiver expired at ${item.waiver.expiresAt}`,
      waiver: undefined,
    };
  });
  return {
    ...state,
    items,
  };
}

function toMarkdown(state: EscalationState, runStatus: RunStatus, unresolvedRequired: number, unresolvedOperatorHigh: number): string {
  return [
    "# Escalation Lifecycle",
    "",
    `Generated at: ${state.generatedAt}`,
    `Run status: ${runStatus}`,
    `Unresolved required: ${unresolvedRequired}`,
    `Unresolved operator/high: ${unresolvedOperatorHigh}`,
    "",
    "## Items",
    ...(state.items.length === 0
      ? ["- None"]
      : state.items.map(
          (item) =>
            `- key=${item.key} status=${item.status} target=${item.target} priority=${item.priority} reason=${item.reason}${
              item.waiver
                ? ` waiver={approvedBy:${item.waiver.approvedBy},scope:${item.waiver.scope},expiresAt:${item.waiver.expiresAt}}`
                : ""
            }`,
        )),
    "",
  ].join("\n");
}

export async function syncEscalationLifecycle(rootDir: string, runDir: string, runId: string): Promise<EscalationLifecycleSummary> {
  const executionDir = path.join(rootDir, "artifacts", "execution");
  await fs.ensureDir(executionDir);
  const actionsPath = path.join(executionDir, "SUPERVISOR_ACTIONS.json");
  const statePath = path.join(executionDir, "ESCALATION_STATE.json");
  const markdownPath = path.join(executionDir, "ESCALATION_STATE.md");

  const now = new Date().toISOString();
  const actions = (await fs.readJson(actionsPath)) as SupervisorActionsPlan;
  const currentByKey = new Map(
    actions.actions.map((item) => [
      keyFor(item),
      {
        ...item,
        key: keyFor(item),
      },
    ]),
  );

  const existing: EscalationState = (await fs.pathExists(statePath))
    ? ((await fs.readJson(statePath)) as EscalationState)
    : { generatedAt: now, items: [] };

  const normalizedExisting = normalizeExpiredWaivers(existing);
  const merged = new Map(normalizedExisting.items.map((item) => [item.key, item]));

  for (const current of currentByKey.values()) {
    const prior = merged.get(current.key);
    if (!prior) {
      merged.set(current.key, {
        key: current.key,
        taskId: current.taskId,
        target: current.target,
        priority: current.priority,
        reason: current.reason,
        action: current.action,
        status: "open",
        firstSeenAt: now,
        lastSeenAt: now,
        lastRunId: runId,
      });
      continue;
    }
    merged.set(current.key, {
      ...prior,
      taskId: current.taskId,
      target: current.target,
      priority: current.priority,
      reason: current.reason,
      action: current.action,
      lastSeenAt: now,
      lastRunId: runId,
      // Re-open if previously resolved/waived and issue reappears.
      status: prior.status === "resolved" || prior.status === "waived" ? "open" : prior.status,
      resolvedAt: prior.status === "resolved" || prior.status === "waived" ? undefined : prior.resolvedAt,
      waiver: prior.status === "resolved" || prior.status === "waived" ? undefined : prior.waiver,
    });
  }

  for (const [key, item] of merged.entries()) {
    if (!currentByKey.has(key) && (item.status === "open" || item.status === "in_progress")) {
      merged.set(key, {
        ...item,
        status: "resolved",
        resolvedAt: now,
        lastRunId: runId,
      });
    }
  }

  const state: EscalationState = {
    generatedAt: now,
    items: [...merged.values()].sort((a, b) => a.key.localeCompare(b.key)),
  };

  const status = deriveRunStatus(state);

  await fs.writeJson(statePath, state, { spaces: 2 });
  await fs.writeFile(markdownPath, toMarkdown(state, status.runStatus, status.unresolvedRequired, status.unresolvedOperatorHigh));
  await fs.writeJson(
    path.join(runDir, "escalation_lifecycle_summary.json"),
    {
      statePath,
      markdownPath,
      runStatus: status.runStatus,
      unresolvedRequired: status.unresolvedRequired,
      unresolvedOperatorHigh: status.unresolvedOperatorHigh,
    },
    { spaces: 2 },
  );

  return {
    statePath,
    markdownPath,
    runStatus: status.runStatus,
    unresolvedRequired: status.unresolvedRequired,
    unresolvedOperatorHigh: status.unresolvedOperatorHigh,
  };
}

export async function updateEscalationLifecycleStatus(options: {
  rootDir: string;
  key: string;
  status: EscalationStatus;
  note?: string;
  waiver?: EscalationWaiver;
}): Promise<
  EscalationLifecycleSummary & {
    updated: boolean;
    previousStatus?: EscalationStatus;
    newStatus?: EscalationStatus;
  }
> {
  const executionDir = path.join(options.rootDir, "artifacts", "execution");
  const statePath = path.join(executionDir, "ESCALATION_STATE.json");
  const markdownPath = path.join(executionDir, "ESCALATION_STATE.md");
  if (!(await fs.pathExists(statePath))) {
    throw new Error(`Escalation lifecycle state not found: ${statePath}`);
  }
  const state = normalizeExpiredWaivers((await fs.readJson(statePath)) as EscalationState);
  const idx = state.items.findIndex((item) => item.key === options.key);
  if (idx < 0) {
    throw new Error(`Escalation key not found: ${options.key}`);
  }
  const previousStatus = state.items[idx]!.status;
  const now = new Date().toISOString();
  if (options.status === "waived") {
    if (!options.waiver) {
      throw new Error("Waiver metadata is required when setting escalation status to waived.");
    }
    if (
      !options.waiver.approvedBy.trim() ||
      !options.waiver.reason.trim() ||
      !options.waiver.scope.trim() ||
      !options.waiver.expiresAt.trim()
    ) {
      throw new Error("Waiver metadata must include approvedBy, reason, scope, and expiresAt.");
    }
    const expiry = Date.parse(options.waiver.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= Date.now()) {
      throw new Error("Waiver expiresAt must be a valid future ISO timestamp.");
    }
  }
  state.items[idx] = {
    ...state.items[idx]!,
    status: options.status,
    lastSeenAt: now,
    resolvedAt: options.status === "resolved" || options.status === "waived" ? now : undefined,
    action: options.note ? `${state.items[idx]!.action} | note: ${options.note}` : state.items[idx]!.action,
    waiver: options.status === "waived" ? options.waiver : undefined,
  };
  state.generatedAt = now;
  const status = deriveRunStatus(state);
  await fs.writeJson(statePath, state, { spaces: 2 });
  await fs.writeFile(markdownPath, toMarkdown(state, status.runStatus, status.unresolvedRequired, status.unresolvedOperatorHigh));
  return {
    statePath,
    markdownPath,
    runStatus: status.runStatus,
    unresolvedRequired: status.unresolvedRequired,
    unresolvedOperatorHigh: status.unresolvedOperatorHigh,
    updated: true,
    previousStatus,
    newStatus: options.status,
  };
}

export async function listEscalationLifecycle(options: {
  rootDir: string;
  unresolvedOnly?: boolean;
}): Promise<{
  statePath: string;
  total: number;
  unresolved: number;
  items: Array<{
    key: string;
    status: EscalationStatus;
    target: "operator" | "planner";
    priority: "high" | "medium";
    reason: string;
    action: string;
    lastRunId: string;
    waiver?: EscalationWaiver;
  }>;
}> {
  const statePath = path.join(options.rootDir, "artifacts", "execution", "ESCALATION_STATE.json");
  if (!(await fs.pathExists(statePath))) {
    throw new Error(`Escalation lifecycle state not found: ${statePath}`);
  }
  const state = (await fs.readJson(statePath)) as EscalationState;
  const normalizedState = normalizeExpiredWaivers(state);
  if (JSON.stringify(normalizedState) !== JSON.stringify(state)) {
    await fs.writeJson(statePath, normalizedState, { spaces: 2 });
  }
  const unresolvedStatuses = new Set<EscalationStatus>(["open", "in_progress"]);
  const unresolved = normalizedState.items.filter((item) => unresolvedStatuses.has(item.status)).length;
  const filtered = options.unresolvedOnly
    ? normalizedState.items.filter((item) => unresolvedStatuses.has(item.status))
    : normalizedState.items;
  return {
    statePath,
    total: normalizedState.items.length,
    unresolved,
    items: filtered.map((item) => ({
      key: item.key,
      status: item.status,
      target: item.target,
      priority: item.priority,
      reason: item.reason,
      action: item.action,
      lastRunId: item.lastRunId,
      waiver: item.waiver,
    })),
  };
}
