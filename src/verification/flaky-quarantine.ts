import path from "node:path";
import fs from "fs-extra";
import {
  isRegressionCriticalTest,
  loadFlakyQuarantinePolicy,
  matchesPattern,
  type FlakyQuarantinePolicy,
} from "./flaky-quarantine-policy.js";
import type { FlakyDetectionReport } from "./test-telemetry.js";
import type { TestCaseOutcome } from "./test-telemetry.js";

export interface QuarantineEntry {
  testId: string;
  file: string;
  name: string;
  confidence: number;
  flipRate: number;
  quarantined: boolean;
  blocking: boolean;
  regressionCritical: boolean;
  reason: string;
}

export interface QuarantineRunSummary {
  vitestExitCode: number;
  effectiveExitCode: number;
  failedTotal: number;
  quarantinedFailureCount: number;
  blockingFailureCount: number;
  quarantinedFailures: string[];
  blockingFailures: string[];
}

export interface FlakyQuarantineReport {
  schemaVersion: "1.0";
  generatedAt: string;
  quarantinedCount: number;
  blockingFlakyCount: number;
  regressionCriticalCount: number;
  entries: QuarantineEntry[];
  lastRun?: QuarantineRunSummary;
}

export function flakyQuarantineJsonPath(rootDir: string): string {
  return path.join(rootDir, "artifacts", "verification", "FLAKY_QUARANTINE.json");
}

export function flakyQuarantineMarkdownPath(rootDir: string): string {
  return path.join(rootDir, "artifacts", "verification", "FLAKY_QUARANTINE.md");
}

export function buildQuarantineEntries(
  flaky: FlakyDetectionReport,
  policy: FlakyQuarantinePolicy,
): QuarantineEntry[] {
  const entries: QuarantineEntry[] = [];
  const seen = new Set<string>();

  for (const candidate of flaky.candidates) {
    if (!candidate.flaky && !matchesPattern(candidate.testId, policy.manualQuarantine)) {
      continue;
    }
    const regressionCritical = isRegressionCriticalTest(candidate, policy);
    const manual = matchesPattern(candidate.testId, policy.manualQuarantine);
    const quarantined = (candidate.flaky || manual) && !regressionCritical;
    const blocking = regressionCritical && candidate.flaky;

    entries.push({
      testId: candidate.testId,
      file: candidate.file,
      name: candidate.name,
      confidence: candidate.confidence,
      flipRate: candidate.flipRate,
      quarantined,
      blocking,
      regressionCritical,
      reason: regressionCritical
        ? "Regression-critical — remains blocking even when flaky."
        : quarantined
          ? "High-confidence flaky — quarantined from blocking failures."
          : "Tracked flaky candidate.",
    });
    seen.add(candidate.testId);
  }

  for (const pattern of policy.manualQuarantine) {
    if (seen.has(pattern)) {
      continue;
    }
    entries.push({
      testId: pattern,
      file: pattern,
      name: pattern,
      confidence: 1,
      flipRate: 1,
      quarantined: !isRegressionCriticalTest({ testId: pattern, file: pattern }, policy),
      blocking: false,
      regressionCritical: isRegressionCriticalTest({ testId: pattern, file: pattern }, policy),
      reason: "Manual quarantine entry.",
    });
  }

  return entries.sort((left, right) => left.testId.localeCompare(right.testId));
}

export function isQuarantinedNonBlocking(
  test: { testId: string; file: string },
  entries: QuarantineEntry[],
): boolean {
  const entry = entries.find((item) => item.testId === test.testId);
  if (entry) {
    return entry.quarantined && !entry.blocking;
  }
  return false;
}

export function resolveTestRunExitCode(
  vitestExitCode: number,
  outcomes: TestCaseOutcome[],
  entries: QuarantineEntry[],
): QuarantineRunSummary {
  const failed = outcomes.filter((item) => item.status === "failed");
  const quarantinedFailures: string[] = [];
  const blockingFailures: string[] = [];

  for (const failure of failed) {
    if (isQuarantinedNonBlocking(failure, entries)) {
      quarantinedFailures.push(failure.testId);
    } else {
      blockingFailures.push(failure.testId);
    }
  }

  const effectiveExitCode = blockingFailures.length > 0 ? 1 : 0;

  return {
    vitestExitCode,
    effectiveExitCode,
    failedTotal: failed.length,
    quarantinedFailureCount: quarantinedFailures.length,
    blockingFailureCount: blockingFailures.length,
    quarantinedFailures,
    blockingFailures,
  };
}

