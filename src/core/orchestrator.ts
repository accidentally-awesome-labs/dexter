import path from "node:path";
import fs from "fs-extra";
import type { IdeaInput, PlanArtifact, PolicyDecision } from "../protocols/types.js";
import { ideaInputSchema } from "../protocols/schemas.js";
import { createRunContext } from "./context.js";
import { createLogger } from "../observability/logger.js";
import { runGrillingSession } from "../skills/discovery/grilling.js";
import { synthesizeResearch } from "../skills/discovery/research.js";
import type { IntakeBrief } from "../intake/schema.js";
import {
  buildIntakeExecutionManifest,
  buildIntakeRunSummaryFields,
} from "../intake/execution-coherence.js";
import { planFromIntakeArtifacts, risksFromIntakeBrief } from "../intake/plan-from-intake.js";
import { runIntakePipelineFromIdea } from "../intake/run-intake-pipeline.js";
import type { ClarificationGateResult } from "../intake/clarification-gate.js";
import { provisionIsolatedEnvironment } from "../runtime/provisioner.js";
import { executeTasks } from "../skills/execution/task-executor.js";
import { writeEscalationReport } from "../skills/execution/escalation-report.js";
import { routeEscalations } from "../supervisor/route-escalations.js";
import { runPlannerReplanWave } from "../supervisor/auto-replan.js";
import { listEscalationLifecycle, syncEscalationLifecycle } from "../supervisor/escalation-lifecycle.js";
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
import { writeOpsStatusArtifact } from "./ops-status.js";

async function persistIntakeExecutionArtifacts(input: {
  rootDir: string;
  runDir: string;
  runId: string;
  intake: IntakeBrief;
  tasks: PlanArtifact["tasks"];
  execution: Awaited<ReturnType<typeof executeTasks>>;
  runStatus: string;
  unresolvedRequired: number;
  operatorHighEscalations: number;
}) {
  const manifest = buildIntakeExecutionManifest({
    intake: input.intake,
    runId: input.runId,
    tasks: input.tasks,
    execution: input.execution,
    runStatus: input.runStatus,
    unresolvedRequired: input.unresolvedRequired,
    operatorHighEscalations: input.operatorHighEscalations,
  });
  await fs.writeJson(path.join(input.runDir, "intake_execution_manifest.json"), manifest, { spaces: 2 });
  await fs.writeJson(
    path.join(input.rootDir, "artifacts", "intake", "INTAKE_EXECUTION_MANIFEST.json"),
    manifest,
    { spaces: 2 },
  );
  return manifest;
}

function withIntakeSummary<T extends Record<string, unknown>>(
  summary: T,
  intake: IntakeBrief,
  tasks: PlanArtifact["tasks"],
): T & { intake: ReturnType<typeof buildIntakeRunSummaryFields> } {
  return {
    ...summary,
    intake: buildIntakeRunSummaryFields(intake, tasks),
  };
}

