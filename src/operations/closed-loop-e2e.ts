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

export interface ClosedLoopE2eOptions {
  rootDir: string;
  project?: string;
  idea?: string;
  constraints?: string[];
  targetUsers?: string[];
  skipPreflight?: boolean;
}

export interface ClosedLoopE2eReport {
  schemaVersion: "1.0";
  generatedAt: string;
  passed: boolean;
  project: string;
  coolifyAppName: string;
  runId: string;
  deploymentMode: string;
  deploymentId?: string;
  verificationPassed: boolean;
  productionReady: boolean;
  health: {
    url: string;
    appFqdn?: string;
    passed: boolean;
    checks: Array<{ url: string; status: string; statusCode?: number }>;
  };
  phases: Array<{ name: string; passed: boolean; detail: string }>;
  artifactPaths: {
    runSummary: string;
    deployment: string;
    deploymentHealth: string;
    intakeBrief: string;
  };
}

export function defaultClosedLoopIdea(project: string): string {
  return `Build and ship ${project}: a production-ready internal tools API with policy-gated autonomous delivery through Dexter.`;
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

export async function resolveClosedLoopHealthUrl(
  rootDir: string,
  appName: string,
): Promise<{ url: string; appFqdn?: string; source: string }> {
  const explicit = process.env.DEXTER_DEPLOY_HEALTH_URL?.trim();
  if (explicit) {
    return { url: explicit, source: "DEXTER_DEPLOY_HEALTH_URL" };
  }

  const coolify = createCoolifyClientFromEnv(rootDir);
  if (coolify) {
    try {
      const app = await coolify.findApplicationByName(appName, rootDir);
      const fqdn = app?.fqdn?.trim();
      if (fqdn) {
        const base = fqdn.replace(/\/$/, "");
        const pathSuffix =
          app?.health_check_path && app.health_check_path !== "/"
            ? app.health_check_path.startsWith("/")
              ? app.health_check_path
              : `/${app.health_check_path}`
            : "/";
        const probe = await runDeploymentHealthChecks({
          urls: [`${base}${pathSuffix}`],
          timeoutMs: 4000,
        });
        if (probe.passed) {
          return { url: `${base}${pathSuffix}`, appFqdn: fqdn, source: "coolify_app_fqdn" };
        }
      }
    } catch {
      // fall through to control-plane health
    }
  }

  const origin = (process.env.COOLIFY_ORIGIN ?? process.env.DEXTER_COOLIFY_ORIGIN ?? "").replace(/\/$/, "");
  if (origin) {
    return { url: `${origin}/api/health`, source: "coolify_control_plane_health" };
  }

  throw new Error("Unable to resolve deploy health URL. Set DEXTER_DEPLOY_HEALTH_URL or COOLIFY_ORIGIN.");
}

export async function runClosedLoopE2e(options: ClosedLoopE2eOptions): Promise<ClosedLoopE2eReport> {
  const rootDir = options.rootDir;
  const project = options.project ?? process.env.DEXTER_COOLIFY_APP_NAME ?? "dexter";
  const coolifyAppName = process.env.DEXTER_COOLIFY_APP_NAME ?? project;
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

  const health = await resolveClosedLoopHealthUrl(rootDir, coolifyAppName);
  process.env.DEXTER_DEPLOY_HEALTH_URL = health.url;
  process.env.DEXTER_REQUIRE_API_DEPLOY = "true";
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
    detail: `health probe target ${health.url} (${health.source})`,
  });

  const runResult = await runDexter(rootDir, idea, { requireApiDeploy: true });
  phases.push({
    name: "factory_run",
    passed: runResult.deploymentMode === "api" && runResult.verificationPassed,
    detail: `deploymentMode=${runResult.deploymentMode}, verification=${runResult.verificationPassed}`,
  });

  const runDir = path.join(rootDir, "runs", runResult.runId);
  const runSummaryPath = path.join(runDir, "run_summary.json");
  const deploymentPath = path.join(runDir, "deployment.json");
  const deploymentHealthPath = path.join(runDir, "deployment_health.json");
  const intakeBriefPath = path.join(rootDir, "artifacts", "intake", "INTAKE_BRIEF.json");

  const deployment = (await fs.readJson(deploymentPath)) as {
    deploymentId?: string;
    mode?: string;
  };
  const deploymentHealth = (await fs.readJson(deploymentHealthPath)) as {
    passed: boolean;
    checks: Array<{ url: string; status: string; statusCode?: number }>;
  };

  const passed =
    runResult.deploymentMode === "api" &&
    runResult.verificationPassed &&
    deploymentHealth.passed &&
    runResult.productionReady;

  const report: ClosedLoopE2eReport = {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    passed,
    project,
    coolifyAppName,
    runId: runResult.runId,
    deploymentMode: runResult.deploymentMode,
    deploymentId: deployment.deploymentId,
    verificationPassed: runResult.verificationPassed,
    productionReady: runResult.productionReady,
    health: {
      url: health.url,
      appFqdn: health.appFqdn,
      passed: deploymentHealth.passed,
      checks: deploymentHealth.checks,
    },
    phases,
    artifactPaths: {
      runSummary: runSummaryPath,
      deployment: deploymentPath,
      deploymentHealth: deploymentHealthPath,
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
      `- Run: ${runResult.runId}`,
      `- Project: ${project}`,
      `- Coolify app: ${coolifyAppName}`,
      `- Deployment mode: ${runResult.deploymentMode}`,
      `- Deployment id: ${deployment.deploymentId ?? "n/a"}`,
      `- Health URL: ${health.url}`,
      `- Health passed: ${deploymentHealth.passed ? "yes" : "no"}`,
      "",
      "## Phases",
      ...phases.map((phase) => `- ${phase.name}: ${phase.passed ? "PASS" : "FAIL"} — ${phase.detail}`),
      "",
    ].join("\n"),
  );

  if (!passed) {
    throw new Error(
      `Closed-loop E2E failed: deploymentMode=${runResult.deploymentMode}, health=${deploymentHealth.passed}, verification=${runResult.verificationPassed}.`,
    );
  }

  return report;
}
