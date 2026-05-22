import path from "node:path";
import fs from "fs-extra";
import type { ExecutionResult } from "../protocols/types.js";
import type { SoakStatus } from "../release/soak-types.js";
import {
  loadFailureTaxonomyPolicy,
  type FailureTaxonomyClass,
  type FailureTaxonomyPolicy,
} from "./failure-taxonomy-policy.js";

export interface RawFailureSignal {
  source: string;
  sourceId: string;
  at: string;
  signal: string;
}

export interface ClassifiedFailure extends RawFailureSignal {
  taxonomyClass: string;
  mappedBy: string;
  severity: FailureTaxonomyClass["severity"];
}

export interface FailureClassSummary {
  taxonomyClass: string;
  title: string;
  severity: FailureTaxonomyClass["severity"];
  count: number;
  share: number;
}

export interface FailureTaxonomyReport {
  schemaVersion: "1.0";
  generatedAt: string;
  totalFailures: number;
  unmappedCount: number;
  allMapped: boolean;
  classSummaries: FailureClassSummary[];
  records: ClassifiedFailure[];
}

export function failureTaxonomyMarkdownPath(rootDir: string): string {
  return path.join(rootDir, "artifacts", "verification", "FAILURE_TAXONOMY.md");
}

export function failureTaxonomyJsonPath(rootDir: string): string {
  return path.join(rootDir, "artifacts", "verification", "FAILURE_TAXONOMY.json");
}

function normalizeSignal(signal: string): string {
  return signal.toLowerCase();
}

export function classifyFailureSignal(
  raw: RawFailureSignal,
  policy: FailureTaxonomyPolicy,
): ClassifiedFailure {
  const normalized = normalizeSignal(raw.signal);
  for (const rule of policy.mappingRules) {
    if (rule.source !== raw.source && rule.source !== "*") {
      continue;
    }
    if (rule.signalIncludes.every((fragment) => normalized.includes(fragment.toLowerCase()))) {
      const taxonomyClass = policy.classes.find((item) => item.id === rule.class)?.id ?? rule.class;
      const meta = policy.classes.find((item) => item.id === taxonomyClass);
      return {
        ...raw,
        taxonomyClass,
        mappedBy: rule.id,
        severity: meta?.severity ?? "medium",
      };
    }
  }

  const fallbackClass = policy.sourceFallbacks[raw.source] ?? "unknown";
  const meta = policy.classes.find((item) => item.id === fallbackClass);
  return {
    ...raw,
    taxonomyClass: fallbackClass,
    mappedBy: `fallback:${raw.source}`,
    severity: meta?.severity ?? "low",
  };
}

function summarize(records: ClassifiedFailure[], policy: FailureTaxonomyPolicy): FailureClassSummary[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    counts.set(record.taxonomyClass, (counts.get(record.taxonomyClass) ?? 0) + 1);
  }
  const total = records.length;
  return [...counts.entries()]
    .map(([taxonomyClass, count]) => {
      const meta = policy.classes.find((item) => item.id === taxonomyClass);
      return {
        taxonomyClass,
        title: meta?.title ?? taxonomyClass,
        severity: meta?.severity ?? "low",
        count,
        share: total === 0 ? 0 : Math.round((count / total) * 1000) / 1000,
      };
    })
    .sort((left, right) => right.count - left.count || left.taxonomyClass.localeCompare(right.taxonomyClass));
}

export function buildFailureTaxonomyReport(
  signals: RawFailureSignal[],
  policy: FailureTaxonomyPolicy,
  generatedAt = new Date().toISOString(),
): FailureTaxonomyReport {
  const records = signals.map((signal) => classifyFailureSignal(signal, policy));
  const unmappedCount = records.filter((record) => record.taxonomyClass === "unknown").length;
  return {
    schemaVersion: "1.0",
    generatedAt,
    totalFailures: records.length,
    unmappedCount,
    allMapped: unmappedCount === 0,
    classSummaries: summarize(records, policy),
    records,
  };
}