export function buildFlakyQuarantineReport(
  flaky: FlakyDetectionReport,
  policy: FlakyQuarantinePolicy,
  lastRun?: QuarantineRunSummary,
  generatedAt = new Date().toISOString(),
): FlakyQuarantineReport {
  const entries = buildQuarantineEntries(flaky, policy);
  return {
    schemaVersion: "1.0",
    generatedAt,
    quarantinedCount: entries.filter((item) => item.quarantined).length,
    blockingFlakyCount: entries.filter((item) => item.blocking).length,
    regressionCriticalCount: entries.filter((item) => item.regressionCritical).length,
    entries,
    lastRun,
  };
}

export function renderFlakyQuarantineMarkdown(report: FlakyQuarantineReport): string {
  const quarantined = report.entries.filter((item) => item.quarantined);
  const blockingFlaky = report.entries.filter((item) => item.blocking);
  return [
    "# Flaky Test Quarantine",
    "",
    `Generated at: ${report.generatedAt}`,
    `Quarantined tests: ${report.quarantinedCount}`,
    `Blocking flaky (regression-critical): ${report.blockingFlakyCount}`,
    "",
    "## Quarantined (non-blocking when failing)",
    "",
    ...(quarantined.length === 0
      ? ["- None"]
      : quarantined.map(
          (item) =>
            `- ${item.name} — confidence ${item.confidence}, flipRate ${item.flipRate} (${item.file})`,
        )),
    "",
    "## Flaky but Still Blocking",
    "",
    ...(blockingFlaky.length === 0
      ? ["- None"]
      : blockingFlaky.map((item) => `- ${item.name} (${item.file}) — ${item.reason}`)),
    "",
    ...(report.lastRun
      ? [
          "## Last Run",
          "",
          `- Vitest exit code: ${report.lastRun.vitestExitCode}`,
          `- Effective exit code: ${report.lastRun.effectiveExitCode}`,
          `- Failed total: ${report.lastRun.failedTotal}`,
          `- Quarantined failures: ${report.lastRun.quarantinedFailureCount}`,
          `- Blocking failures: ${report.lastRun.blockingFailureCount}`,
          ...(report.lastRun.quarantinedFailures.length > 0
            ? ["", "### Quarantined Failures", ...report.lastRun.quarantinedFailures.map((item) => `- ${item}`)]
            : []),
          ...(report.lastRun.blockingFailures.length > 0
            ? ["", "### Blocking Failures", ...report.lastRun.blockingFailures.map((item) => `- ${item}`)]
            : []),
          "",
        ]
      : []),
  ].join("\n");
}

export async function loadFlakyQuarantineReport(rootDir: string): Promise<FlakyQuarantineReport | null> {
  const file = flakyQuarantineJsonPath(rootDir);
  if (!(await fs.pathExists(file))) {
    return null;
  }
  return (await fs.readJson(file)) as FlakyQuarantineReport;
}

export async function writeFlakyQuarantineReport(
  rootDir: string,
  report: FlakyQuarantineReport,
): Promise<{ jsonPath: string; markdownPath: string }> {
  const jsonPath = flakyQuarantineJsonPath(rootDir);
  const markdownPath = flakyQuarantineMarkdownPath(rootDir);
  await fs.ensureDir(path.dirname(jsonPath));
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(markdownPath, renderFlakyQuarantineMarkdown(report));
  return { jsonPath, markdownPath };
}

export async function updateFlakyQuarantine(
  rootDir: string,
  flaky: FlakyDetectionReport,
  options?: {
    vitestExitCode?: number;
    lastRunOutcomes?: TestCaseOutcome[];
  },
): Promise<{ report: FlakyQuarantineReport; effectiveExitCode: number }> {
  const policy = await loadFlakyQuarantinePolicy(rootDir);
  const entries = buildQuarantineEntries(flaky, policy);
  const lastRun =
    options?.lastRunOutcomes && options.vitestExitCode !== undefined
      ? resolveTestRunExitCode(options.vitestExitCode, options.lastRunOutcomes, entries)
      : undefined;
  const report = buildFlakyQuarantineReport(flaky, policy, lastRun);
  await writeFlakyQuarantineReport(rootDir, report);
  return {
    report,
    effectiveExitCode: lastRun?.effectiveExitCode ?? options?.vitestExitCode ?? 0,
  };
}
