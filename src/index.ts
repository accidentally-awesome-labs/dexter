import path from "node:path";
import fs from "fs-extra";
import dotenv from "dotenv";
import { runDexter, resumeDexterRun } from "./core/orchestrator.js";
import { buildResumeCheck, findLatestBlockedRunId, findLatestDegradedRunId, findLatestRunId } from "./core/run-selector.js";
import { writeOpsStatusArtifact } from "./core/ops-status.js";
import { evaluateReadiness } from "./release/readiness.js";
import { createControlPlaneAdapter } from "./runtime/control-plane.js";
import { buildMetricsReport } from "./metrics/aggregator.js";
import { verifyAttestation } from "./release/attestation.js";
import { verifyProvenance } from "./release/provenance.js";
import { generateDeployAuthorization } from "./deploy/authorization.js";
import { revokeDeployAuthorizationNonce } from "./deploy/authorization.js";
import { runDeploymentHealthChecks } from "./runtime/deployment-health.js";
import { routeEscalations } from "./supervisor/route-escalations.js";
import { listEscalationLifecycle, updateEscalationLifecycleStatus } from "./supervisor/escalation-lifecycle.js";
import { resolveEscalationsWorkflow } from "./supervisor/escalation-workflow.js";
import { appendAuditLogEvent } from "./operations/audit-log.js";
import { assertPromotionAllowed } from "./operations/promotion-gate.js";
import {
  evaluateCanaryGate,
  resolveCanaryMetrics,
  writeCanaryGateArtifact,
} from "./operations/canary-gate.js";
import {
  evaluateSloRollbackTriggers,
  executePromotionRollback,
  loadSloThresholds,
  simulatedBreachMetrics,
  writeSloRollbackArtifact,
  type SloBreachKind,
  type SloRollbackExecution,
} from "./operations/slo-rollback.js";
import { runPromotionPipeline } from "./operations/run-promotion-pipeline.js";
import { verifyGovernance } from "./operations/governance-verify.js";
import { verifyPromotionRepeatability } from "./operations/promotion-repeatability.js";
import { writeOperatorWorkflowReadiness } from "./operations/operator-workflow-readiness.js";
import { generateMilestone1Signoff } from "./operations/milestone-signoff.js";

dotenv.config();

function parseArg(flag: string, fallback = ""): string {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? (process.argv[idx + 1] ?? fallback) : fallback;
}

function parseBoolArg(flag: string, fallback = false): boolean {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) {
    return fallback;
  }
  const raw = process.argv[idx + 1];
  if (!raw) {
    return true;
  }
  return !["0", "false", "no", "off"].includes(raw.toLowerCase());
}

function parseListArg(flag: string, fallback: string[]): string[] {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) {
    return fallback;
  }
  const raw = process.argv[idx + 1] ?? "";
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, idx) =>
    Math.max(header.length, ...rows.map((row) => (row[idx] ?? "").length)),
  );
  const renderRow = (cols: string[]) => cols.map((col, idx) => col.padEnd(widths[idx]!)).join(" | ");
  const divider = widths.map((width) => "-".repeat(width)).join("-|-");
  return [renderRow(headers), divider, ...rows.map((row) => renderRow(row))].join("\n");
}

function printOutput(result: unknown, output: "json" | "table", tableRenderer: () => string): void {
  if (output === "table") {
    console.log(tableRenderer());
    return;
  }
  console.log(JSON.stringify(result, null, 2));
}

async function verifyProject(rootDir: string) {
  const checks = await evaluateReadiness(rootDir);

  const failed = checks.filter((check) => !check.present);
  if (failed.length > 0) {
    throw new Error(`Verification failed. Missing: ${failed.map((item) => item.path).join(", ")}`);
  }

  const attestationValid = await verifyAttestation(rootDir);
  if (!attestationValid) {
    throw new Error("Verification failed. Release artifact attestation is invalid.");
  }

  console.log("Dexter verification passed.");
}

async function verifyAttestationOnly(rootDir: string) {
  const valid = await verifyAttestation(rootDir);
  if (!valid) {
    throw new Error("Attestation verification failed.");
  }
  console.log("Attestation verification passed.");
}

