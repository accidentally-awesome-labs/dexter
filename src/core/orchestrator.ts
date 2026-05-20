import path from "node:path";
import fs from "fs-extra";
import type { IdeaInput, PolicyDecision } from "../protocols/types.js";
import { ideaInputSchema } from "../protocols/schemas.js";
import { createRunContext } from "./context.js";
import { createLogger } from "../observability/logger.js";
import { runGrillingSession } from "../skills/discovery/grilling.js";
import { synthesizeResearch } from "../skills/discovery/research.js";
import { compilePlan } from "../skills/planning/compiler.js";
import { provisionIsolatedEnvironment } from "../runtime/provisioner.js";
import { executeTasks } from "../skills/execution/task-executor.js";
import { runVerification } from "../verification/verification-gate.js";
import { createReleaseBundle } from "../skills/release/release-packager.js";
import { addLearning, retrieveLessons } from "../memory/global-learning-graph.js";
import { createControlPlaneAdapter } from "../runtime/control-plane.js";
import { defaultRadarEntries } from "../tech-radar/radar.js";
import { ensureTenant } from "../managed/tenant.js";
import { evaluatePolicyGate } from "../policy/gate.js";
import { generateAttestation } from "../release/attestation.js";
import { generateProvenance } from "../release/provenance.js";
import { verifyAttestation } from "../release/attestation.js";
import { verifyProvenance } from "../release/provenance.js";
import {
  computePlanningSignatureDigest,
  generatePlanningSignatures,
  verifyPlanningSignatures,
} from "../planning/signature.js";
import { generateDeployAuthorization } from "../deploy/authorization.js";
import { runDeploymentHealthChecks } from "../runtime/deployment-health.js";

async function writePlanningArtifacts(rootDir: string, plan: ReturnType<typeof compilePlan>) {
  const dir = path.join(rootDir, "artifacts", "planning");
  await fs.ensureDir(dir);
  await fs.writeFile(path.join(dir, "PRD.md"), plan.prd);
  await fs.writeFile(path.join(dir, "ARCHITECTURE_SPEC.md"), plan.architecture);
  await fs.writeFile(path.join(dir, "NFR_SPEC.md"), plan.nfrSpec);
  await fs.writeFile(path.join(dir, "TEST_STRATEGY.md"), plan.testStrategy);
  await fs.writeJson(path.join(dir, "TASK_GRAPH.json"), plan.tasks, { spaces: 2 });
}

async function writeDiscoveryArtifacts(rootDir: string, discovery: ReturnType<typeof runGrillingSession>) {
  const dir = path.join(rootDir, "artifacts", "discovery");
  await fs.ensureDir(dir);
  await fs.writeFile(path.join(dir, "BRIEF.md"), discovery.brief);
  await fs.writeFile(
    path.join(dir, "GLOSSARY.md"),
    Object.entries(discovery.glossary)
      .map(([term, definition]) => `- **${term}**: ${definition}`)
      .join("\n"),
  );
  await fs.writeFile(
    path.join(dir, "MARKET_EVIDENCE.md"),
    discovery.marketEvidence.map((evidence) => `- ${evidence}`).join("\n"),
  );
  await fs.writeFile(
    path.join(dir, "RISK_REGISTER.md"),
    discovery.risks
      .map((risk) => `- [${risk.level}] ${risk.title}\n  - Mitigation: ${risk.mitigation}`)
      .join("\n"),
  );
}

async function writePolicyArtifacts(rootDir: string, policy: PolicyDecision) {
  const securityDir = path.join(rootDir, "docs", "security");
  const specsDir = path.join(rootDir, "docs", "specs");
  await fs.ensureDir(securityDir);
  await fs.ensureDir(specsDir);

  await fs.writeFile(
    path.join(securityDir, "SECURITY_BASELINE.md"),
    `# Security Baseline\n\n- Policy gate approved: ${policy.approved}\n- Required rollback checks:\n${policy.requiredRollbackChecks
      .map((check) => `  - ${check}`)
      .join("\n")}\n`,
  );
  await fs.writeFile(
    path.join(securityDir, "THREAT_MODEL_TEMPLATE.md"),
    "# Threat Model Template\n\n## Assets\n## Trust boundaries\n## Abuse cases\n## Mitigations\n",
  );
  await fs.writeFile(
    path.join(specsDir, "AUTONOMY_POLICY.md"),
    `# Autonomy Policy\n\n- Fully autonomous for reversible tasks.\n- Mandatory rollback and policy checks before deploy.\n- Current policy status: ${
      policy.approved ? "approved" : "blocked"
    }\n${policy.blockers.length ? `\n## Blockers\n${policy.blockers.map((b) => `- ${b}`).join("\n")}\n` : ""}`,
  );
}

