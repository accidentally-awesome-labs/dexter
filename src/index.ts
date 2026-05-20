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

dotenv.config();

function parseArg(flag: string, fallback = ""): string {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? (process.argv[idx + 1] ?? fallback) : fallback;
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
    const outputPath = path.join(rootDir, "artifacts", "release", "self_deploy_result.json");
    await fs.ensureDir(path.dirname(outputPath));
    await fs.writeJson(outputPath, { controlPlane, appName, authorization: auth, ...result }, { spaces: 2 });
    console.log(JSON.stringify({ outputPath, deploymentMode: result.mode, deploymentId: result.deploymentId }, null, 2));
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