function taskFailureSignal(task: ExecutionResult): string {
  const parts = [
    `taskId=${task.taskId}`,
    `status=${task.status}`,
    task.failureReason ? `failureReason=${task.failureReason}` : "",
    task.escalation?.reason ? `escalation=${task.escalation.reason}` : "",
  ];
  return parts.filter(Boolean).join(" ");
}

async function collectSoakFailures(rootDir: string): Promise<RawFailureSignal[]> {
  const statusPath = path.join(rootDir, "artifacts", "release", "SOAK_STATUS.json");
  if (!(await fs.pathExists(statusPath))) {
    return [];
  }
  const status = (await fs.readJson(statusPath)) as SoakStatus;
  const failures: RawFailureSignal[] = [];
  for (const cycle of status.history) {
    if (cycle.passed) {
      continue;
    }
    const failedStep = cycle.steps.find((step) => step.exitCode !== 0);
    failures.push({
      source: "soak",
      sourceId: cycle.at,
      at: cycle.at,
      signal: [cycle.failureReason ?? "soak cycle failed", failedStep ? `step=${failedStep.name}` : ""]
        .filter(Boolean)
        .join(" "),
    });
  }
  return failures;
}

async function collectRunFailures(rootDir: string): Promise<RawFailureSignal[]> {
  const runsDir = path.join(rootDir, "runs");
  if (!(await fs.pathExists(runsDir))) {
    return [];
  }
  const failures: RawFailureSignal[] = [];
  for (const runId of await fs.readdir(runsDir)) {
    if (runId === "README.md") {
      continue;
    }
    const runDir = path.join(runsDir, runId);
    const summaryPath = path.join(runDir, "run_summary.json");
    const executionPath = path.join(runDir, "execution_results.json");
    let at = new Date().toISOString();

    if (await fs.pathExists(summaryPath)) {
      const summary = (await fs.readJson(summaryPath)) as {
        startedAt?: string;
        runStatus?: string;
        productionReady?: boolean;
        verificationPassed?: boolean;
        requiredEscalations?: number;
      };
      at = summary.startedAt ?? at;
      const runFailed =
        summary.runStatus === "blocked" ||
        summary.runStatus === "degraded" ||
        summary.productionReady === false ||
        summary.verificationPassed === false;
      if (runFailed) {
        failures.push({
          source: "run",
          sourceId: runId,
          at,
          signal: [
            `runStatus=${summary.runStatus ?? "unknown"}`,
            `productionReady=${String(summary.productionReady ?? false)}`,
            `verificationPassed=${String(summary.verificationPassed ?? false)}`,
            (summary.requiredEscalations ?? 0) > 0 ? `unresolved escalation count=${summary.requiredEscalations}` : "",
          ]
            .filter(Boolean)
            .join(" "),
        });
      }
    }

    if (await fs.pathExists(executionPath)) {
      const execution = (await fs.readJson(executionPath)) as ExecutionResult[];
      for (const task of execution) {
        if (task.status !== "failed") {
          continue;
        }
        failures.push({
          source: "run.task",
          sourceId: `${runId}:${task.taskId}`,
          at,
          signal: taskFailureSignal(task),
        });
      }
    }

    const replanPath = path.join(runDir, "replan_waves_summary.json");
    if (await fs.pathExists(replanPath)) {
      const replan = (await fs.readJson(replanPath)) as { stoppedReason?: string; generatedAt?: string };
      if (replan.stoppedReason === "stalled" || replan.stoppedReason === "max_waves") {
        failures.push({
          source: "run.replan",
          sourceId: runId,
          at: replan.generatedAt ?? at,
          signal: `replan stoppedReason=${replan.stoppedReason}`,
        });
      }
    }
  }
  return failures;
}

