import path from "node:path";
import fs from "fs-extra";
import { runDexter } from "../core/orchestrator.js";
import { buildMetricsReport } from "../metrics/aggregator.js";

const scenarios = [
  {
    project: "dexter-crm-api",
    idea: "Build a production-ready CRM API with audit trails and role-based access.",
    constraints: ["self-hosted-first", "rollback-required"],
    targetUsers: ["internal-platform-team"],
  },
  {
    project: "dexter-analytics-dashboard",
    idea: "Build a metrics dashboard service with SLO alerts and release gating.",
    constraints: ["self-hosted-first", "policy-gated-autonomy"],
    targetUsers: ["ops-engineers"],
  },
  {
    project: "dexter-support-assistant",
    idea: "Build a support assistant backend with memory-safe workflows and incident traces.",
    constraints: ["self-hosted-first", "memory-guardrails"],
    targetUsers: ["support-platform-team"],
  },
];

async function ensureApprovalsAndHooks(rootDir: string, project: string) {
  await fs.ensureDir(path.join(rootDir, "state", project));
}

async function main() {
  const rootDir = process.cwd();
  process.env.DEXTER_AUTO_APPROVE_HITL = "true";
  const results = [];
  for (const scenario of scenarios) {
    await ensureApprovalsAndHooks(rootDir, scenario.project);
    const result = await runDexter(rootDir, scenario);
    results.push({
      project: scenario.project,
      runId: result.runId,
      verificationPassed: result.verificationPassed,
      durationMs: result.durationMs,
      memoryLessonsRetrieved: result.memoryLessonsRetrieved,
    });
  }

  const metrics = await buildMetricsReport(rootDir);
  const reportPath = path.join(rootDir, "artifacts", "release", "dogfood_run_report.json");
  await fs.writeJson(
    reportPath,
    {
      generatedAt: new Date().toISOString(),
      scenariosRun: results.length,
      results,
      metricsPath: metrics.outputPath,
      metrics: metrics.report,
    },
    { spaces: 2 },
  );

  console.log(
    JSON.stringify(
      {
        reportPath,
        metricsPath: metrics.outputPath,
        scenariosRun: results.length,
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