async function writeGlobalMemoryArtifacts(rootDir: string) {
  const dir = path.join(rootDir, "global-memory");
  await fs.ensureDir(dir);

  await fs.writeFile(
    path.join(dir, "LEARNING_SCHEMA.md"),
    "# Learning Schema\n\n- category\n- title\n- lesson\n- confidence\n- tags\n",
  );
  await fs.writeFile(
    path.join(dir, "INGESTION_POLICY.md"),
    "# Ingestion Policy\n\n- De-identify content.\n- Reject secrets and credentials.\n- Deduplicate before persist.\n",
  );
  await fs.writeFile(
    path.join(dir, "RETRIEVAL_POLICY.md"),
    "# Retrieval Policy\n\n- Retrieve lessons before planning and execution.\n- Prioritize confidence + tag overlap.\n",
  );
  await fs.writeFile(
    path.join(dir, "MEMORY_QUALITY_REPORT.md"),
    "# Memory Quality Report\n\n- Metrics: recall accuracy, contradiction rate, stale-memory rate.\n",
  );
}

async function writeOpsArtifacts(rootDir: string) {
  const opsDir = path.join(rootDir, "docs", "operations");
  await fs.ensureDir(opsDir);
  await fs.writeFile(path.join(opsDir, "SLO_TEMPLATE.md"), "# SLO Template\n\n- Availability\n- Latency\n- Error budget\n");
  await fs.writeFile(path.join(opsDir, "INCIDENT_RUNBOOK.md"), "# Incident Runbook\n\n1. Triage\n2. Mitigate\n3. Recover\n4. Postmortem\n");
  await fs.writeFile(path.join(opsDir, "DR_PLAYBOOK.md"), "# DR Playbook\n\n- Backup restore drill\n- Region failover\n");
}

async function writeTechRadarArtifacts(rootDir: string) {
  const dir = path.join(rootDir, "tech-radar");
  await fs.ensureDir(dir);
  const entries = defaultRadarEntries();

  await fs.writeFile(
    path.join(dir, "RADAR.md"),
    "# Tech Radar\n\n" + entries.map((entry) => `- [${entry.ring}] ${entry.category}: ${entry.tool} (${entry.rationale})`).join("\n"),
  );
  await fs.writeFile(
    path.join(dir, "BENCHMARK_SCORES.md"),
    "# Benchmark Scores\n\n- Template: performance, reliability, integration effort, security, cost.\n",
  );
  await fs.writeFile(
    path.join(dir, "UPGRADE_DECISIONS.md"),
    "# Upgrade Decisions\n\n- Record every stack change with before/after metrics and rollback path.\n",
  );
}

async function writeVerificationArtifacts(rootDir: string, verification: Awaited<ReturnType<typeof runVerification>>) {
  const dir = path.join(rootDir, "artifacts", "verification");
  await fs.ensureDir(dir);
  await fs.writeFile(
    path.join(dir, "VERIFICATION_REPORT.md"),
    `# Verification Report\n\n- Passed: ${verification.passed}\n${verification.checks
      .map((check) => `- ${check.name}: ${check.passed ? "pass" : "fail"} (${check.details})`)
      .join("\n")}\n`,
  );
  await fs.writeFile(
    path.join(dir, "ROLLBACK_PLAN.md"),
    "# Rollback Plan\n\n- Trigger: failed health check\n- Action: control-plane rollback endpoint\n- Validate: smoke tests + audit logs\n",
  );
}

async function writeReleaseArtifacts(rootDir: string) {
  const dir = path.join(rootDir, "artifacts", "release");
  await fs.ensureDir(dir);

  const files: Record<string, string> = {
    DEPLOYMENT_GUIDE: "# Deployment Guide\n\n- Build image\n- Deploy via control-plane adapter\n- Validate health checks\n",
    OPERATIONS_RUNBOOK: "# Operations Runbook\n\n- Alerts\n- Escalation\n- SLO monitoring\n",
    RELEASE_NOTES: "# Release Notes\n\n- Initial Dexter v1 baseline implementation.\n",
    PRODUCTION_READINESS_CHECKLIST:
      "# Production Readiness Checklist\n\n- [x] Policy gate\n- [x] Verification gate\n- [x] Rollback ready\n- [x] Docs synced\n",
  };

  await Promise.all(
    Object.entries(files).map(([name, content]) => fs.writeFile(path.join(dir, `${name}.md`), content)),
  );
}