async function collectPilotFailures(rootDir: string): Promise<RawFailureSignal[]> {
  const reportPath = path.join(rootDir, "artifacts", "intake", "pilot-batch", "PILOT_BATCH_REPORT.json");
  if (!(await fs.pathExists(reportPath))) {
    return [];
  }
  const report = (await fs.readJson(reportPath)) as {
    generatedAt: string;
    results: Array<{
      requestId: string;
      completed: boolean;
      clarificationRequired: boolean;
      error?: string;
      manualInterventions: Array<{ type: string; details: string }>;
    }>;
  };
  const failures: RawFailureSignal[] = [];
  for (const result of report.results) {
    if (!result.completed) {
      failures.push({
        source: "intake.pilot",
        sourceId: result.requestId,
        at: report.generatedAt,
        signal: [
          "completed=false",
          result.clarificationRequired ? "clarification gate blocked" : "",
          result.error ?? "pilot failed",
        ]
          .filter(Boolean)
          .join(" "),
      });
      continue;
    }
    for (const intervention of result.manualInterventions) {
      if (intervention.type === "execution_blocked") {
        failures.push({
          source: "intake.pilot",
          sourceId: result.requestId,
          at: report.generatedAt,
          signal: `execution_blocked ${intervention.details}`,
        });
      }
    }
  }
  return failures;
}

async function collectTrustGateFailures(rootDir: string): Promise<RawFailureSignal[]> {
  const reportPath = path.join(rootDir, "artifacts", "verification", "TRUST_GATES_REPORT.json");
  if (!(await fs.pathExists(reportPath))) {
    return [];
  }
  const report = (await fs.readJson(reportPath)) as {
    generatedAt: string;
    results: Array<{ name: string; passed: boolean; actual: string }>;
  };
  return report.results
    .filter((item) => !item.passed)
    .map((item) => ({
      source: "trust_gates",
      sourceId: item.name,
      at: report.generatedAt,
      signal: `scenario failed passed=false ${item.actual}`,
    }));
}

async function collectPromotionFailures(rootDir: string): Promise<RawFailureSignal[]> {
  const historyPath = path.join(rootDir, "artifacts", "release", "PROMOTION_HISTORY.json");
  if (!(await fs.pathExists(historyPath))) {
    return [];
  }
  const history = (await fs.readJson(historyPath)) as {
    updatedAt: string;
    promotions: Array<{ promotionId: string; passed: boolean; generatedAt: string }>;
  };
  return history.promotions
    .filter((item) => !item.passed)
    .map((item) => ({
      source: "promotion",
      sourceId: item.promotionId,
      at: item.generatedAt ?? history.updatedAt,
      signal: "promotion passed=false stage_failed",
    }));
}

async function collectEscalationFailures(rootDir: string): Promise<RawFailureSignal[]> {
  const statePath = path.join(rootDir, "artifacts", "execution", "ESCALATION_STATE.json");
  if (!(await fs.pathExists(statePath))) {
    return [];
  }
  const state = (await fs.readJson(statePath)) as {
    updatedAt?: string;
    items: Array<{
      key: string;
      status: string;
      target: string;
      priority: string;
      reason: string;
    }>;
  };
  return state.items
    .filter((item) => item.status === "open" || item.status === "in_progress")
    .map((item) => ({
      source: "escalation",
      sourceId: item.key,
      at: state.updatedAt ?? new Date().toISOString(),
      signal: `unresolved escalation status=${item.status} target=${item.target} priority=${item.priority} ${item.reason}`,
    }));
}

async function collectGovernanceFailures(rootDir: string): Promise<RawFailureSignal[]> {
  const reportPath = path.join(rootDir, "artifacts", "release", "GOVERNANCE_VERIFICATION.json");
  if (!(await fs.pathExists(reportPath))) {
    return [];
  }
  const report = (await fs.readJson(reportPath)) as {
    generatedAt: string;
    passed: boolean;
    checks: Array<{ name: string; passed: boolean; detail: string }>;
  };
  if (report.passed) {
    return [];
  }
  return report.checks
    .filter((check) => !check.passed)
    .map((check) => ({
      source: "governance",
      sourceId: check.name,
      at: report.generatedAt,
      signal: `governance check failed ${check.detail}`,
    }));
}

