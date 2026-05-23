import { runSoakCycle } from "./run-soak-cycle.js";
import { writeReliabilityKpiReport } from "./reliability-kpi.js";
import { loadSoakSchedulePolicy } from "./soak-schedule-policy.js";
import {
  evaluateSoakScheduleDue,
  initialSoakScheduleState,
  loadSoakScheduleState,
  writeSoakScheduleManifest,
  writeSoakScheduleState,
} from "./soak-schedule.js";

function parseArg(flag: string, fallback = ""): string {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? (process.argv[idx + 1] ?? fallback) : fallback;
}

async function main() {
  const rootDir = process.cwd();
  const force = parseArg("--force", "false").toLowerCase() === "true";
  const policy = await loadSoakSchedulePolicy(rootDir);
  const now = new Date();
  const existing = await loadSoakScheduleState(rootDir);
  const state = existing ?? initialSoakScheduleState(policy, now);
  const dueEvaluation = evaluateSoakScheduleDue(policy, state, now);

  if (!force && !dueEvaluation.due) {
    const skipped = {
      ...state,
      updatedAt: now.toISOString(),
      lastRunResult: "skipped" as const,
      lastSkipReason: dueEvaluation.reason,
      nextDueAt: dueEvaluation.nextDueAt,
      totalSkipped: state.totalSkipped + 1,
    };
    const statePath = await writeSoakScheduleState(rootDir, skipped);
    const manifestPath = await writeSoakScheduleManifest(rootDir, policy, skipped);
    console.log(
      JSON.stringify(
        {
          ran: false,
          skipped: true,
          reason: dueEvaluation.reason,
          statePath,
          manifestPath,
          nextDueAt: dueEvaluation.nextDueAt,
        },
        null,
        2,
      ),
    );
    return;
  }

  const cycle = await runSoakCycle({
    rootDir,
    targetStreak: policy.targetStreak,
    enforceGate: policy.enforceGateOnScheduledRun,
  });
  const updated = {
    ...state,
    updatedAt: now.toISOString(),
    enabled: policy.enabled,
    lastRunAt: cycle.cycle.at,
    lastRunResult: cycle.cycle.passed ? ("passed" as const) : ("failed" as const),
    lastSkipReason: null,
    nextDueAt: evaluateSoakScheduleDue(policy, {
      ...state,
      lastRunAt: cycle.cycle.at,
    }, now).nextDueAt,
    totalScheduledRuns: state.totalScheduledRuns + 1,
    intervalMinutes: policy.intervalMinutes,
    githubActionsCron: policy.automation.githubActionsCron,
  };
  const statePath = await writeSoakScheduleState(rootDir, updated);
  const manifestPath = await writeSoakScheduleManifest(rootDir, policy, updated);
  const kpi = await writeReliabilityKpiReport(rootDir);

  console.log(
    JSON.stringify(
      {
        ran: true,
        skipped: false,
        statePath,
        manifestPath,
        cyclePassed: cycle.cycle.passed,
        reliabilityStatus: cycle.reliabilityStatus,
        warningCount: cycle.warningCount,
        statusPath: cycle.statusPath,
        reliabilityPath: cycle.reliabilityPath,
        nextDueAt: updated.nextDueAt,
        kpiPath: kpi.jsonPath,
        kpiGatesPassed: kpi.report.kpi.gatesPassed,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
