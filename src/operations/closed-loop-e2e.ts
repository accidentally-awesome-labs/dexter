import path from "node:path";
import fs from "fs-extra";
import type { IdeaInput } from "../protocols/types.js";
import { runDexter } from "../core/orchestrator.js";
import { createDeploymentProvider } from "../providers/deployment/factory.js";
import {
  createCoolifyClientFromEnv,
  defaultCoolifyAppsConfigPath,
} from "../providers/deployment/coolify-client.js";
import { runDeploymentHealthChecks } from "../runtime/deployment-health.js";
import { runProductionPreflight } from "./production-preflight.js";
import { loadDeployManifest } from "../release/deploy-manifest.js";

export interface ClosedLoopE2eOptions {
  rootDir: string;
  project?: string;
  idea?: string;
  constraints?: string[];
  targetUsers?: string[];
  skipPreflight?: boolean;
  strictHealth?: boolean;
}

export interface HealthResolution {
  url: string;
  source: string;
  appFqdn?: string;
  fallbackUsed: boolean;
}

export interface ClosedLoopE2eReport {
  schemaVersion: "1.1";
  generatedAt: string;
  passed: boolean;
  project: string;
  coolifyAppName: string;
  runId: string;
  deploymentMode: string;
  deploymentId?: string;
  deployArtifactRef?: {
    image: string;
    tag: string;
    deployTag: string;
    stampPath: string;
  };
  verificationPassed: boolean;
  productionReady: boolean;
  health: {
    url: string;
    appFqdn?: string;
    source: string;
    fallbackUsed: boolean;
    passed: boolean;
    checks: Array<{ url: string; status: string; statusCode?: number }>;
  };
  phases: Array<{ name: string; passed: boolean; detail: string }>;
  artifactPaths: {
    runSummary: string;
    deployment: string;
    deploymentHealth: string;
    deploymentManifest: string;
    intakeBrief: string;
  };
}

export function defaultClosedLoopIdea(project: string): string {
  return `Build and ship ${project}: a production-ready internal tools API with policy-gated autonomous delivery through Dexter.`;
}

export function isStrictHealthEnabled(options?: ClosedLoopE2eOptions): boolean {
  if (options?.strictHealth !== undefined) {
    return options.strictHealth;
  }
  return process.env.DEXTER_E2E_STRICT_HEALTH !== "false";
}

export async function validateClosedLoopWiring(rootDir: string): Promise<string[]> {
  const blockers: string[] = [];
  const provider = createDeploymentProvider("coolify");
  if (!provider) {
    blockers.push("Missing DEXTER_COOLIFY_API_URL and DEXTER_COOLIFY_TOKEN (Coolify bridge must be running).");
  }
  const appsPath = defaultCoolifyAppsConfigPath(rootDir);
  if (!(await fs.pathExists(appsPath))) {
    blockers.push(`Missing ${appsPath}. Run npm run coolify:setup.`);
  }
  const coolify = createCoolifyClientFromEnv(rootDir);
  if (!coolify) {
    blockers.push("Missing COOLIFY_ORIGIN and COOLIFY_API_TOKEN for application lookup.");
  }
  return blockers;
}

function appHealthUrl(fqdn: string, healthPath?: string | null): string {
  const base = fqdn.replace(/\/$/, "");
  if (!healthPath || healthPath === "/") {
    return `${base}/`;
  }
  return healthPath.startsWith("/") ? `${base}${healthPath}` : `${base}/${healthPath}`;
}