async function collectCanaryFailures(rootDir: string): Promise<RawFailureSignal[]> {
  const rollbackPath = path.join(rootDir, "artifacts", "release", "SLO_ROLLBACK_RESULT.json");
  if (!(await fs.pathExists(rollbackPath))) {
    return [];
  }
  const rollback = (await fs.readJson(rollbackPath)) as {
    generatedAt?: string;
    rolledBack?: boolean;
    trigger?: string;
    reason?: string;
  };
  if (!rollback.rolledBack) {
    return [];
  }
  return [
    {
      source: "canary",
      sourceId: rollback.trigger ?? "slo-rollback",
      at: rollback.generatedAt ?? new Date().toISOString(),
      signal: `canary slo rollback trigger=${rollback.trigger ?? "unknown"} ${rollback.reason ?? ""}`.trim(),
    },
  ];
}

export async function collectFailureSignals(rootDir: string): Promise<RawFailureSignal[]> {
  const chunks = await Promise.all([
    collectSoakFailures(rootDir),
    collectRunFailures(rootDir),
    collectPilotFailures(rootDir),
    collectTrustGateFailures(rootDir),
    collectPromotionFailures(rootDir),
    collectEscalationFailures(rootDir),
    collectGovernanceFailures(rootDir),
    collectCanaryFailures(rootDir),
  ]);
  return chunks.flat().sort((left, right) => left.at.localeCompare(right.at));
}

export function renderFailureTaxonomyMarkdown(report: FailureTaxonomyReport): string {
  const topClasses = report.classSummaries.slice(0, 10);
  return [
    "# Failure Taxonomy",
    "",
    `Generated at: ${report.generatedAt}`,
    `Total failures: ${report.totalFailures}`,
    `All mapped: ${report.allMapped ? "yes" : "no"} (${report.unmappedCount} unknown)`,
    "",
    "## Top Failure Classes",
    "",
    "| Class | Title | Severity | Count | Share |",
    "| --- | --- | --- | ---: | ---: |",
    ...topClasses.map(
      (item) =>
        `| ${item.taxonomyClass} | ${item.title} | ${item.severity} | ${item.count} | ${item.share} |`,
    ),
    "",
    "## Class Frequency",
    "",
    ...report.classSummaries.map(
      (item) => `- ${item.taxonomyClass} (${item.severity}): ${item.count} (${(item.share * 100).toFixed(1)}%)`,
    ),
    "",
    "## Recent Failure Records",
    "",
    ...report.records.slice(-25).map(
      (record) =>
        `- [${record.taxonomyClass}] ${record.source}/${record.sourceId} @ ${record.at} — ${record.signal} (rule: ${record.mappedBy})`,
    ),
    "",
  ].join("\n");
}

export async function loadFailureTaxonomyReport(rootDir: string): Promise<FailureTaxonomyReport | null> {
  const jsonPath = failureTaxonomyJsonPath(rootDir);
  if (!(await fs.pathExists(jsonPath))) {
    return null;
  }
  return (await fs.readJson(jsonPath)) as FailureTaxonomyReport;
}

export async function resolveFailureTaxonomyReport(
  rootDir: string,
  options?: { refresh?: boolean },
): Promise<{ markdownPath: string; jsonPath: string; report: FailureTaxonomyReport }> {
  const markdownPath = failureTaxonomyMarkdownPath(rootDir);
  const jsonPath = failureTaxonomyJsonPath(rootDir);
  if (!options?.refresh) {
    const existing = await loadFailureTaxonomyReport(rootDir);
    if (existing) {
      return { markdownPath, jsonPath, report: existing };
    }
  }
  return writeFailureTaxonomyReport(rootDir);
}

export async function writeFailureTaxonomyReport(
  rootDir: string,
): Promise<{ markdownPath: string; jsonPath: string; report: FailureTaxonomyReport }> {
  const policy = await loadFailureTaxonomyPolicy(rootDir);
  const signals = await collectFailureSignals(rootDir);
  const report = buildFailureTaxonomyReport(signals, policy);
  const markdownPath = failureTaxonomyMarkdownPath(rootDir);
  const jsonPath = failureTaxonomyJsonPath(rootDir);
  await fs.ensureDir(path.dirname(markdownPath));
  await fs.writeFile(markdownPath, renderFailureTaxonomyMarkdown(report));
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  return { markdownPath, jsonPath, report };
}