async function verifyProvenanceOnly(rootDir: string) {
  const valid = await verifyProvenance(rootDir);
  if (!valid) {
    throw new Error("Provenance verification failed.");
  }
  console.log("Provenance verification passed.");
}

async function main() {
  const command = process.argv[2] ?? "run";
  const rootDir = process.cwd();

  if (command === "run") {
    const project = parseArg("--project", "dexter-sample");
    const idea = parseArg("--idea", "Build a production-ready autonomous coding factory.");
    const constraintsRaw = parseArg("--constraints", "Self-hosted first, managed later");
    const constraints = constraintsRaw.split(",").map((item) => item.trim());
    const replanMaxWavesRaw = parseArg("--replan-max-waves", "");
    let replanMaxWaves: number | undefined;
    if (replanMaxWavesRaw) {
      const parsed = Number(replanMaxWavesRaw);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("Invalid --replan-max-waves. Must be a positive number.");
      }
      replanMaxWaves = parsed;
    }
    const result = await runDexter(rootDir, {
      project,
      idea,
      constraints,
      targetUsers: ["engineering-teams", "founders"],
    }, {
      replanMaxWaves,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "run-resume") {
    const latestBlocked = parseBoolArg("--latest-blocked", false);
    const latestDegraded = parseBoolArg("--latest-degraded", false);
    if (latestBlocked && latestDegraded) {
      throw new Error("Use only one of --latest-blocked or --latest-degraded.");
    }
    const runId = latestBlocked
      ? await findLatestBlockedRunId(rootDir)
      : latestDegraded
        ? await findLatestDegradedRunId(rootDir)
        : parseArg("--run-id");
    if (!runId) {
      throw new Error(latestBlocked ? "No blocked run found." : latestDegraded ? "No degraded run found." : "Missing --run-id");
    }
    const result = await resumeDexterRun(rootDir, runId);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "resume-check") {
    const latest = parseBoolArg("--latest", false);
    const latestBlocked = parseBoolArg("--latest-blocked", false);
    const latestDegraded = parseBoolArg("--latest-degraded", false);
    const modeCount = [latest, latestBlocked, latestDegraded].filter(Boolean).length;
    if (modeCount > 1) {
      throw new Error("Use only one of --latest, --latest-blocked, or --latest-degraded.");
    }
    const runId = latestBlocked
      ? await findLatestBlockedRunId(rootDir)
      : latestDegraded
        ? await findLatestDegradedRunId(rootDir)
        : latest
          ? await findLatestRunId(rootDir)
          : parseArg("--run-id");
    if (!runId) {
      throw new Error(
        latestBlocked
          ? "No blocked run found."
          : latestDegraded
            ? "No degraded run found."
            : latest
              ? "No run found."
              : "Missing --run-id",
      );
    }
    const result = await buildResumeCheck(rootDir, runId);
    const output = (parseArg("--output", "json") as "json" | "table");
    if (!["json", "table"].includes(output)) {
      throw new Error("Invalid --output. Use json|table");
    }
    printOutput(result, output, () =>
      [
        formatTable(
          ["runId", "runStatus", "resumeAllowed", "unresolvedCount"],
          [[result.runId, result.runStatus, String(result.resumeAllowed), String(result.unresolvedEscalations.length)]],
        ),
        "",
        "Reasons:",
        ...(result.reasons.length === 0 ? ["- none"] : result.reasons.map((reason) => `- ${reason}`)),
        "",
        "Unresolved Escalations:",
        ...(result.unresolvedEscalations.length === 0
          ? ["- none"]
          : result.unresolvedEscalations.map(
              (item) => `- ${item.key} (${item.target}/${item.status}/${item.reason})`,
            )),
        "",
        "Suggested Commands:",
        ...result.suggestedCommands.map((cmd) => `- ${cmd}`),
      ].join("\n"),
    );
    return;
  }

  if (command === "ops-status") {
    const latest = parseBoolArg("--latest", false);
    const latestBlocked = parseBoolArg("--latest-blocked", false);
    const latestDegraded = parseBoolArg("--latest-degraded", false);
    const modeCount = [latest, latestBlocked, latestDegraded].filter(Boolean).length;
    if (modeCount > 1) {
      throw new Error("Use only one of --latest, --latest-blocked, or --latest-degraded.");
    }
    const runId = latestBlocked
      ? await findLatestBlockedRunId(rootDir)
      : latestDegraded
        ? await findLatestDegradedRunId(rootDir)
        : latest
          ? await findLatestRunId(rootDir)
          : parseArg("--run-id");
    if (!runId) {
      throw new Error(
        latestBlocked
          ? "No blocked run found."
          : latestDegraded
            ? "No degraded run found."
            : latest
              ? "No runs found."
              : "Missing --run-id",
      );
    }
    const runDir = path.join(rootDir, "runs", runId);
    const result = await writeOpsStatusArtifact({
      rootDir,
      runDir,
      runId,
    });
    const dashboard = await fs.readJson(result.jsonPath);
    const output = (parseArg("--output", "json") as "json" | "table");
    if (!["json", "table"].includes(output)) {
      throw new Error("Invalid --output. Use json|table");
    }
    printOutput(
      {
        ...dashboard,
        jsonPath: result.jsonPath,
        markdownPath: result.markdownPath,
      },
      output,
      () =>
        [
          formatTable(
            ["runId", "runStatus", "productionReady", "resumeAllowed", "unresolved"],
            [[
              String(dashboard.runId),
              String(dashboard.runStatus),
              String(dashboard.productionReady),
              String(dashboard.resume?.allowed ?? false),
              String(dashboard.unresolved?.count ?? 0),
            ]],
          ),
          "",
          "Next Commands:",
          ...((dashboard.nextCommands as string[] | undefined)?.map((cmd) => `- ${cmd}`) ?? ["- none"]),
          "",
          `jsonPath: ${result.jsonPath}`,
          `markdownPath: ${result.markdownPath}`,
        ].join("\n"),
    );
    return;
  }

  if (command === "verify") {
    await verifyProject(rootDir);
    return;
  }

  if (command === "attest-verify") {
    await verifyAttestationOnly(rootDir);
    return;
  }

  if (command === "provenance-verify") {
    await verifyProvenanceOnly(rootDir);
    return;
  }

  if (command === "readiness-report") {
    const checks = await evaluateReadiness(rootDir);
    const reportPath = path.join(rootDir, "artifacts", "release", "readiness_report.json");
    await fs.ensureDir(path.dirname(reportPath));
    await fs.writeJson(reportPath, checks, { spaces: 2 });
    console.log(JSON.stringify({ reportPath, passed: checks.every((c) => c.present) }, null, 2));
    return;
  }

  if (command === "deploy-self") {
    const controlPlane = (parseArg("--control-plane", "coolify") as "coolify" | "dokploy" | "dokku");
    const appName = parseArg("--app", "dexter");
    const environment = parseArg("--environment", process.env.DEXTER_DEPLOY_ENV ?? "production");
    const sourceEnvironment = parseArg("--source-environment", process.env.DEXTER_DEPLOY_SOURCE_ENV ?? "");
    const approverRole = parseArg("--approver-role", process.env.DEXTER_DEPLOY_APPROVER_ROLE ?? "");
    const approvedBy = process.env.DEXTER_DEPLOY_APPROVER ?? "deploy-self";
    const tenantId = parseArg("--tenant", process.env.DEXTER_DEPLOY_TENANT ?? "default-tenant");
    const rollbackDrill = parseBoolArg("--rollback-drill", false);
    const requireRealMode = parseBoolArg("--require-real", true);
    const requireApiMode = parseBoolArg("--require-api", false);
    const healthUrls = parseListArg("--health-url", [])
      .concat((process.env.DEXTER_DEPLOY_HEALTH_URLS ?? "").split(","))
      .concat(process.env.DEXTER_DEPLOY_HEALTH_URL ?? "")
      .map((item) => item.trim())
      .filter(Boolean);
    const healthTimeoutMs = Number(parseArg("--health-timeout-ms", process.env.DEXTER_DEPLOY_HEALTH_TIMEOUT_MS ?? "5000"));
    const canaryMetricsSnapshot = parseArg("--canary-metrics", process.env.DEXTER_CANARY_METRICS_SNAPSHOT ?? "");
    const simulateSloBreach = parseArg("--simulate-slo-breach", process.env.DEXTER_SIMULATE_SLO_BREACH ?? "") as
      | SloBreachKind
      | "";
    const promotion = await assertPromotionAllowed({
      rootDir,
      targetEnvironment: environment,
      sourceEnvironment: sourceEnvironment || undefined,
      controlPlane,
      approvedBy,
      approverRole: approverRole || undefined,
      tenantId,
    });

    const adapter = createControlPlaneAdapter(rootDir, controlPlane);
    const auth = await generateDeployAuthorization(rootDir, appName, {
      approvedBy,
      environment: promotion.targetEnvironment,
      sourceEnvironment: promotion.sourceEnvironment,
      controlPlane,
      tenantId,
    });
    if (!auth) {
      throw new Error("Unable to generate deployment authorization. Ensure planning and supply-chain artifacts exist.");
    }
    const result = await adapter.deploy(appName, auth, {
      environment: promotion.targetEnvironment,
      tenantId,
    });
    await appendAuditLogEvent(rootDir, {
      actor: auth.approvedBy,
      action: "promotion_deploy",
      scope: promotion.targetEnvironment,
      reason: `control-plane:${controlPlane}`,
      metadata: {
        appName,
        sourceEnvironment: promotion.sourceEnvironment,
        approverRole: promotion.approverRole,
        deploymentMode: result.mode,
        deploymentId: result.deploymentId,
      },
    });
    if (requireRealMode && result.mode === "simulated") {
      throw new Error("Deploy-self blocked: simulated deployment mode is not allowed when --require-real is enabled.");
    }
    if (requireApiMode && result.mode !== "api") {
      throw new Error("Deploy-self blocked: deployment mode is not API while --require-api is enabled.");
    }

    const healthValidation = await runDeploymentHealthChecks({
      urls: healthUrls,
      timeoutMs: Number.isFinite(healthTimeoutMs) ? healthTimeoutMs : 5000,
    });

    let canaryGate: {
      jsonPath: string;
      markdownPath: string;
      passed: boolean;
      prodPromotionAllowed: boolean;
      burnState: "healthy" | "warn" | "breach";
    } | null = null;

    if (promotion.targetEnvironment === "canary") {
      const metrics = await resolveCanaryMetrics({
        rootDir,
        healthValidation,
        snapshotPath: canaryMetricsSnapshot || undefined,
      });
      const gateResult = await evaluateCanaryGate(rootDir, metrics, healthValidation);
      const artifact = await writeCanaryGateArtifact(rootDir, gateResult);
      canaryGate = {
        jsonPath: artifact.jsonPath,
        markdownPath: artifact.markdownPath,
        passed: gateResult.passed,
        prodPromotionAllowed: gateResult.prodPromotionAllowed,
        burnState: gateResult.burnState,
      };
      await appendAuditLogEvent(rootDir, {
        actor: auth.approvedBy,
        action: "canary_gate_evaluated",
        scope: "canary",
        reason: gateResult.passed ? "canary_gate_passed" : "canary_gate_failed",
        metadata: {
          appName,
          burnState: gateResult.burnState,
          prodPromotionAllowed: gateResult.prodPromotionAllowed,
          checks: gateResult.checks,
        },
      });
    }

    const sloPolicy = await loadSloThresholds(rootDir);
    let sloMetrics = await resolveCanaryMetrics({
      rootDir,
      healthValidation,
      snapshotPath: canaryMetricsSnapshot || undefined,
    });
    if (simulateSloBreach === "error-rate" || simulateSloBreach === "latency" || simulateSloBreach === "burn") {
      sloMetrics = simulatedBreachMetrics(simulateSloBreach);
    }
    const sloEvaluation = evaluateSloRollbackTriggers(sloMetrics, sloPolicy, healthValidation);
    const canaryGateFailed = canaryGate !== null && !canaryGate.passed;

    let sloRollback: SloRollbackExecution | { triggered: false } = { triggered: false };
    let sloRollbackArtifact: { jsonPath: string; markdownPath: string } | null = null;

    if (sloEvaluation.triggered || canaryGateFailed) {
      const reason = canaryGateFailed
        ? "canary_gate_failed"
        : sloEvaluation.triggers[0]?.trigger ?? "slo_breach";
      sloRollback = await executePromotionRollback({
        rootDir,
        adapter,
        appName,
        environment: promotion.targetEnvironment,
        actor: auth.approvedBy,
        reason,
        triggers: sloEvaluation.triggers,
        requireApiMode: requireApiMode,
      });
      sloRollbackArtifact = await writeSloRollbackArtifact(rootDir, {
        generatedAt: new Date().toISOString(),
        environment: promotion.targetEnvironment,
        appName,
        execution: sloRollback,
        evaluation: sloEvaluation,
      });
    }

    let rollbackValidation:
      | {
          enabled: true;
          rollbackId: string;
          rollbackMode: "api" | "hook" | "simulated";
          redeployId: string;
          redeployMode: "api" | "hook" | "simulated";
          passed: boolean;
        }
      | { enabled: false } = { enabled: false };

    if (rollbackDrill) {
      const rollbackResult = await adapter.rollback(appName);
      await appendAuditLogEvent(rootDir, {
        actor: auth.approvedBy,
        action: "promotion_rollback",
        scope: promotion.targetEnvironment,
        reason: "rollback_drill",
        metadata: {
          appName,
          rollbackMode: rollbackResult.mode,
          rollbackId: rollbackResult.rollbackId,
        },
      });
      const redeployAuth = await generateDeployAuthorization(rootDir, appName, {
        approvedBy: process.env.DEXTER_DEPLOY_APPROVER ?? "deploy-self-rollback-drill",
        environment: promotion.targetEnvironment,
        sourceEnvironment: promotion.sourceEnvironment,
        controlPlane,
        tenantId,
      });
      if (!redeployAuth) {
        throw new Error("Rollback drill failed: unable to generate redeploy authorization.");
      }
      const redeployResult = await adapter.deploy(appName, redeployAuth, {
        environment: promotion.targetEnvironment,
        tenantId,
      });
      await appendAuditLogEvent(rootDir, {
        actor: redeployAuth.approvedBy,
        action: "promotion_deploy",
        scope: promotion.targetEnvironment,
        reason: "rollback_drill_redeploy",
        metadata: {
          appName,
          deploymentMode: redeployResult.mode,
          deploymentId: redeployResult.deploymentId,
        },
      });

      const passed = rollbackResult.status === "ok" && redeployResult.status === "ok";
      if (requireRealMode && (rollbackResult.mode === "simulated" || redeployResult.mode === "simulated")) {
        throw new Error("Rollback drill blocked: simulated rollback or redeploy mode is not allowed.");
      }
      if (requireApiMode && (rollbackResult.mode !== "api" || redeployResult.mode !== "api")) {
        throw new Error("Rollback drill blocked: rollback or redeploy mode is not API while --require-api is enabled.");
      }

      rollbackValidation = {
        enabled: true,
        rollbackId: rollbackResult.rollbackId,
        rollbackMode: rollbackResult.mode,
        redeployId: redeployResult.deploymentId,
        redeployMode: redeployResult.mode,
        passed,
      };
    }

    const outputPath = path.join(rootDir, "artifacts", "release", "self_deploy_result.json");
    await fs.ensureDir(path.dirname(outputPath));
    await fs.writeJson(
      outputPath,
      {
        controlPlane,
        appName,
        environment: promotion.targetEnvironment,
        sourceEnvironment: promotion.sourceEnvironment,
        requireRealMode,
        requireApiMode,
        rollbackDrill,
        healthValidation,
        canaryGate: canaryGate ?? { enabled: false },
        sloEvaluation,
        sloRollback,
        sloRollbackArtifact,
        authorization: auth,
        ...result,
        rollbackValidation,
      },
      { spaces: 2 },
    );
    console.log(
      JSON.stringify(
        {
          outputPath,
          deploymentMode: result.mode,
          deploymentId: result.deploymentId,
          environment: promotion.targetEnvironment,
          healthValidation,
          canaryGate: canaryGate ?? { enabled: false },
          sloEvaluation: {
            triggered: sloEvaluation.triggered,
            triggers: sloEvaluation.triggers,
          },
          sloRollback,
          sloRollbackArtifact,
          rollbackValidation,
        },
        null,
        2,
      ),
    );
    if (sloRollback.triggered) {
      const triggerNames = sloEvaluation.triggers.map((item) => item.trigger).join(", ");
      throw new Error(`SLO rollback triggered (${triggerNames}). Rollback captured in release artifacts.`);
    }
    return;
  }

  if (command === "milestone-signoff") {
    const milestone = parseArg("--milestone", "1");
    if (milestone !== "1") {
      throw new Error("Only milestone 1 signoff is implemented.");
    }
    const report = await generateMilestone1Signoff(rootDir);
    if (!report.passed) {
      const failed = report.gates.filter((gate) => !gate.passed).map((gate) => gate.id);
      throw new Error(`Milestone 1 signoff failed: ${failed.join(", ")}`);
    }
    console.log(
      JSON.stringify(
        {
          passed: report.passed,
          milestone: report.milestone,
          gates: report.gates.length,
          reportPath: path.join(rootDir, "artifacts", "release", "MILESTONE_1_SIGNOFF.json"),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === "operator-readiness") {
    const readiness = await writeOperatorWorkflowReadiness(rootDir);
    if (!readiness.ready) {
      throw new Error("Operator workflow is not ready.");
    }
    console.log(
      JSON.stringify(
        {
          ready: readiness.ready,
          reportPath: path.join(rootDir, "artifacts", "release", "OPERATOR_WORKFLOW_READINESS.json"),
          promotionCount: readiness.promotionCount,
          resumeAllowed: readiness.resumeAllowed,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === "promotion-repeatability") {
    const minimumPromotions = Number(parseArg("--minimum-promotions", "3"));
    const report = await verifyPromotionRepeatability(
      rootDir,
      Number.isFinite(minimumPromotions) ? minimumPromotions : 3,
    );
    if (!report.passed) {
      throw new Error("Promotion repeatability verification failed.");
    }
    console.log(
      JSON.stringify(
        {
          passed: report.passed,
          promotionCount: report.promotionCount,
          reportPath: path.join(rootDir, "artifacts", "release", "PROMOTION_REPEATABILITY.json"),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === "governance-verify") {
    const minimumPromotions = Number(parseArg("--minimum-promotions", "1"));
    const report = await verifyGovernance({
      rootDir,
      minimumPromotions: Number.isFinite(minimumPromotions) ? minimumPromotions : 1,
    });
    if (!report.passed) {
      throw new Error("Governance verification failed.");
    }
    console.log(
      JSON.stringify(
        {
          passed: report.passed,
          reportPath: path.join(rootDir, "artifacts", "release", "GOVERNANCE_VERIFICATION.json"),
          checks: report.checks.length,
          failedChecks: report.checks.filter((check) => !check.passed).map((check) => check.name),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === "promotion-pipeline") {
    const appName = parseArg("--app", "dexter");
    const controlPlane = (parseArg("--control-plane", "coolify") as "coolify" | "dokploy" | "dokku");
    const targetService = parseArg("--target-service", appName);
    const promotionId = parseArg("--promotion-id", "");
    const minimumPromotions = Number(parseArg("--minimum-promotions", "1"));
    const requireApi = parseBoolArg("--require-api", true);
    const healthUrl =
      parseArg("--health-url", process.env.DEXTER_DEPLOY_HEALTH_URL ?? "") ||
      (process.env.DEXTER_DEPLOY_HEALTH_URLS ?? "").split(",").map((item) => item.trim()).find(Boolean) ||
      "";
    const manifest = await runPromotionPipeline({
      rootDir,
      appName,
      controlPlane,
      targetService,
      promotionId: promotionId || undefined,
      requireApi,
      healthUrl: healthUrl || undefined,
      minimumPromotionsForGovernance: Number.isFinite(minimumPromotions) ? minimumPromotions : 1,
    });
    console.log(
      JSON.stringify(
        {
          passed: manifest.passed,
          promotionId: manifest.promotionId,
          manifestPath: path.join(rootDir, "artifacts", "release", "PROMOTION_PIPELINE_MANIFEST.json"),
          stages: manifest.stages.map((stage) => ({
            environment: stage.environment,
            exitCode: stage.exitCode,
            deploymentId: stage.deploymentId,
          })),
          auditEventsDelta: manifest.audit.eventsDelta,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === "dogfood-metrics") {
    const result = await buildMetricsReport(rootDir);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "deploy-auth-revoke") {
    const nonce = parseArg("--nonce");
    if (!nonce) {
      throw new Error("Missing --nonce");
    }
    const reason = parseArg("--reason", "manual-revocation");
    const ttlMinutes = Number(parseArg("--ttl-minutes", "60"));
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
    await revokeDeployAuthorizationNonce(rootDir, nonce, reason, expiresAt);
    console.log(JSON.stringify({ nonce, reason, expiresAt }, null, 2));
    return;
  }

  if (command === "supervisor-route") {
    const result = await routeEscalations(rootDir);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "escalation-update") {
    const key = parseArg("--key");
    const status = parseArg("--status") as "open" | "in_progress" | "resolved" | "waived";
    const note = parseArg("--note");
    const waiverApprovedBy = parseArg("--waiver-approved-by");
    const waiverReason = parseArg("--waiver-reason");
    const waiverExpiresAt = parseArg("--waiver-expires-at");
    const waiverScope = parseArg("--waiver-scope");
    const runId = parseArg("--run-id");
    if (!key) {
      throw new Error("Missing --key");
    }
    if (!["open", "in_progress", "resolved", "waived"].includes(status)) {
      throw new Error("Invalid --status. Use open|in_progress|resolved|waived");
    }
    const result = await updateEscalationLifecycleStatus({
      rootDir,
      key,
      status,
      note: note || undefined,
      actor: waiverApprovedBy || "dexter-operator",
      runId: runId || undefined,
      waiver:
        status === "waived"
          ? {
              approvedBy: waiverApprovedBy,
              reason: waiverReason,
              expiresAt: waiverExpiresAt,
              scope: waiverScope || "run",
            }
          : undefined,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "escalation-resolve") {
    const key = parseArg("--key");
    const keys = parseArg("--keys")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const selectedKeys = [key, ...keys].filter(Boolean);
    const allUnresolved = parseBoolArg("--all-unresolved", false);
    const targetRaw = parseArg("--target", "");
    const target = targetRaw ? (targetRaw as "operator" | "planner") : undefined;
    if (target && !["operator", "planner"].includes(target)) {
      throw new Error("Invalid --target. Use operator|planner");
    }
    if (!allUnresolved && selectedKeys.length === 0) {
      throw new Error("Missing --key or --keys (or pass --all-unresolved true)");
    }
    const status = (parseArg("--status", "resolved") as "resolved" | "waived");
    if (!["resolved", "waived"].includes(status)) {
      throw new Error("Invalid --status. Use resolved|waived");
    }
    const note = parseArg("--note");
    const runId = parseArg("--run-id");
    const dryRun = parseBoolArg("--dry-run", false);
    const waiverApprovedBy = parseArg("--waiver-approved-by");
    const waiverReason = parseArg("--waiver-reason");
    const waiverExpiresAt = parseArg("--waiver-expires-at");
    const waiverScope = parseArg("--waiver-scope");
    const result = await resolveEscalationsWorkflow({
      rootDir,
      keys: selectedKeys,
      status,
      allUnresolved,
      target,
      dryRun,
      note: note || undefined,
      runId: runId || undefined,
      actor: waiverApprovedBy || "dexter-operator",
      waiver:
        status === "waived"
          ? {
              approvedBy: waiverApprovedBy,
              reason: waiverReason,
              expiresAt: waiverExpiresAt,
              scope: waiverScope || "run",
            }
          : undefined,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "escalation-list") {
    const unresolvedOnly = parseBoolArg("--unresolved-only", false);
    const result = await listEscalationLifecycle({
      rootDir,
      unresolvedOnly,
    });
    const output = (parseArg("--output", "json") as "json" | "table");
    if (!["json", "table"].includes(output)) {
      throw new Error("Invalid --output. Use json|table");
    }
    printOutput(result, output, () =>
      [
        formatTable(
          ["statePath", "total", "unresolved"],
          [[result.statePath, String(result.total), String(result.unresolved)]],
        ),
        "",
        formatTable(
          ["key", "status", "target", "priority", "reason", "lastRunId"],
          result.items.map((item) => [item.key, item.status, item.target, item.priority, item.reason, item.lastRunId]),
        ),
      ].join("\n"),
    );
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