async function writePlanningArtifacts(rootDir: string, plan: PlanArtifact) {
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

export async function runDexter(
  rootDir: string,
  rawInput: IdeaInput,
  options?: {
    replanMaxWaves?: number;
    intakeBrief?: IntakeBrief;
    skipIntakePipeline?: boolean;
  },
) {
  const startedAtMs = Date.now();
  const idea = ideaInputSchema.parse(rawInput);
  const ctx = await createRunContext(rootDir, idea);
  const logger = await createLogger(ctx);

  let intakeBrief: IntakeBrief;
  let intakeClarification: ClarificationGateResult;
  if (options?.skipIntakePipeline && options.intakeBrief) {
    intakeBrief = options.intakeBrief;
    if (
      intakeBrief.ambiguity.clarificationRequired &&
      process.env.DEXTER_SKIP_CLARIFICATION_GATE !== "true"
    ) {
      throw new Error(
        `Clarification gate blocked execution (score ${intakeBrief.ambiguity.score} >= ${intakeBrief.ambiguity.threshold}).`,
      );
    }
    intakeClarification = {
      passed: !intakeBrief.ambiguity.clarificationRequired,
      clarificationRequired: intakeBrief.ambiguity.clarificationRequired,
      bypassed: !intakeBrief.ambiguity.clarificationRequired,
      logPath: null,
      jsonPath: null,
      cycle: null,
    };
    logger.info({ stage: "intake" }, "Using existing intake artifacts");
  } else {
    logger.info({ stage: "intake" }, "Normalizing request into intake contract");
    const intake = await runIntakePipelineFromIdea(rootDir, idea, {
      skipClarificationGate: process.env.DEXTER_SKIP_CLARIFICATION_GATE === "true",
    });
    intakeBrief = intake.brief;
    intakeClarification = intake.clarification;
  }
  await fs.writeJson(path.join(ctx.runDir, "intake_gate.json"), intakeClarification, { spaces: 2 });

  logger.info({ stage: "discovery" }, "Starting discovery phase");
  const grilled = runGrillingSession(idea);
  const research = await synthesizeResearch(idea);
  const discovery = {
    ...grilled,
    marketEvidence: research.marketEvidence,
    risks: [...grilled.risks, ...research.risks, ...risksFromIntakeBrief(intakeBrief)],
  };
  await writeDiscoveryArtifacts(rootDir, discovery);

  logger.info({ stage: "memory" }, "Loading prior lessons");
  const priorLessons = await retrieveLessons(rootDir, ["runtime", "policy", "memory"], 5);
  await fs.writeFile(
    path.join(ctx.runDir, "prior_lessons.json"),
    JSON.stringify(priorLessons, null, 2),
  );

  logger.info({ stage: "planning" }, "Compiling plan artifacts from intake-aware pipeline");
  const planned = await planFromIntakeArtifacts(rootDir, discovery, intakeBrief, {
    project: idea.project,
    priorLessons: priorLessons.map((item) => item.lesson),
  });
  const plan = planned.plan;
  await writePlanningArtifacts(rootDir, plan);
  await fs.writeJson(path.join(ctx.runDir, "intake_to_plan_manifest.json"), planned.manifest, { spaces: 2 });
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
  let execution = await executeTasks(plan.tasks, {
    rootDir,
    runtime: provisioning.profile.containerRuntime,
    runDir: ctx.runDir,
    agentBackend: process.env.DEXTER_AGENT_BACKEND,
  });
  await fs.writeJson(path.join(ctx.runDir, "execution_results.json"), execution, { spaces: 2 });
  let escalationReport = await writeEscalationReport(rootDir, ctx.runDir, execution);
  await fs.writeJson(path.join(ctx.runDir, "execution_escalations_summary.json"), escalationReport, { spaces: 2 });
  let supervisorActions = await routeEscalations(rootDir);
  await fs.writeJson(path.join(ctx.runDir, "supervisor_actions_summary.json"), supervisorActions, { spaces: 2 });
  let escalationLifecycle = await syncEscalationLifecycle(rootDir, ctx.runDir, ctx.runId);
  await fs.writeJson(
    path.join(ctx.runDir, "execution_escalation_gate.json"),
    {
      runStatus: escalationLifecycle.runStatus,
      requiredEscalations: escalationLifecycle.unresolvedRequired,
      operatorHighCount: escalationLifecycle.unresolvedOperatorHigh,
      passed: escalationLifecycle.runStatus !== "blocked",
    },
    { spaces: 2 },
  );
  if (escalationLifecycle.runStatus === "blocked") {
    const durationMs = Date.now() - startedAtMs;
    const intakeManifest = await persistIntakeExecutionArtifacts({
      rootDir,
      runDir: ctx.runDir,
      runId: ctx.runId,
      intake: intakeBrief,
      tasks: plan.tasks,
      execution,
      runStatus: escalationLifecycle.runStatus,
      unresolvedRequired: escalationLifecycle.unresolvedRequired,
      operatorHighEscalations: escalationLifecycle.unresolvedOperatorHigh,
    });
    await fs.writeJson(
      path.join(ctx.runDir, "run_summary.json"),
      withIntakeSummary(
        {
          runId: ctx.runId,
          project: idea.project,
          startedAt: ctx.now,
          durationMs,
          verificationPassed: false,
          deployed: false,
          deploymentMode: "not_started",
          memoryLessonsRetrieved: priorLessons.length,
          tasksTotal: plan.tasks.length,
          tasksPassed: execution.filter((item) => item.status === "passed").length,
          policyApproved: policy.approved,
          runStatus: escalationLifecycle.runStatus,
          requiredEscalations: escalationLifecycle.unresolvedRequired,
          operatorHighEscalations: escalationLifecycle.unresolvedOperatorHigh,
          productionReady: false,
          intakeExecutionCoherent: intakeManifest.coherence.passed,
        },
        intakeBrief,
        plan.tasks,
      ),
      { spaces: 2 },
    );
    await writeOpsStatusArtifact({
      rootDir,
      runDir: ctx.runDir,
      runId: ctx.runId,
    });
    throw new Error("Execution escalation gate blocked run: required high-priority operator escalations detected.");
  }
  if (escalationLifecycle.runStatus === "degraded" && escalationLifecycle.unresolvedRequired > 0) {
    const maxReplanWaves = Math.max(
      1,
      Number(
        options?.replanMaxWaves ??
          (process.env.DEXTER_REPLAN_MAX_WAVES ? Number(process.env.DEXTER_REPLAN_MAX_WAVES) : 3),
      ),
    );
    const replanWaves: Array<{
      wave: number;
      attempted: boolean;
      stalled: boolean;
      stalledReason?: string;
      runStatusAfterWave: string;
      unresolvedAfterWave: number;
      plannerEscalationKeys: string[];
    }> = [];
    let previousPlannerSignature: string | undefined;
    for (let wave = 1; wave <= maxReplanWaves; wave += 1) {
      const replan = await runPlannerReplanWave({
        rootDir,
        runDir: ctx.runDir,
        runtime: provisioning.profile.containerRuntime,
        agentBackend: process.env.DEXTER_AGENT_BACKEND,
        tasks: plan.tasks,
        currentExecution: execution,
        wave,
        previousPlannerSignature,
      });
      previousPlannerSignature = replan.plannerSignature ?? previousPlannerSignature;
      if (replan.attempted) {
        execution = replan.mergedExecution;
        await fs.writeJson(path.join(ctx.runDir, "execution_results.json"), execution, { spaces: 2 });
      }
      escalationReport = await writeEscalationReport(rootDir, ctx.runDir, execution);
      await fs.writeJson(path.join(ctx.runDir, "execution_escalations_summary.json"), escalationReport, { spaces: 2 });
      supervisorActions = await routeEscalations(rootDir);
      await fs.writeJson(path.join(ctx.runDir, "supervisor_actions_summary.json"), supervisorActions, { spaces: 2 });
      escalationLifecycle = await syncEscalationLifecycle(rootDir, ctx.runDir, ctx.runId);
      await fs.writeJson(
        path.join(ctx.runDir, "execution_escalation_gate.json"),
        {
          runStatus: escalationLifecycle.runStatus,
          requiredEscalations: escalationLifecycle.unresolvedRequired,
          operatorHighCount: escalationLifecycle.unresolvedOperatorHigh,
          passed: escalationLifecycle.runStatus !== "blocked",
          replanAttempted: true,
          replanWave: wave,
        },
        { spaces: 2 },
      );
      replanWaves.push({
        wave,
        attempted: replan.attempted,
        stalled: replan.stalled,
        stalledReason: replan.stallReason,
        runStatusAfterWave: escalationLifecycle.runStatus,
        unresolvedAfterWave: escalationLifecycle.unresolvedRequired,
        plannerEscalationKeys: replan.plannerEscalationKeys,
      });
      await fs.writeJson(path.join(ctx.runDir, `replan_wave_${wave}_summary.json`), replan, { spaces: 2 });

      if (escalationLifecycle.runStatus === "blocked") {
        const durationMs = Date.now() - startedAtMs;
        const intakeManifest = await persistIntakeExecutionArtifacts({
          rootDir,
          runDir: ctx.runDir,
          runId: ctx.runId,
          intake: intakeBrief,
          tasks: plan.tasks,
          execution,
          runStatus: escalationLifecycle.runStatus,
          unresolvedRequired: escalationLifecycle.unresolvedRequired,
          operatorHighEscalations: escalationLifecycle.unresolvedOperatorHigh,
        });
        await fs.writeJson(
          path.join(ctx.runDir, "run_summary.json"),
          withIntakeSummary(
            {
              runId: ctx.runId,
              project: idea.project,
              startedAt: ctx.now,
              durationMs,
              verificationPassed: false,
              deployed: false,
              deploymentMode: "not_started",
              memoryLessonsRetrieved: priorLessons.length,
              tasksTotal: plan.tasks.length,
              tasksPassed: execution.filter((item) => item.status === "passed").length,
              policyApproved: policy.approved,
              runStatus: escalationLifecycle.runStatus,
              requiredEscalations: escalationLifecycle.unresolvedRequired,
              operatorHighEscalations: escalationLifecycle.unresolvedOperatorHigh,
              productionReady: false,
              replanAttempted: true,
              replanWaves: replanWaves.length,
              intakeExecutionCoherent: intakeManifest.coherence.passed,
            },
            intakeBrief,
            plan.tasks,
          ),
          { spaces: 2 },
        );
        await fs.writeJson(
          path.join(ctx.runDir, "replan_waves_summary.json"),
          { maxWaves: maxReplanWaves, waves: replanWaves, stoppedReason: "blocked" },
          { spaces: 2 },
        );
        await writeOpsStatusArtifact({
          rootDir,
          runDir: ctx.runDir,
          runId: ctx.runId,
        });
        throw new Error("Execution escalation gate blocked run after auto-replan wave.");
      }
      if (escalationLifecycle.runStatus === "healthy" || escalationLifecycle.unresolvedRequired === 0) {
        break;
      }
      if (replan.stalled || !replan.attempted) {
        break;
      }
    }
    await fs.writeJson(
      path.join(ctx.runDir, "replan_waves_summary.json"),
      {
        maxWaves: maxReplanWaves,
        waves: replanWaves,
        stoppedReason:
          escalationLifecycle.runStatus === "healthy"
            ? "healthy"
            : replanWaves.some((wave) => wave.stalled)
              ? "stalled"
              : replanWaves.length >= maxReplanWaves
                ? "max_waves"
                : "no_planner_actions",
      },
      { spaces: 2 },
    );
  }

  const intakeManifest = await persistIntakeExecutionArtifacts({
    rootDir,
    runDir: ctx.runDir,
    runId: ctx.runId,
    intake: intakeBrief,
    tasks: plan.tasks,
    execution,
    runStatus: escalationLifecycle.runStatus,
    unresolvedRequired: escalationLifecycle.unresolvedRequired,
    operatorHighEscalations: escalationLifecycle.unresolvedOperatorHigh,
  });
  await fs.writeJson(path.join(ctx.runDir, "intake_execution_coherence.json"), intakeManifest.coherence, {
    spaces: 2,
  });

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
  const summary = withIntakeSummary(
    {
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
      runStatus: escalationLifecycle.runStatus,
      requiredEscalations: escalationLifecycle.unresolvedRequired,
      operatorHighEscalations: escalationLifecycle.unresolvedOperatorHigh,
      productionReady: verification.passed && escalationLifecycle.unresolvedRequired === 0,
      intakeExecutionCoherent: intakeManifest.coherence.passed,
    },
    intakeBrief,
    plan.tasks,
  );
  await fs.writeJson(path.join(ctx.runDir, "run_summary.json"), summary, { spaces: 2 });
  await writeOpsStatusArtifact({
    rootDir,
    runDir: ctx.runDir,
    runId: ctx.runId,
  });

  return {
    runId: ctx.runId,
    releasePath: path.join(rootDir, "artifacts", "release"),
    verificationPassed: verification.passed,
    durationMs,
    memoryLessonsRetrieved: priorLessons.length,
    deploymentMode: deployment.mode,
    runStatus: escalationLifecycle.runStatus,
    productionReady: verification.passed && escalationLifecycle.unresolvedRequired === 0,
  };
}

export async function resumeDexterRun(rootDir: string, runId: string) {
  const resumedAtMs = Date.now();
  const runDir = path.join(rootDir, "runs", runId);
  const contextPath = path.join(runDir, "context.json");
  const executionPath = path.join(runDir, "execution_results.json");
  const policyPath = path.join(runDir, "policy_gate.json");
  const tenantPath = path.join(runDir, "tenant.json");
  if (!(await fs.pathExists(contextPath)) || !(await fs.pathExists(executionPath))) {
    throw new Error(`Resume failed: missing run artifacts for ${runId}`);
  }

  const context = await fs.readJson(contextPath);
  const idea = context.idea as IdeaInput;
  const execution = (await fs.readJson(executionPath)) as Awaited<ReturnType<typeof executeTasks>>;
  const policy = (await fs.pathExists(policyPath))
    ? ((await fs.readJson(policyPath)) as PolicyDecision)
    : { approved: true, blockers: [], requiredRollbackChecks: [] };
  const tenant = (await fs.pathExists(tenantPath))
    ? await fs.readJson(tenantPath)
    : { tenantId: `${idea.project}-default-tenant` };

  const escalationReport = await writeEscalationReport(rootDir, runDir, execution);
  await fs.writeJson(path.join(runDir, "execution_escalations_summary.json"), escalationReport, { spaces: 2 });
  const supervisorActions = await routeEscalations(rootDir);
  await fs.writeJson(path.join(runDir, "supervisor_actions_summary.json"), supervisorActions, { spaces: 2 });
  const lifecycle = await syncEscalationLifecycle(rootDir, runDir, runId);
  const unresolved = await listEscalationLifecycle({
    rootDir,
    unresolvedOnly: true,
  });
  const unresolvedKeys = unresolved.items.map((item) => item.key);
  await fs.writeJson(
    path.join(runDir, "execution_escalation_gate.json"),
    {
      runStatus: lifecycle.runStatus,
      requiredEscalations: lifecycle.unresolvedRequired,
      operatorHighCount: lifecycle.unresolvedOperatorHigh,
      passed: lifecycle.runStatus !== "blocked",
      resumed: true,
    },
    { spaces: 2 },
  );
  await writeOpsStatusArtifact({
    rootDir,
    runDir,
    runId,
  });

  if (lifecycle.runStatus === "blocked") {
    throw new Error(
      `Resume blocked: unresolved high-priority operator escalations remain. Keys: ${unresolvedKeys.join(", ") || "none"}`,
    );
  }
  if (lifecycle.unresolvedRequired > 0) {
    throw new Error(
      `Resume blocked: unresolved required escalations remain (degraded). Keys: ${unresolvedKeys.join(", ") || "none"}`,
    );
  }

  const verification = await runVerification(rootDir, execution);
  await writeVerificationArtifacts(rootDir, verification);
  if (!verification.passed) {
    throw new Error("Resume failed: verification did not pass.");
  }

  await createReleaseBundle(rootDir);
  await writeReleaseArtifacts(rootDir);
  await generateProvenance(rootDir, { runId, project: idea.project });
  await generateAttestation(rootDir);
  await writeOpsArtifacts(rootDir);
  await writeTechRadarArtifacts(rootDir);
  await writeGlobalMemoryArtifacts(rootDir);

  const controlPlane = createControlPlaneAdapter(rootDir, "coolify");
  const deployAuth = await generateDeployAuthorization(rootDir, idea.project, {
    approvedBy: process.env.DEXTER_DEPLOY_APPROVER ?? "dexter-resume",
    environment: process.env.DEXTER_DEPLOY_ENV ?? "production",
    controlPlane: "coolify",
    tenantId: tenant.tenantId,
  });
  if (!deployAuth) {
    throw new Error("Resume failed: could not generate deploy authorization.");
  }
  await fs.writeJson(path.join(runDir, "deploy_authorization.json"), deployAuth, { spaces: 2 });
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
    throw new Error("Resume deployment health checks failed. Rollback triggered.");
  }
  await fs.writeJson(path.join(runDir, "deployment.json"), deployment, { spaces: 2 });
  await fs.writeJson(path.join(runDir, "deployment_health.json"), deploymentHealth, { spaces: 2 });

  const durationMs = Date.now() - resumedAtMs;
  const summary = {
    runId,
    project: idea.project,
    resumed: true,
    resumedAt: new Date().toISOString(),
    durationMs,
    verificationPassed: verification.passed,
    deployed: true,
    deploymentMode: deployment.mode,
    tasksTotal: execution.length,
    tasksPassed: execution.filter((item) => item.status === "passed").length,
    policyApproved: policy.approved,
    runStatus: lifecycle.runStatus,
    requiredEscalations: lifecycle.unresolvedRequired,
    operatorHighEscalations: lifecycle.unresolvedOperatorHigh,
    productionReady: true,
  };
  await fs.writeJson(path.join(runDir, "run_summary.json"), summary, { spaces: 2 });
  await writeOpsStatusArtifact({
    rootDir,
    runDir,
    runId,
  });
  return {
    runId,
    resumed: true,
    releasePath: path.join(rootDir, "artifacts", "release"),
    verificationPassed: verification.passed,
    deploymentMode: deployment.mode,
    runStatus: lifecycle.runStatus,
    productionReady: true,
  };
}
