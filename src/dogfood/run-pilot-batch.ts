import path from "node:path";
import fs from "fs-extra";
import { runDexter } from "../core/orchestrator.js";
import { buildMetricsReport } from "../metrics/aggregator.js";

interface PilotScenario {
  project: string;
  idea: string;
  constraints: string[];
  targetUsers: string[];
}

const pilotScenarios: PilotScenario[] = [
  { project: "pilot-crm-api", idea: "Build a production CRM API with audit trails and role-based access", constraints: ["self-hosted-first", "rollback-required"], targetUsers: ["platform-team"] },
  { project: "pilot-analytics-dash", idea: "Build a SLO-aware analytics dashboard backend", constraints: ["policy-gated-autonomy"], targetUsers: ["ops-engineers"] },
  { project: "pilot-support-agent", idea: "Build support assistant APIs with incident traceability", constraints: ["memory-guardrails"], targetUsers: ["support-team"] },
  { project: "pilot-billing-core", idea: "Build a billing orchestration service with replay-safe jobs", constraints: ["strict-integrity"], targetUsers: ["finops-team"] },
  { project: "pilot-notifications", idea: "Build a multi-channel notification service with retries", constraints: ["reliability-first"], targetUsers: ["product-team"] },
  { project: "pilot-search-index", idea: "Build indexing pipeline with schema evolution support", constraints: ["data-migration-safe"], targetUsers: ["data-team"] },
  { project: "pilot-auth-service", idea: "Build authentication service with policy enforcement hooks", constraints: ["security-first"], targetUsers: ["security-team"] },
  { project: "pilot-docs-api", idea: "Build docs ingestion API with provenance traceability", constraints: ["supply-chain-gated"], targetUsers: ["devrel-team"] },
  { project: "pilot-rules-engine", idea: "Build business-rules evaluation service with deterministic replay", constraints: ["deterministic-execution"], targetUsers: ["operations"] },
  { project: "pilot-webhook-hub", idea: "Build webhook fanout service with dead-letter handling", constraints: ["high-availability"], targetUsers: ["integrations-team"] },
  { project: "pilot-feature-flags", idea: "Build feature flag backend with auditability and rollback", constraints: ["rollback-required"], targetUsers: ["application-team"] },
  { project: "pilot-internal-chatops", idea: "Build chatops command API with policy approvals", constraints: ["hitl-required"], targetUsers: ["infra-team"] },
];

async function main() {
  const rootDir = process.cwd();
  process.env.DEXTER_AUTO_APPROVE_HITL = "true";

  const results = [];
  for (const scenario of pilotScenarios) {
    const run = await runDexter(rootDir, scenario);
    results.push({
      project: scenario.project,
      runId: run.runId,
      verificationPassed: run.verificationPassed,
      durationMs: run.durationMs,
      memoryLessonsRetrieved: run.memoryLessonsRetrieved,
      deploymentMode: run.deploymentMode,
    });
  }

  const metrics = await buildMetricsReport(rootDir);
  const reportPath = path.join(rootDir, "artifacts", "release", "pilot_batch_report.json");
  await fs.writeJson(
    reportPath,
    {
      generatedAt: new Date().toISOString(),
      scenariosRun: pilotScenarios.length,
      scenarios: pilotScenarios.map((scenario) => scenario.project),
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
        scenariosRun: pilotScenarios.length,
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
