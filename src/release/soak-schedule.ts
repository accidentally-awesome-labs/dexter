import path from "node:path";
import fs from "fs-extra";
import { loadSoakSchedulePolicy, type SoakSchedulePolicy } from "./soak-schedule-policy.js";

export interface SoakScheduleState {
  schemaVersion: "1.0";
  updatedAt: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastRunResult: "passed" | "failed" | "skipped" | null;
  lastSkipReason: string | null;
  nextDueAt: string | null;
  totalScheduledRuns: number;
  totalSkipped: number;
  intervalMinutes: number;
  githubActionsCron: string;
}

export function soakScheduleStatePath(rootDir: string): string {
  return path.join(rootDir, "artifacts", "release", "SOAK_SCHEDULE_STATE.json");
}

export function soakScheduleManifestPath(rootDir: string): string {
  return path.join(rootDir, "artifacts", "release", "SOAK_SCHEDULE_MANIFEST.md");
}

export function computeNextDueAt(lastRunAt: string | null, intervalMinutes: number, now = new Date()): string {
  if (!lastRunAt) {
    return now.toISOString();
  }
  const lastMs = Date.parse(lastRunAt);
  const base = Number.isFinite(lastMs) ? lastMs : now.getTime();
  return new Date(base + intervalMinutes * 60_000).toISOString();
}

export function evaluateSoakScheduleDue(
  policy: SoakSchedulePolicy,
  state: SoakScheduleState | null,
  now = new Date(),
): { due: boolean; reason: string; nextDueAt: string } {
  if (!policy.enabled) {
    return {
      due: false,
      reason: "Soak schedule disabled by policy.",
      nextDueAt: now.toISOString(),
    };
  }

  if (state?.lastRunAt) {
    const lastMs = Date.parse(state.lastRunAt);
    const minGapMs = policy.minGapMinutes * 60_000;
    if (Number.isFinite(lastMs) && now.getTime() - lastMs < minGapMs) {
      return {
        due: false,
        reason: `Minimum gap ${policy.minGapMinutes}m not elapsed since last run.`,
        nextDueAt: new Date(lastMs + minGapMs).toISOString(),
      };
    }
  }

  const nextDueAt = computeNextDueAt(state?.lastRunAt ?? null, policy.intervalMinutes, now);
  const nextDueMs = Date.parse(nextDueAt);
  if (!Number.isFinite(nextDueMs) || nextDueMs <= now.getTime()) {
    return { due: true, reason: "Scheduled soak cycle is due.", nextDueAt };
  }

  return {
    due: false,
    reason: `Next soak cycle due at ${nextDueAt}.`,
    nextDueAt,
  };
}

export async function loadSoakScheduleState(rootDir: string): Promise<SoakScheduleState | null> {
  const file = soakScheduleStatePath(rootDir);
  if (!(await fs.pathExists(file))) {
    return null;
  }
  return (await fs.readJson(file)) as SoakScheduleState;
}

export async function writeSoakScheduleState(
  rootDir: string,
  state: SoakScheduleState,
): Promise<string> {
  const file = soakScheduleStatePath(rootDir);
  await fs.ensureDir(path.dirname(file));
  await fs.writeJson(file, state, { spaces: 2 });
  return file;
}

export async function writeSoakScheduleManifest(
  rootDir: string,
  policy: SoakSchedulePolicy,
  state: SoakScheduleState,
): Promise<string> {
  const manifestPath = soakScheduleManifestPath(rootDir);
  await fs.ensureDir(path.dirname(manifestPath));
  await fs.writeFile(
    manifestPath,
    [
      "# Soak Schedule Manifest",
      "",
      `Updated at: ${state.updatedAt}`,
      `Enabled: ${state.enabled}`,
      `Interval: ${state.intervalMinutes} minutes`,
      `Next due: ${state.nextDueAt ?? "immediate"}`,
      `Last run: ${state.lastRunAt ?? "never"} (${state.lastRunResult ?? "n/a"})`,
      state.lastSkipReason ? `Last skip: ${state.lastSkipReason}` : "Last skip: n/a",
      "",
      "## Automation",
      `- GitHub Actions cron: \`${state.githubActionsCron}\``,
      `- Local cron example: \`${policy.automation.localCronExample}\``,
      "",
      "## Commands",
      "- `npm run soak:schedule` — run due scheduled soak cycle",
      "- `npm run soak:cycle -- --target-streak 1 --enforce-gate false` — manual cycle",
      "- `npm run soak:reliability` — refresh reliability deltas",
      "",
    ].join("\n"),
  );
  return manifestPath;
}

export function initialSoakScheduleState(policy: SoakSchedulePolicy, now = new Date()): SoakScheduleState {
  return {
    schemaVersion: "1.0",
    updatedAt: now.toISOString(),
    enabled: policy.enabled,
    lastRunAt: null,
    lastRunResult: null,
    lastSkipReason: null,
    nextDueAt: now.toISOString(),
    totalScheduledRuns: 0,
    totalSkipped: 0,
    intervalMinutes: policy.intervalMinutes,
    githubActionsCron: policy.automation.githubActionsCron,
  };
}
