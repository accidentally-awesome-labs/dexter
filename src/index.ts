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
    const adapter = createControlPlaneAdapter(rootDir, controlPlane);
    const auth = await generateDeployAuthorization(rootDir, appName, {
      approvedBy: process.env.DEXTER_DEPLOY_APPROVER ?? "deploy-self",
      environment,
      controlPlane,
      tenantId,
    });
    if (!auth) {
      throw new Error("Unable to generate deployment authorization. Ensure planning and supply-chain artifacts exist.");
    }
    const result = await adapter.deploy(appName, auth, { environment, tenantId });
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
    let autoRollback:
      | { triggered: true; rollbackId: string; rollbackMode: "api" | "hook" | "simulated" }
      | { triggered: false } = { triggered: false };
    if (!healthValidation.passed) {
      const rollbackResult = await adapter.rollback(appName);
      autoRollback = {
        triggered: true,
        rollbackId: rollbackResult.rollbackId,
        rollbackMode: rollbackResult.mode,
      };
      if (requireApiMode && rollbackResult.mode !== "api") {
        throw new Error("Deploy-self health rollback failed API requirement: rollback mode is not API.");
      }
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
      const redeployAuth = await generateDeployAuthorization(rootDir, appName, {
        approvedBy: process.env.DEXTER_DEPLOY_APPROVER ?? "deploy-self-rollback-drill",
        environment,
        controlPlane,
        tenantId,
      });
      if (!redeployAuth) {
        throw new Error("Rollback drill failed: unable to generate redeploy authorization.");
      }
      const redeployResult = await adapter.deploy(appName, redeployAuth, { environment, tenantId });

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
        requireRealMode,
        requireApiMode,
        rollbackDrill,
        healthValidation,
        autoRollback,
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
          healthValidation,
          autoRollback,
          rollbackValidation,
        },
        null,
        2,
      ),
    );
    if (!healthValidation.passed) {
      throw new Error("Deployment health checks failed and rollback was triggered.");
    }
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
      note,
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
      note,
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
