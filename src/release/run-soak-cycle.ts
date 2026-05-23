import path from "node:path";
import { spawn } from "node:child_process";
import fs from "fs-extra";
import { isCliEntry } from "../lib/cli-entry.js";
import { updateSoakReliability } from "./soak-reliability.js";
import { updateSoakTrends } from "./soak-trends.js";
import type { SoakCycleResult, SoakStatus, SoakStepResult } from "./soak-types.js";

function parseArg(flag: string, fallback = ""): string {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? (process.argv[idx + 1] ?? fallback) : fallback;
}

export function statusPath(rootDir: string): string {
  return path.join(rootDir, "artifacts", "release", "SOAK_STATUS.json");
}

export function statusMarkdownPath(rootDir: string): string {
  return path.join(rootDir, "artifacts", "release", "SOAK_STATUS.md");
}

async function runStep(name: string, command: string): Promise<SoakStepResult> {
  const started = Date.now();
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn("sh", ["-lc", command], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
  return {
    name,
    command,
    exitCode,
    durationMs: Date.now() - started,
  };
}

export async function loadSoakStatus(rootDir: string, targetStreak: number): Promise<SoakStatus> {
  const file = statusPath(rootDir);
  if (!(await fs.pathExists(file))) {
    return {
      schemaVersion: "1.0",
      targetStreak,
      currentStreak: 0,
      longestStreak: 0,
      totalCycles: 0,
      gateSatisfied: false,
      history: [],
    };
  }
  const current = (await fs.readJson(file)) as Partial<SoakStatus>;
  return {
    schemaVersion: "1.0",
    targetStreak,
    currentStreak: current.currentStreak ?? 0,
    longestStreak: current.longestStreak ?? 0,
    totalCycles: current.totalCycles ?? 0,
    gateSatisfied: current.gateSatisfied ?? false,
    lastCycleAt: current.lastCycleAt,
    lastCyclePassed: current.lastCyclePassed,
    lastFailureReason: current.lastFailureReason,
    history: Array.isArray(current.history) ? current.history : [],
  };
}

export function toSoakStatusMarkdown(status: SoakStatus): string {
  const lines = [
    "# Soak Status",
    "",
    `- Generated at: ${new Date().toISOString()}`,
    `- Target streak: ${status.targetStreak}`,
    `- Current streak: ${status.currentStreak}`,
    `- Longest streak: ${status.longestStreak}`,
    `- Total cycles: ${status.totalCycles}`,
    `- Gate satisfied: ${status.gateSatisfied ? "yes" : "no"}`,
    status.lastFailureReason ? `- Last failure reason: ${status.lastFailureReason}` : "- Last failure reason: n/a",
    "",
    "## Recent Cycles",
    ...status.history
      .slice(-10)
      .reverse()
      .map((cycle) => {
        const failedStep = cycle.steps.find((step) => step.exitCode !== 0);
        const failure = failedStep ? ` (failed: ${failedStep.name})` : "";
        return `- [${cycle.passed ? "PASS" : "FAIL"}] ${cycle.at}${failure}`;
      }),
    "",
  ];
  return lines.join("\n");
}

export interface RunSoakCycleOptions {
  rootDir: string;
  targetStreak?: number;
  enforceGate?: boolean;
}

export interface RunSoakCycleResult {
  statusPath: string;
  markdownPath: string;
  trendsPath: string;
  reliabilityPath: string;
  status: SoakStatus;
  cycle: SoakCycleResult;
  reliabilityStatus: string;
  warningCount: number;
}

export async function runSoakCycle(options: RunSoakCycleOptions): Promise<RunSoakCycleResult> {
  const rootDir = options.rootDir;
  const targetStreak = Math.max(1, options.targetStreak ?? 10);
  const enforceGate = options.enforceGate ?? true;
  const suite = [
    { name: "trust-gates", command: "npm run -s trust:gates" },
    { name: "api-drill-local", command: "npm run -s deploy:drill:api:local" },
    { name: "unit-tests", command: "npm run -s test:unit" },
    { name: "sample-run", command: "npm run -s run:sample" },
    { name: "backend-benchmark", command: "npm run -s benchmark:backend" },
    { name: "verify-readiness", command: "tsx src/index.ts verify" },
  ];

  const started = Date.now();
  const steps: SoakStepResult[] = [];
  let failureReason: string | undefined;
  for (const item of suite) {
    const step = await runStep(item.name, item.command);
    steps.push(step);
    if (step.exitCode !== 0) {
      failureReason = `${item.name} failed with exit code ${step.exitCode}`;
      break;
    }
  }

  const cycle: SoakCycleResult = {
    at: new Date().toISOString(),
    passed: !failureReason,
    durationMs: Date.now() - started,
    steps,
    failureReason,
  };

  const previous = await loadSoakStatus(rootDir, targetStreak);
  const currentStreak = cycle.passed ? previous.currentStreak + 1 : 0;
  const next: SoakStatus = {
    schemaVersion: "1.0",
    targetStreak,
    currentStreak,
    longestStreak: Math.max(previous.longestStreak, currentStreak),
    totalCycles: previous.totalCycles + 1,
    gateSatisfied: currentStreak >= targetStreak,
    lastCycleAt: cycle.at,
    lastCyclePassed: cycle.passed,
    lastFailureReason: cycle.failureReason,
    history: [...previous.history, cycle].slice(-200),
  };

  await fs.ensureDir(path.dirname(statusPath(rootDir)));
  await fs.writeJson(statusPath(rootDir), next, { spaces: 2 });
  await fs.writeFile(statusMarkdownPath(rootDir), toSoakStatusMarkdown(next));
  const { trendsPath, trends } = await updateSoakTrends(rootDir, next);
  const { jsonPath: reliabilityPath, report: reliability } = await updateSoakReliability(rootDir, {
    trends,
    status: next,
  });

  if (enforceGate && !next.gateSatisfied) {
    throw new Error(
      `Soak gate not yet satisfied: current streak ${next.currentStreak}/${next.targetStreak}. Continue running soak cycles.`,
    );
  }

  return {
    statusPath: statusPath(rootDir),
    markdownPath: statusMarkdownPath(rootDir),
    trendsPath,
    reliabilityPath,
    status: next,
    cycle,
    reliabilityStatus: reliability.reliabilityStatus,
    warningCount: reliability.warnings.length,
  };
}

async function main() {
  const rootDir = process.cwd();
  const targetStreakRaw = parseArg("--target-streak", process.env.DEXTER_SOAK_TARGET_STREAK ?? "10");
  const targetStreak = Math.max(1, Number.parseInt(targetStreakRaw, 10) || 10);
  const enforceGate = parseArg("--enforce-gate", "true").toLowerCase() !== "false";
  const result = await runSoakCycle({ rootDir, targetStreak, enforceGate });
  const trends = await fs.readJson(result.trendsPath);

  console.log(
    JSON.stringify(
      {
        statusPath: result.statusPath,
        markdownPath: result.markdownPath,
        trendsPath: result.trendsPath,
        reliabilityPath: result.reliabilityPath,
        targetStreak: result.status.targetStreak,
        currentStreak: result.status.currentStreak,
        gateSatisfied: result.status.gateSatisfied,
        lastCyclePassed: result.status.lastCyclePassed,
        lastFailureReason: result.status.lastFailureReason ?? null,
        reliabilityStatus: result.reliabilityStatus,
        warningCount: result.warningCount,
        trendWindows: {
          daily: trends.query?.dailyKeys?.length ?? 0,
          weekly: trends.query?.weeklyKeys?.length ?? 0,
          rolling100: trends.query?.rolling100CycleCount ?? 0,
        },
      },
      null,
      2,
    ),
  );
}

if (isCliEntry(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
