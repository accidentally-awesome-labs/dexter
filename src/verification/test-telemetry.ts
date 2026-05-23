import path from "node:path";
import fs from "fs-extra";
import { updateFlakyQuarantine } from "./flaky-quarantine.js";
import { loadFlakyTestPolicy, type FlakyTestPolicy } from "./flaky-test-policy.js";

export type TestOutcomeStatus = "passed" | "failed" | "skipped" | "pending";

export interface TestCaseOutcome {
  testId: string;
  file: string;
  name: string;
  status: TestOutcomeStatus;
  durationMs: number;
}

export interface TestRunRecord {
  runId: string;
  at: string;
  source: "unit" | "soak";
  exitCode: number;
  results: TestCaseOutcome[];
}

export interface TestTelemetryStore {
  schemaVersion: "1.0";
  updatedAt: string;
  runs: TestRunRecord[];
}

export interface FlakyCandidate {
  testId: string;
  file: string;
  name: string;
  passCount: number;
  failCount: number;
  skipCount: number;
  totalObservations: number;
  flipRate: number;
  confidence: number;
  flaky: boolean;
  stable: boolean;
}

export interface FlakyDetectionReport {
  schemaVersion: "1.0";
  generatedAt: string;
  policy: {
    minObservations: number;
    highConfidenceThreshold: number;
  };
  totalTrackedTests: number;
  flakyCandidateCount: number;
  highConfidenceFlakyCount: number;
  candidates: FlakyCandidate[];
}

interface VitestAssertionResult {
  fullName: string;
  status: string;
  duration?: number;
}

interface VitestJsonReport {
  success?: boolean;
  testResults?: Array<{
    name: string;
    assertionResults: VitestAssertionResult[];
  }>;
}

export function testTelemetryPath(rootDir: string): string {
  return path.join(rootDir, "artifacts", "verification", "TEST_TELEMETRY.json");
}

export function flakyCandidatesJsonPath(rootDir: string): string {
  return path.join(rootDir, "artifacts", "verification", "FLAKY_CANDIDATES.json");
}

export function flakyCandidatesMarkdownPath(rootDir: string): string {
  return path.join(rootDir, "artifacts", "verification", "FLAKY_CANDIDATES.md");
}

export function vitestReportPath(rootDir: string): string {
  return path.join(rootDir, "artifacts", "verification", "vitest-last.json");
}

function toTestId(file: string, fullName: string): string {
  return `${file}::${fullName}`;
}

export function parseVitestJsonReport(report: VitestJsonReport): TestCaseOutcome[] {
  const outcomes: TestCaseOutcome[] = [];
  for (const suite of report.testResults ?? []) {
    const file = suite.name;
    for (const assertion of suite.assertionResults ?? []) {
      const status = assertion.status as TestOutcomeStatus;
      if (status !== "passed" && status !== "failed" && status !== "skipped" && status !== "pending") {
        continue;
      }
      outcomes.push({
        testId: toTestId(file, assertion.fullName),
        file,
        name: assertion.fullName,
        status,
        durationMs: Math.round(assertion.duration ?? 0),
      });
    }
  }
  return outcomes;
}

export async function loadTestTelemetry(rootDir: string): Promise<TestTelemetryStore> {
  const file = testTelemetryPath(rootDir);
  if (!(await fs.pathExists(file))) {
    return {
      schemaVersion: "1.0",
      updatedAt: new Date().toISOString(),
      runs: [],
    };
  }
  return (await fs.readJson(file)) as TestTelemetryStore;
}

export async function appendTestRun(
  rootDir: string,
  run: TestRunRecord,
  policy?: FlakyTestPolicy,
): Promise<TestTelemetryStore> {
  const resolvedPolicy = policy ?? (await loadFlakyTestPolicy(rootDir));
  const current = await loadTestTelemetry(rootDir);
  const next: TestTelemetryStore = {
    schemaVersion: "1.0",
    updatedAt: run.at,
    runs: [...current.runs, run].slice(-resolvedPolicy.maxRunsRetained),
  };
  await fs.ensureDir(path.dirname(testTelemetryPath(rootDir)));
  await fs.writeJson(testTelemetryPath(rootDir), next, { spaces: 2 });
  return next;
}

