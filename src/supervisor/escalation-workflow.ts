import { listEscalationLifecycle, updateEscalationLifecycleStatus } from "./escalation-lifecycle.js";
import { routeEscalations } from "./route-escalations.js";

export async function resolveEscalationsWorkflow(options: {
  rootDir: string;
  keys?: string[];
  status: "resolved" | "waived";
  allUnresolved?: boolean;
  target?: "operator" | "planner";
  dryRun?: boolean;
  note?: string;
  runId?: string;
  waiver?: {
    approvedBy: string;
    reason: string;
    expiresAt: string;
    scope: string;
  };
}): Promise<{
  selectedKeys: string[];
  updatedKeys: string[];
  status: "resolved" | "waived";
  unresolvedRequired: number;
  resumeAllowed: boolean;
  resumeRunId?: string;
  dryRun: boolean;
  routeSummary?: Awaited<ReturnType<typeof routeEscalations>>;
  lifecycle: Awaited<ReturnType<typeof listEscalationLifecycle>>;
}> {
  const unresolved = await listEscalationLifecycle({
    rootDir: options.rootDir,
    unresolvedOnly: true,
  });
  const unresolvedKeys = unresolved.items
    .filter((item) => !options.target || item.target === options.target)
    .map((item) => item.key);
  const selectedKeys = options.allUnresolved
    ? unresolvedKeys
    : (options.keys ?? []).filter((key) => !options.target || unresolved.items.some((item) => item.key === key && item.target === options.target));

  if (selectedKeys.length === 0) {
    const lifecycle = await listEscalationLifecycle({
      rootDir: options.rootDir,
      unresolvedOnly: false,
    });
    return {
      selectedKeys,
      updatedKeys: [],
      status: options.status,
      unresolvedRequired: lifecycle.unresolved,
      resumeAllowed: lifecycle.unresolved === 0,
      resumeRunId: options.runId,
      dryRun: Boolean(options.dryRun),
      lifecycle,
    };
  }

  const updatedKeys: string[] = [];
  if (!options.dryRun) {
    for (const key of selectedKeys) {
      await updateEscalationLifecycleStatus({
        rootDir: options.rootDir,
        key,
        status: options.status,
        note: options.note,
        waiver: options.status === "waived" ? options.waiver : undefined,
      });
      updatedKeys.push(key);
    }
  }
  const routeSummary = options.dryRun ? undefined : await routeEscalations(options.rootDir);
  const lifecycle = await listEscalationLifecycle({
    rootDir: options.rootDir,
    unresolvedOnly: false,
  });
  const resumeAllowed = lifecycle.unresolved === 0;
  return {
    selectedKeys,
    updatedKeys,
    status: options.status,
    unresolvedRequired: lifecycle.unresolved,
    resumeAllowed,
    resumeRunId: options.runId,
    dryRun: Boolean(options.dryRun),
    routeSummary,
    lifecycle,
  };
}
