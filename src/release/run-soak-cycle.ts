import path from "node:path";
import { spawn } from "node:child_process";
import fs from "fs-extra";

interface SoakStepResult {
  name: string;
  command: string;
  exitCode: number;
  durationMs: number;
}

interface SoakCycleResult {
  at: string;
  passed: boolean;
  durationMs: number;
  steps: SoakStepResult[];
  failureReason?: string;
}

interface SoakStatus {
  schemaVersion: "1.0";
  targetStreak: number;
  currentStreak: number;
  longestStreak: number;
  totalCycles: number;
  gateSatisfied: boolean;
  lastCycleAt?: string;
  lastCyclePassed?: boolean;
  lastFailureReason?: string;
  history: SoakCycleResult[];
}

function parseArg(flag: string, fallback = ""): string {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? (process.argv[idx + 1] ?? fallback) : fallback;
}

function statusPath(rootDir: string): string {
  return path.join(rootDir, "artifacts", "release", "SOAK_STATUS.json");
}

function statusMarkdownPath(rootDir: string): string {
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

async function loadStatus(rootDir: string, targetStreak: number): Promise<SoakStatus> {
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
  const current = (await fs.readJson(file)) as SoakStatus;
  return {
    ...current,
    targetStreak,
  };
}

function toMarkdown(status: SoakStatus): string {
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

async function main() {
  const rootDir = process.cwd();
  const targetStreakRaw = parseArg("--target-streak", process.env.DEXTER_SOAK_TARGET_STREAK ?? "10");
  const targetStreak = Math.max(1, Number.parseInt(targetStreakRaw, 10) || 10);
  const enforceGate = parseArg("--enforce-gate", "true").toLowerCase() !== "false";
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

  const previous = await loadStatus(rootDir, targetStreak);
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
  await fs.writeFile(statusMarkdownPath(rootDir), toMarkdown(next));

  console.log(
    JSON.stringify(
      {
        statusPath: statusPath(rootDir),
        markdownPath: statusMarkdownPath(rootDir),
        targetStreak: next.targetStreak,
        currentStreak: next.currentStreak,
        gateSatisfied: next.gateSatisfied,
        lastCyclePassed: next.lastCyclePassed,
        lastFailureReason: next.lastFailureReason ?? null,
      },
      null,
      2,
    ),
  );

  if (enforceGate && !next.gateSatisfied) {
    throw new Error(
      `Soak gate not yet satisfied: current streak ${next.currentStreak}/${next.targetStreak}. Continue running soak cycles.`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