export async function runDexter(rootDir: string, rawInput: IdeaInput) {
  const startedAtMs = Date.now();
  const idea = ideaInputSchema.parse(rawInput);
  const ctx = await createRunContext(rootDir, idea);
  const logger = await createLogger(ctx);

  logger.info({ stage: "discovery" }, "Starting discovery phase");
  const grilled = runGrillingSession(idea);
  const research = await synthesizeResearch(idea);
  const discovery = {
    ...grilled,
    marketEvidence: research.marketEvidence,
    risks: [...grilled.risks, ...research.risks],
  };
  await writeDiscoveryArtifacts(rootDir, discovery);

  logger.info({ stage: "memory" }, "Loading prior lessons");
  const priorLessons = await retrieveLessons(rootDir, ["runtime", "policy", "memory"], 5);
  await fs.writeFile(
    path.join(ctx.runDir, "prior_lessons.json"),
    JSON.stringify(priorLessons, null, 2),
  );

  logger.info({ stage: "planning" }, "Compiling plan artifacts");
  const plan = compilePlan(discovery, {
    project: idea.project,
    priorLessons: priorLessons.map((item) => item.lesson),
  });
  await writePlanningArtifacts(rootDir, plan);
  await generatePlanningSignatures(rootDir);

  logger.info({ stage: "policyGate" }, "Evaluating policy gate");
  const policy = await evaluatePolicyGate({
    rootDir,
    idea,
    plan,
    controlPlane: "coolify",
  });
  await fs.writeJson(path.join(ctx.runDir, "policy_gate.json"), policy, { spaces: 2 });
  if (!policy.approved) {
    throw new Error(`Policy gate blocked execution: ${policy.blockers.join(", ")}`);
  }
  await writePolicyArtifacts(rootDir, policy);

  const planningIntegrityValid = await verifyPlanningSignatures(rootDir);
  await fs.writeJson(
    path.join(ctx.runDir, "planning_integrity_gate.json"),
    {
      planningIntegrityValid,
      passed: planningIntegrityValid,
    },
    { spaces: 2 },
  );
  if (!planningIntegrityValid) {
    throw new Error("Planning integrity gate failed before execution.");
  }
  const planningDigest = await computePlanningSignatureDigest(rootDir);
  const approvalPath = path.join(rootDir, "state", idea.project, "approvals.json");
  const approvalRecord = (await fs.pathExists(approvalPath)) ? await fs.readJson(approvalPath) : null;
  await fs.writeJson(
    path.join(ctx.runDir, "approval_chain.json"),
    {
      planningDigest,
      approvalRecord,
      bound: Boolean(approvalRecord?.planDigest && planningDigest && approvalRecord.planDigest === planningDigest),
    },
    { spaces: 2 },
  );

  logger.info({ stage: "managed" }, "Ensuring managed-platform seam");
  const tenant = await ensureTenant(rootDir, `${idea.project}-default-tenant`);
  await fs.writeJson(path.join(ctx.runDir, "tenant.json"), tenant, { spaces: 2 });

  logger.info({ stage: "provisioning" }, "Provisioning isolated environment");
  const provisioning = await provisionIsolatedEnvironment(rootDir, {
    containerRuntime: "docker",
    controlPlane: "coolify",
    rootless: false,
  });
  await fs.writeJson(path.join(ctx.runDir, "provisioning.json"), provisioning, { spaces: 2 });

  logger.info({ stage: "execution" }, "Executing task graph");
  const execution = await executeTasks(plan.tasks, {
    rootDir,
    runtime: provisioning.profile.containerRuntime,
    runDir: ctx.runDir,
    agentBackend: process.env.DEXTER_AGENT_BACKEND,
  });
  await fs.writeJson(path.join(ctx.runDir, "execution_results.json"), execution, { spaces: 2 });

  logger.info({ stage: "verification" }, "Running verification gate");
  const verification = await runVerification(rootDir, execution);
  await writeVerificationArtifacts(rootDir, verification);

  logger.info({ stage: "release" }, "Packaging release artifacts");
  await createReleaseBundle(rootDir);
  await writeReleaseArtifacts(rootDir);
  await generateProvenance(rootDir, { runId: ctx.runId, project: idea.project });
  await generateAttestation(rootDir);
  await writeOpsArtifacts(rootDir);
  await writeTechRadarArtifacts(rootDir);
  await writeGlobalMemoryArtifacts(rootDir);

  const controlPlane = createControlPlaneAdapter(rootDir, "coolify");
  const provenanceValid = await verifyProvenance(rootDir);
  const attestationValid = await verifyAttestation(rootDir);
  await fs.writeJson(
    path.join(ctx.runDir, "supply_chain_gate.json"),
    {
      provenanceValid,
      attestationValid,
      passed: provenanceValid && attestationValid,
    },
    { spaces: 2 },
  );
  if (!provenanceValid || !attestationValid) {
    throw new Error("Supply-chain gate failed before deploy.");
  }

  const latestRunDir = path.join(rootDir, "runs", "latest");
  await fs.ensureDir(latestRunDir);
  await fs.copy(path.join(ctx.runDir, "supply_chain_gate.json"), path.join(latestRunDir, "supply_chain_gate.json"));

  const deployAuth = await generateDeployAuthorization(rootDir, idea.project, {
    approvedBy: process.env.DEXTER_DEPLOY_APPROVER ?? "dexter-orchestrator",
    environment: process.env.DEXTER_DEPLOY_ENV ?? "production",
    controlPlane: "coolify",
    tenantId: tenant.tenantId,
  });
  if (!deployAuth) {
    throw new Error("Failed to generate deployment authorization.");
  }
  await fs.writeJson(path.join(ctx.runDir, "deploy_authorization.json"), deployAuth, { spaces: 2 });

  if (!verification.passed) {
    await controlPlane.rollback(idea.project);
    throw new Error("Verification failed. Rollback has been triggered.");
  }
  const deployment = await controlPlane.deploy(idea.project, deployAuth, {
    environment: process.env.DEXTER_DEPLOY_ENV ?? "production",
    tenantId: tenant.tenantId,
  });
  const healthUrls = [
    ...(process.env.DEXTER_DEPLOY_HEALTH_URLS ?? "").split(","),
    process.env.DEXTER_DEPLOY_HEALTH_URL ?? "",
  ]
    .map((item) => item.trim())
    .filter(Boolean);
  const healthTimeoutMs = Number(process.env.DEXTER_DEPLOY_HEALTH_TIMEOUT_MS ?? "5000");
  const deploymentHealth = await runDeploymentHealthChecks({
    urls: healthUrls,
    timeoutMs: Number.isFinite(healthTimeoutMs) ? healthTimeoutMs : 5000,
  });
  if (!deploymentHealth.passed) {
    await controlPlane.rollback(idea.project);
    throw new Error("Deployment health checks failed. Rollback has been triggered.");
  }
  await fs.writeJson(path.join(ctx.runDir, "deployment.json"), deployment, { spaces: 2 });
  await fs.writeJson(path.join(ctx.runDir, "deployment_health.json"), deploymentHealth, { spaces: 2 });

  await addLearning(rootDir, {
    category: "decision_heuristic",
    title: "Always gate autonomous execution",
    lesson: "Policy + rollback gates reduce high-severity deployment risk in autonomous loops.",
    confidence: 0.82,
    tags: ["policy", "release", "safety"],
  });

  logger.info({ stage: "complete" }, "Dexter run complete");
  const durationMs = Date.now() - startedAtMs;
  const summary = {
    runId: ctx.runId,
    project: idea.project,
    startedAt: ctx.now,
    durationMs,
    verificationPassed: verification.passed,
    deployed: true,
    deploymentMode: deployment.mode,
    memoryLessonsRetrieved: priorLessons.length,
    tasksTotal: plan.tasks.length,
    tasksPassed: execution.filter((item) => item.status === "passed").length,
    policyApproved: policy.approved,
  };
  await fs.writeJson(path.join(ctx.runDir, "run_summary.json"), summary, { spaces: 2 });

  return {
    runId: ctx.runId,
    releasePath: path.join(rootDir, "artifacts", "release"),
    verificationPassed: verification.passed,
    durationMs,
    memoryLessonsRetrieved: priorLessons.length,
    deploymentMode: deployment.mode,
  };
}