export async function resolveClosedLoopHealthUrl(
  rootDir: string,
  appName: string,
): Promise<HealthResolution> {
  const allowPanel = process.env.DEXTER_E2E_ALLOW_PANEL_HEALTH === "true";
  const explicit = process.env.DEXTER_DEPLOY_HEALTH_URL?.trim();

  if (allowPanel && explicit) {
    return { url: explicit, source: "DEXTER_DEPLOY_HEALTH_URL", fallbackUsed: false };
  }

  const coolify = createCoolifyClientFromEnv(rootDir);
  if (coolify) {
    try {
      const app = await coolify.findApplicationByName(appName, rootDir);
      const fqdn = app?.fqdn?.trim();
      if (fqdn) {
        const candidate = appHealthUrl(fqdn, app.health_check_path);
        const probe = await runDeploymentHealthChecks({
          urls: [candidate],
          timeoutMs: 4000,
        });
        if (probe.passed) {
          return {
            url: candidate,
            appFqdn: fqdn,
            source: "coolify_app_fqdn",
            fallbackUsed: false,
          };
        }
      }
    } catch {
      // fall through
    }
  }

  if (explicit && !allowPanel) {
    const probe = await runDeploymentHealthChecks({ urls: [explicit], timeoutMs: 4000 });
    if (probe.passed) {
      return { url: explicit, source: "DEXTER_DEPLOY_HEALTH_URL", fallbackUsed: false };
    }
  }

  const origin = (process.env.COOLIFY_ORIGIN ?? process.env.DEXTER_COOLIFY_ORIGIN ?? "").replace(/\/$/, "");
  if (origin) {
    return {
      url: `${origin}/api/health`,
      source: "coolify_control_plane_health",
      fallbackUsed: true,
    };
  }

  throw new Error("Unable to resolve deploy health URL. Set COOLIFY_ORIGIN or DEXTER_DEPLOY_HEALTH_URL.");
}

