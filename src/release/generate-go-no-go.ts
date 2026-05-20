import path from "node:path";
import fs from "fs-extra";
import { buildMetricsReport } from "../metrics/aggregator.js";

interface GoNoGoThresholds {
  readinessPassRate: number;
  memoryHitRate: number;
  repeatedFailureRateMax: number;
  avgTimeToReadyMsMax: number;
}

const thresholds: GoNoGoThresholds = {
  readinessPassRate: 0.95,
  memoryHitRate: 0.8,
  repeatedFailureRateMax: 0.05,
  avgTimeToReadyMsMax: 5000,
};

interface MetricsSnapshot {
  totalRuns: number;
  readinessPassRate: number;
  memoryHitRate: number;
  repeatedFailureRate: number;
  avgTimeToReadyMs: number;
}

function evaluate(report: MetricsSnapshot) {
  const checks = [
    {
      name: "Readiness pass rate",
      pass: report.readinessPassRate >= thresholds.readinessPassRate,
      value: report.readinessPassRate,
      threshold: `>= ${thresholds.readinessPassRate}`,
    },
    {
      name: "Memory hit rate",
      pass: report.memoryHitRate >= thresholds.memoryHitRate,
      value: report.memoryHitRate,
      threshold: `>= ${thresholds.memoryHitRate}`,
    },
    {
      name: "Repeated failure rate",
      pass: report.repeatedFailureRate <= thresholds.repeatedFailureRateMax,
      value: report.repeatedFailureRate,
      threshold: `<= ${thresholds.repeatedFailureRateMax}`,
    },
    {
      name: "Average time to ready (ms)",
      pass: report.avgTimeToReadyMs <= thresholds.avgTimeToReadyMsMax,
      value: report.avgTimeToReadyMs,
      threshold: `<= ${thresholds.avgTimeToReadyMsMax}`,
    },
  ];

  const go = checks.every((check) => check.pass);
  return { go, checks };
}

async function main() {
  const rootDir = process.cwd();
  const metrics = await buildMetricsReport(rootDir);
  const { go, checks } = evaluate(metrics.report);

  const lines = [
    "# GO_NO_GO",
    "",
    `Decision: **${go ? "GO" : "NO-GO"}**`,
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    "## Metrics Snapshot",
    `- Total runs: ${metrics.report.totalRuns}`,
    `- Readiness pass rate: ${metrics.report.readinessPassRate}`,
    `- Memory hit rate: ${metrics.report.memoryHitRate}`,
    `- Repeated failure rate: ${metrics.report.repeatedFailureRate}`,
    `- Average time to ready (ms): ${metrics.report.avgTimeToReadyMs}`,
    "",
    "## Gate Criteria",
    ...checks.map((check) => `- [${check.pass ? "x" : " "}] ${check.name}: ${check.value} (${check.threshold})`),
    "",
    "## Notes",
    "- This decision is based on current run telemetry and gate thresholds.",
    "- Re-run pilot batch before final production promotion.",
  ];

  const outPath = path.join(rootDir, "artifacts", "release", "GO_NO_GO.md");
  await fs.ensureDir(path.dirname(outPath));
  await fs.writeFile(outPath, lines.join("\n"));

  console.log(JSON.stringify({ outPath, decision: go ? "GO" : "NO-GO" }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
