import path from "node:path";
import fs from "fs-extra";
import dotenv from "dotenv";
import { runDexter } from "./core/orchestrator.js";
import { evaluateReadiness } from "./release/readiness.js";
import { createControlPlaneAdapter } from "./runtime/control-plane.js";
import { buildMetricsReport } from "./metrics/aggregator.js";
import { verifyAttestation } from "./release/attestation.js";
import { verifyProvenance } from "./release/provenance.js";
import { generateDeployAuthorization } from "./deploy/authorization.js";
import { revokeDeployAuthorizationNonce } from "./deploy/authorization.js";
import { runDeploymentHealthChecks } from "./runtime/deployment-health.js";

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

    const result = await runDexter(rootDir, {
      project,
      idea,
      constraints,
      targetUsers: ["engineering-teams", "founders"],
    });
    console.log(JSON.stringify(result, null, 2));
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

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