export function detectFlakyCandidates(
  store: TestTelemetryStore,
  policy: FlakyTestPolicy,
  generatedAt = new Date().toISOString(),
): FlakyDetectionReport {
  const byTest = new Map<string, FlakyCandidate & { statuses: TestOutcomeStatus[] }>();

  for (const run of store.runs) {
    for (const result of run.results) {
      const existing =
        byTest.get(result.testId) ??
        ({
          testId: result.testId,
          file: result.file,
          name: result.name,
          passCount: 0,
          failCount: 0,
          skipCount: 0,
          totalObservations: 0,
          flipRate: 0,
          confidence: 0,
          flaky: false,
          stable: true,
          statuses: [],
        } as FlakyCandidate & { statuses: TestOutcomeStatus[] });

      existing.totalObservations += 1;
      if (result.status === "passed") {
        existing.passCount += 1;
      } else if (result.status === "failed") {
        existing.failCount += 1;
      } else {
        existing.skipCount += 1;
      }
      existing.statuses.push(result.status);
      byTest.set(result.testId, existing);
    }
  }

  const candidates: FlakyCandidate[] = [];
  for (const item of byTest.values()) {
    const decisive = item.passCount + item.failCount;
    const flipRate =
      decisive === 0 ? 0 : Math.round(((2 * Math.min(item.passCount, item.failCount)) / decisive) * 1000) / 1000;
    const sampleFactor = Math.min(1, item.totalObservations / policy.minObservations);
    const confidence = Math.round(flipRate * sampleFactor * 1000) / 1000;
    const passRate = item.totalObservations === 0 ? 0 : item.passCount / item.totalObservations;
    const stable =
      item.totalObservations >= policy.minObservations &&
      (passRate >= policy.stablePassRateThreshold || item.failCount === 0 && item.passCount > 0);
    const flaky =
      item.totalObservations >= policy.minObservations &&
      item.passCount >= policy.minPasses &&
      item.failCount >= policy.minFails &&
      flipRate >= policy.minFlipRate &&
      confidence >= policy.highConfidenceThreshold;

    candidates.push({
      testId: item.testId,
      file: item.file,
      name: item.name,
      passCount: item.passCount,
      failCount: item.failCount,
      skipCount: item.skipCount,
      totalObservations: item.totalObservations,
      flipRate,
      confidence,
      flaky,
      stable,
    });
  }

  const sorted = candidates.sort(
    (left, right) => right.confidence - left.confidence || left.testId.localeCompare(right.testId),
  );
  const flakyOnes = sorted.filter((item) => item.flaky);

  return {
    schemaVersion: "1.0",
    generatedAt,
    policy: {
      minObservations: policy.minObservations,
      highConfidenceThreshold: policy.highConfidenceThreshold,
    },
    totalTrackedTests: sorted.length,
    flakyCandidateCount: flakyOnes.length,
    highConfidenceFlakyCount: flakyOnes.length,
    candidates: sorted,
  };
}

export function renderFlakyCandidatesMarkdown(report: FlakyDetectionReport): string {
  const flaky = report.candidates.filter((item) => item.flaky);
  return [
    "# Flaky Test Candidates",
    "",
    `Generated at: ${report.generatedAt}`,
    `Tracked tests: ${report.totalTrackedTests}`,
    `High-confidence flaky: ${report.highConfidenceFlakyCount}`,
    "",
    "## Candidates",
    "",
    ...(flaky.length === 0
      ? ["- None at high confidence"]
      : flaky.map(
          (item) =>
            `- ${item.name} (${item.file}) — confidence ${item.confidence}, flipRate ${item.flipRate}, pass/fail ${item.passCount}/${item.failCount}`,
        )),
    "",
    "## Stable Tests (sample)",
    "",
    ...report.candidates
      .filter((item) => item.stable && !item.flaky)
      .slice(0, 10)
      .map((item) => `- ${item.name} — pass ${item.passCount}/${item.totalObservations}`),
    "",
  ].join("\n");
}

export async function ingestVitestReport(
  rootDir: string,
  options?: {
    source?: TestRunRecord["source"];
    exitCode?: number;
    reportPath?: string;
    runId?: string;
  },
): Promise<{
  store: TestTelemetryStore;
  flaky: FlakyDetectionReport;
  effectiveExitCode: number;
}> {
  const policy = await loadFlakyTestPolicy(rootDir);
  const reportFile = options?.reportPath ?? vitestReportPath(rootDir);
  if (!(await fs.pathExists(reportFile))) {
    throw new Error(`Vitest JSON report not found: ${reportFile}`);
  }
  const report = (await fs.readJson(reportFile)) as VitestJsonReport;
  const results = parseVitestJsonReport(report);
  const at = new Date().toISOString();
  const store = await appendTestRun(
    rootDir,
    {
      runId: options?.runId ?? `unit-${at}`,
      at,
      source: options?.source ?? "unit",
      exitCode: options?.exitCode ?? (report.success ? 0 : 1),
      results,
    },
    policy,
  );
  const flaky = detectFlakyCandidates(store, policy, at);
  await fs.writeJson(flakyCandidatesJsonPath(rootDir), flaky, { spaces: 2 });
  await fs.writeFile(flakyCandidatesMarkdownPath(rootDir), renderFlakyCandidatesMarkdown(flaky));
  const { effectiveExitCode } = await updateFlakyQuarantine(rootDir, flaky, {
    vitestExitCode: options?.exitCode ?? (report.success ? 0 : 1),
    lastRunOutcomes: results,
  });
  return { store, flaky, effectiveExitCode };
}

export async function refreshFlakyCandidates(rootDir: string): Promise<FlakyDetectionReport> {
  const policy = await loadFlakyTestPolicy(rootDir);
  const store = await loadTestTelemetry(rootDir);
  const flaky = detectFlakyCandidates(store, policy);
  await fs.writeJson(flakyCandidatesJsonPath(rootDir), flaky, { spaces: 2 });
  await fs.writeFile(flakyCandidatesMarkdownPath(rootDir), renderFlakyCandidatesMarkdown(flaky));
  return flaky;
}