export async function runClosedLoopE2e(options: ClosedLoopE2eOptions): Promise<ClosedLoopE2eReport> {
  const rootDir = options.rootDir;
  const project = options.project ?? process.env.DEXTER_COOLIFY_APP_NAME ?? "dexter";
  const coolifyAppName = process.env.DEXTER_COOLIFY_APP_NAME ?? project;
  const strictHealth = isStrictHealthEnabled(options);
  const phases: ClosedLoopE2eReport["phases"] = [];

  const wiringBlockers = await validateClosedLoopWiring(rootDir);
  if (wiringBlockers.length > 0) {
    throw new Error(wiringBlockers.join("\n"));
  }
  phases.push({ name: "wiring", passed: true, detail: "Coolify bridge env and apps.json present." });

  if (!options.skipPreflight) {
    const preflight = await runProductionPreflight({
      rootDir,
      controlPlane: "coolify",
      requireApiProbe: true,
    });
    phases.push({
      name: "preflight",
      passed: preflight.passed,
      detail: preflight.passed ? "production:preflight passed" : "production:preflight failed",
    });
    if (!preflight.passed) {
      throw new Error("Production preflight failed before closed-loop run.");
    }
  }

  if (strictHealth) {
    delete process.env.DEXTER_DEPLOY_HEALTH_URL;
  }

  const health = await resolveClosedLoopHealthUrl(rootDir, coolifyAppName);
  if (strictHealth && health.fallbackUsed) {
    throw new Error(
      `Strict health mode requires application FQDN health, but only fallback is available (${health.source}). Start the Coolify app or set DEXTER_E2E_ALLOW_PANEL_HEALTH=true for dev.`,
    );
  }

  process.env.DEXTER_DEPLOY_HEALTH_URL = health.url;
  process.env.DEXTER_REQUIRE_API_DEPLOY = "true";
  process.env.DEXTER_CLOSED_LOOP_SMOKE = process.env.DEXTER_CLOSED_LOOP_SMOKE ?? "true";
  process.env.DEXTER_AUTO_APPROVE_HITL = process.env.DEXTER_AUTO_APPROVE_HITL ?? "true";
  process.env.DEXTER_SKIP_CLARIFICATION_GATE = process.env.DEXTER_SKIP_CLARIFICATION_GATE ?? "true";

  const idea: IdeaInput = {
    project,
    idea: options.idea ?? defaultClosedLoopIdea(project),
    constraints: options.constraints ?? ["self-hosted", "policy-gated", "api-deploy"],
    targetUsers: options.targetUsers ?? ["platform-team"],
  };

  phases.push({
    name: "health_resolution",
    passed: true,
    detail: `health ${health.url} (${health.source}, fallback=${health.fallbackUsed})`,
  });

  const runResult = await runDexter(rootDir, idea, {
    requireApiDeploy: true,
    closedLoopSmoke: true,
  });
  phases.push({
    name: "factory_run",
    passed: runResult.deploymentMode === "api" && runResult.verificationPassed,
    detail: `deploymentMode=${runResult.deploymentMode}, verification=${runResult.verificationPassed}`,
  });

  const runDir = path.join(rootDir, "runs", runResult.runId);
  const runSummaryPath = path.join(runDir, "run_summary.json");
  const deploymentPath = path.join(runDir, "deployment.json");
  const deploymentHealthPath = path.join(runDir, "deployment_health.json");
  const deploymentManifestPath = path.join(runDir, "deploy_manifest.json");
  const intakeBriefPath = path.join(rootDir, "artifacts", "intake", "INTAKE_BRIEF.json");

  const deployment = (await fs.readJson(deploymentPath)) as {
    deploymentId?: string;
    mode?: string;
  };
  const deploymentHealth = (await fs.readJson(deploymentHealthPath)) as {
    passed: boolean;
    checks: Array<{ url: string; status: string; statusCode?: number }>;
  };
  const manifest = (await loadDeployManifest(deploymentManifestPath)) ?? (await loadDeployManifest());

  const stampExists = await fs.pathExists(path.join(rootDir, "generated", "RUN_STAMP.json"));
  phases.push({
    name: "run_stamp",
    passed: stampExists,
    detail: stampExists ? "generated/RUN_STAMP.json present" : "missing RUN_STAMP (DEXTER_CLOSED_LOOP_SMOKE?)",
  });

  const passed =
    runResult.deploymentMode === "api" &&
    runResult.verificationPassed &&
    deploymentHealth.passed &&
    runResult.productionReady &&
    stampExists &&
    Boolean(manifest);

  const report: ClosedLoopE2eReport = {
    schemaVersion: "1.1",
    generatedAt: new Date().toISOString(),
    passed,
    project,
    coolifyAppName,
    runId: runResult.runId,
    deploymentMode: runResult.deploymentMode,
    deploymentId: deployment.deploymentId,
    deployArtifactRef: manifest
      ? {
          image: manifest.image,
          tag: manifest.tag,
          deployTag: manifest.deployTag,
          stampPath: manifest.stampPath,
        }
      : undefined,
    verificationPassed: runResult.verificationPassed,
    productionReady: runResult.productionReady,
    health: {
      url: health.url,
      appFqdn: health.appFqdn,
      source: health.source,
      fallbackUsed: health.fallbackUsed,
      passed: deploymentHealth.passed,
      checks: deploymentHealth.checks,
    },
    phases,
    artifactPaths: {
      runSummary: runSummaryPath,
      deployment: deploymentPath,
      deploymentHealth: deploymentHealthPath,
      deploymentManifest: deploymentManifestPath,
      intakeBrief: intakeBriefPath,
    },
  };

  const outDir = path.join(rootDir, "artifacts", "release");
  await fs.ensureDir(outDir);
  await fs.writeJson(path.join(outDir, "CLOSED_LOOP_E2E.json"), report, { spaces: 2 });
  await fs.writeFile(
    path.join(outDir, "CLOSED_LOOP_E2E.md"),
    [
      "# Closed-Loop E2E",
      "",
      `- Passed: ${passed ? "yes" : "no"}`,
      `- Schema: ${report.schemaVersion}`,
      `- Run: ${runResult.runId}`,
      `- Project: ${project}`,
      `- Deploy tag: ${manifest?.deployTag ?? "n/a"}`,
      `- Health: ${health.url} (${health.source}, fallback=${health.fallbackUsed})`,
      "",
      "## Phases",
      ...phases.map((phase) => `- ${phase.name}: ${phase.passed ? "PASS" : "FAIL"} — ${phase.detail}`),
      "",
    ].join("\n"),
  );

  if (!passed) {
    throw new Error(
      `Closed-loop E2E failed: deploymentMode=${runResult.deploymentMode}, stamp=${stampExists}, manifest=${Boolean(manifest)}.`,
    );
  }

  return report;
}
