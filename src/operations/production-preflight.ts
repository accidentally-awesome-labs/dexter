import path from "node:path";
import fs from "fs-extra";
import { createDeploymentProvider } from "../providers/deployment/factory.js";
import type { DeploymentProviderId } from "../providers/deployment/types.js";
import { runPromotionPreflight } from "./run-promotion-pipeline.js";

export type ProductionPreflightSeverity = "blocker" | "warning" | "info";

export interface ProductionPreflightCheck {
  id: string;
  title: string;
  severity: ProductionPreflightSeverity;
  passed: boolean;
  detail: string;
}

export interface ProductionPreflightReport {
  schemaVersion: "1.0";
  generatedAt: string;
  passed: boolean;
  controlPlane: DeploymentProviderId;
  checks: ProductionPreflightCheck[];
  nextCommands: string[];
}

const DEV_DEPLOY_KEY = "dexter-dev-deploy-key";
const DEV_POLICY_KEY = "dexter-dev-policy-bundle-key";

function envPresent(name: string): boolean {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0;
}

function pushCheck(
  checks: ProductionPreflightCheck[],
  check: ProductionPreflightCheck,
): void {
  checks.push(check);
}

async function probeControlPlaneApi(controlPlane: DeploymentProviderId): Promise<string> {
  const provider = createDeploymentProvider(controlPlane);
  if (!provider) {
    return "API provider not configured (missing endpoint or token).";
  }

  const upper = controlPlane.toUpperCase();
  const endpoint =
    process.env[`DEXTER_${upper}_API_URL`] ??
    process.env[`DEXTER_${upper}_ENDPOINT`] ??
    (controlPlane === "coolify" ? process.env.DEXTER_CONTROL_PLANE_ENDPOINT : undefined);
  if (!endpoint) {
    return "Endpoint missing.";
  }

  try {
    const response = await fetch(endpoint.replace(/\/$/, ""), {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    return `Reachable (HTTP ${response.status}). Bridge should expose POST /deploy and POST /rollback.`;
  } catch (error) {
    return `Unreachable: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function fileExists(rootDir: string, relativePath: string): Promise<boolean> {
  return fs.pathExists(path.join(rootDir, relativePath));
}

export async function runProductionPreflight(options: {
  rootDir: string;
  controlPlane?: DeploymentProviderId;
  requireApiProbe?: boolean;
  requireAlerts?: boolean;
  strictSecrets?: boolean;
}): Promise<ProductionPreflightReport> {
  const rootDir = options.rootDir;
  const controlPlane = options.controlPlane ?? "coolify";
  const checks: ProductionPreflightCheck[] = [];
  const nextCommands: string[] = [];

  const endpointVar =
    controlPlane === "coolify"
      ? ["DEXTER_COOLIFY_API_URL", "DEXTER_CONTROL_PLANE_ENDPOINT"]
      : [`DEXTER_${controlPlane.toUpperCase()}_API_URL`];
  const tokenVar =
    controlPlane === "coolify"
      ? ["DEXTER_COOLIFY_TOKEN", "DEXTER_CONTROL_PLANE_TOKEN"]
      : [`DEXTER_${controlPlane.toUpperCase()}_TOKEN`];

  const hasEndpoint = endpointVar.some(envPresent);
  const hasToken = tokenVar.some(envPresent);
  pushCheck(checks, {
    id: "control_plane_credentials",
    title: "Control plane API URL and token",
    severity: "blocker",
    passed: hasEndpoint && hasToken,
    detail: hasEndpoint && hasToken
      ? `Configured for ${controlPlane}.`
      : `Set ${endpointVar.join(" or ")} and ${tokenVar.join(" or ")}.`,
  });

  if (options.requireApiProbe ?? true) {
    const probeDetail = await probeControlPlaneApi(controlPlane);
    const reachable = !probeDetail.startsWith("Unreachable") && !probeDetail.startsWith("API provider not");
    pushCheck(checks, {
      id: "control_plane_reachable",
      title: "Control plane endpoint reachable",
      severity: "blocker",
      passed: reachable && hasEndpoint && hasToken,
      detail: probeDetail,
    });
  }

  const healthUrl = process.env.DEXTER_DEPLOY_HEALTH_URL ?? process.env.DEXTER_DEPLOY_HEALTH_URLS;
  pushCheck(checks, {
    id: "deploy_health_url",
    title: "Post-deploy health URL",
    severity: "blocker",
    passed: Boolean(healthUrl?.trim()),
    detail: healthUrl
      ? `Configured (${healthUrl.split(",")[0]?.trim()}).`
      : "Set DEXTER_DEPLOY_HEALTH_URL or DEXTER_DEPLOY_HEALTH_URLS before staging/canary promotion.",
  });

  const deployKey = process.env.DEXTER_DEPLOY_AUTH_KEY ?? DEV_DEPLOY_KEY;
  const policyKey = process.env.DEXTER_POLICY_BUNDLE_KEY ?? DEV_POLICY_KEY;
  const usingDevSecrets = deployKey === DEV_DEPLOY_KEY || policyKey === DEV_POLICY_KEY;
  pushCheck(checks, {
    id: "deploy_secrets",
    title: "Production deploy signing keys",
    severity: options.strictSecrets ? "blocker" : "warning",
    passed: !usingDevSecrets,
    detail: usingDevSecrets
      ? "DEXTER_DEPLOY_AUTH_KEY and/or DEXTER_POLICY_BUNDLE_KEY still use dev defaults."
      : "Non-default deploy auth and policy bundle keys are set.",
  });

  const alertVars = [
    "DEXTER_ALERT_WEBHOOK_URL",
    "DEXTER_ALERT_CHAT_WEBHOOK_URL",
    "DEXTER_ALERT_PAGER_WEBHOOK_URL",
  ];
  const configuredAlerts = alertVars.filter(envPresent);
  pushCheck(checks, {
    id: "alert_webhooks",
    title: "Alert delivery webhooks",
    severity: options.requireAlerts ? "blocker" : "warning",
    passed: configuredAlerts.length > 0,
    detail:
      configuredAlerts.length > 0
        ? `Configured: ${configuredAlerts.join(", ")}`
        : "Set at least one DEXTER_ALERT_*_WEBHOOK_URL for live alert:route delivery.",
  });

  const planningOk = await fileExists(rootDir, "artifacts/planning/PLANNING_SIGNATURES.json");
  pushCheck(checks, {
    id: "planning_signatures",
    title: "Planning signatures artifact",
    severity: "blocker",
    passed: planningOk,
    detail: planningOk
      ? "artifacts/planning/PLANNING_SIGNATURES.json exists."
      : "Run npm run run:sample or intake:plan before promotion.",
  });

  const supplyChainOk = await fileExists(rootDir, "runs/latest/supply_chain_gate.json");
  pushCheck(checks, {
    id: "supply_chain_gate",
    title: "Latest supply chain gate",
    severity: "blocker",
    passed: supplyChainOk,
    detail: supplyChainOk
      ? "runs/latest/supply_chain_gate.json exists."
      : "Complete at least one run so runs/latest/supply_chain_gate.json is populated.",
  });

  let releaseDetail = "release:decision not evaluated.";
  let releasePassed = false;
  try {
    const preflight = await runPromotionPreflight(rootDir);
    releasePassed = preflight.releaseDecision === "GO";
    releaseDetail = `releaseDecision=${preflight.releaseDecision}, unresolvedEscalations=${preflight.unresolvedEscalations}, operatorHigh=${preflight.unresolvedOperatorHigh}`;
  } catch (error) {
    releaseDetail = error instanceof Error ? error.message : String(error);
  }
  pushCheck(checks, {
    id: "release_governance",
    title: "Release decision and escalations",
    severity: "blocker",
    passed: releasePassed,
    detail: releaseDetail,
  });

  const passed = checks.every((check) => check.passed || check.severity !== "blocker");

  if (!hasEndpoint || !hasToken) {
    nextCommands.push("cp .env.example .env  # fill control plane + health URLs");
  }
  if (!planningOk || !supplyChainOk) {
    nextCommands.push("npm run run:sample");
  }
  if (!releasePassed) {
    nextCommands.push("npm run release:decision");
    nextCommands.push("npm run escalation:list -- --output table");
  }
  nextCommands.push(
    `npm run deploy:self -- --environment staging --require-api true --health-url <url>`,
  );
  nextCommands.push(
    `npm run promotion:pipeline -- --app <app> --health-url <url>`,
  );
  if (configuredAlerts.length === 0) {
    nextCommands.push("npm run alert:route -- --dry-run false");
  }

  return {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    passed,
    controlPlane,
    checks,
    nextCommands,
  };
}

export async function writeProductionPreflightArtifacts(
  rootDir: string,
  report: ProductionPreflightReport,
): Promise<{ jsonPath: string; markdownPath: string }> {
  const releaseDir = path.join(rootDir, "artifacts", "release");
  await fs.ensureDir(releaseDir);
  const jsonPath = path.join(releaseDir, "PRODUCTION_PREFLIGHT.json");
  const markdownPath = path.join(releaseDir, "PRODUCTION_PREFLIGHT.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  const lines = [
    "# Production Preflight",
    "",
    `- Generated: ${report.generatedAt}`,
    `- Passed: ${report.passed ? "yes" : "no"}`,
    `- Control plane: ${report.controlPlane}`,
    "",
    "## Checks",
    "",
    ...report.checks.map(
      (check) =>
        `- **${check.id}** (${check.severity}): ${check.passed ? "PASS" : "FAIL"} — ${check.title}. ${check.detail}`,
    ),
    "",
    "## Next commands",
    "",
    ...report.nextCommands.map((command) => `- \`${command}\``),
    "",
  ];
  await fs.writeFile(markdownPath, `${lines.join("\n")}\n`, "utf8");
  return { jsonPath, markdownPath };
}
