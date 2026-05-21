import path from "node:path";
import { spawn } from "node:child_process";
import fs from "fs-extra";
import { appendAuditLogEvent } from "./audit-log.js";
import { generateGoNoGoDecision } from "../release/generate-go-no-go.js";
import { listEscalationLifecycle } from "../supervisor/escalation-lifecycle.js";
import { writeOpsStatusArtifact } from "../core/ops-status.js";
import { findLatestRunId } from "../core/run-selector.js";
import { archivePromotionManifest } from "./promotion-history.js";
import { verifyGovernance } from "./governance-verify.js";
import { verifyPromotionRepeatability } from "./promotion-repeatability.js";
import { writeOperatorWorkflowReadiness } from "./operator-workflow-readiness.js";

export interface PromotionStage {
  environment: string;
  sourceEnvironment: string;
  approverRole: "operator" | "release-manager" | "security";
}

export interface PromotionStageResult {
  environment: string;
  sourceEnvironment: string;
  approverRole: string;
  exitCode: number;
  deploymentId?: string;
  deploymentMode?: string;
  artifacts: {
    selfDeployResult?: string;
    canaryGateResult?: string;
    sloRollbackResult?: string;
  };
}

export interface PromotionPipelineManifest {
  schemaVersion: "1.0";
  promotionId: string;
  generatedAt: string;
  appName: string;
  controlPlane: string;
  targetService: string;
  releaseDecision: "GO" | "NO-GO";
  unresolvedEscalations: number;
  unresolvedOperatorHigh: number;
  stages: PromotionStageResult[];
  artifactTrail: string[];
  audit: {
    logPath: string;
    eventsBefore: number;
    eventsAfter: number;
    eventsDelta: number;
    pipelineActions: string[];
  };
  passed: boolean;
}

export const DEFAULT_PROMOTION_STAGES: PromotionStage[] = [
  { environment: "dev", sourceEnvironment: "dev", approverRole: "operator" },
  { environment: "staging", sourceEnvironment: "dev", approverRole: "operator" },
  { environment: "canary", sourceEnvironment: "staging", approverRole: "release-manager" },
  { environment: "prod", sourceEnvironment: "canary", approverRole: "release-manager" },
];

const manifestJsonPath = (rootDir: string) => path.join(rootDir, "artifacts", "release", "PROMOTION_PIPELINE_MANIFEST.json");
const manifestMarkdownPath = (rootDir: string) => path.join(rootDir, "artifacts", "release", "PROMOTION_PIPELINE_MANIFEST.md");

async function countAuditEvents(logPath: string): Promise<number> {
  if (!(await fs.pathExists(logPath))) {
    return 0;
  }
  const content = await fs.readFile(logPath, "utf8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean).length;
}

async function readUnresolvedOperatorHigh(rootDir: string): Promise<number> {
  const statePath = path.join(rootDir, "artifacts", "execution", "ESCALATION_STATE.json");
  if (!(await fs.pathExists(statePath))) {
    return 0;
  }
  const lifecycle = await listEscalationLifecycle({ rootDir, unresolvedOnly: true });
  return lifecycle.items.filter((item) => item.target === "operator" && item.priority === "high").length;
}

export async function runPromotionPreflight(rootDir: string): Promise<{
  releaseDecision: "GO" | "NO-GO";
  unresolvedEscalations: number;
  unresolvedOperatorHigh: number;
}> {
  const decision = await generateGoNoGoDecision(rootDir);
  const unresolvedOperatorHigh = await readUnresolvedOperatorHigh(rootDir);
  if (decision.decision !== "GO") {
    throw new Error(`Promotion preflight blocked: release decision is ${decision.decision}.`);
  }
  if (decision.unresolvedEscalations > 0) {
    throw new Error(`Promotion preflight blocked: ${decision.unresolvedEscalations} unresolved escalations remain.`);
  }
  if (unresolvedOperatorHigh > 0) {
    throw new Error(`Promotion preflight blocked: ${unresolvedOperatorHigh} unresolved operator-high escalations remain.`);
  }
  return {
    releaseDecision: decision.decision,
    unresolvedEscalations: decision.unresolvedEscalations,
    unresolvedOperatorHigh,
  };
}

export type DeploySelfRunner = (
  args: string[],
  env: NodeJS.ProcessEnv,
) => Promise<{ code: number | null; stdout: string }>;

export async function defaultDeploySelfRunner(args: string[], env: NodeJS.ProcessEnv): Promise<{
  code: number | null;
  stdout: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", "src/index.ts", "deploy-self", ...args], {
      cwd: env.DEXTER_ROOT_DIR ?? process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout }));
  });
}

function stageDeployArgs(stage: PromotionStage, options: {
  appName: string;
  controlPlane: string;
  requireApi: boolean;
  healthUrl?: string;
}): string[] {
  const args = [
    "--control-plane",
    options.controlPlane,
    "--app",
    options.appName,
    "--environment",
    stage.environment,
    "--source-environment",
    stage.sourceEnvironment,
    "--approver-role",
    stage.approverRole,
    "--require-real",
    "true",
    "--require-api",
    options.requireApi ? "true" : "false",
  ];
  if (options.healthUrl) {
    args.push("--health-url", options.healthUrl);
  }
  return args;
}

function stageEnv(stage: PromotionStage, baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    DEXTER_DEPLOY_APPROVER_ROLE: stage.approverRole,
    DEXTER_DEPLOY_APPROVER: baseEnv.DEXTER_DEPLOY_APPROVER ?? `promotion-pipeline-${stage.environment}`,
  };
  if (stage.environment === "canary") {
    env.DEXTER_CANARY_ERROR_RATE_5XX = baseEnv.DEXTER_CANARY_ERROR_RATE_5XX ?? "0.005";
    env.DEXTER_CANARY_P95_LATENCY_MS = baseEnv.DEXTER_CANARY_P95_LATENCY_MS ?? "800";
    env.DEXTER_CANARY_ERROR_BUDGET_BURN = baseEnv.DEXTER_CANARY_ERROR_BUDGET_BURN ?? "1.0";
  }
  return env;
}

async function collectStageArtifacts(rootDir: string, environment: string): Promise<PromotionStageResult["artifacts"]> {
  const releaseDir = path.join(rootDir, "artifacts", "release");
  const selfDeployResult = path.join(releaseDir, "self_deploy_result.json");
  const artifacts: PromotionStageResult["artifacts"] = {};
  if (await fs.pathExists(selfDeployResult)) {
    artifacts.selfDeployResult = selfDeployResult;
  }
  if (environment === "canary") {
    const canaryGateResult = path.join(releaseDir, "CANARY_GATE_RESULT.json");
    if (await fs.pathExists(canaryGateResult)) {
      artifacts.canaryGateResult = canaryGateResult;
    }
  }
  const sloRollbackResult = path.join(releaseDir, "SLO_ROLLBACK_RESULT.json");
  if (await fs.pathExists(sloRollbackResult)) {
    artifacts.sloRollbackResult = sloRollbackResult;
  }
  return artifacts;
}

function parseDeployStdout(stdout: string): { deploymentId?: string; deploymentMode?: string } {
  const jsonStart = stdout.indexOf("{");
  if (jsonStart < 0) {
    return {};
  }
  try {
    const payload = JSON.parse(stdout.slice(jsonStart)) as {
      deploymentId?: string;
      deploymentMode?: string;
    };
    return {
      deploymentId: payload.deploymentId,
      deploymentMode: payload.deploymentMode,
    };
  } catch {
    return {};
  }
}

export async function runPromotionPipeline(options: {
  rootDir: string;
  appName?: string;
  controlPlane?: "coolify" | "dokploy" | "dokku";
  targetService?: string;
  stages?: PromotionStage[];
  requireApi?: boolean;
  healthUrl?: string;
  baseEnv?: NodeJS.ProcessEnv;
  deployRunner?: DeploySelfRunner;
  promotionId?: string;
  verifyGovernanceAfter?: boolean;
  minimumPromotionsForGovernance?: number;
  verifyRepeatabilityAfter?: boolean;
}): Promise<
  PromotionPipelineManifest & {
    governance?: { passed: boolean; reportPath: string };
    repeatability?: { passed: boolean; reportPath: string };
    operatorReadiness?: { ready: boolean; reportPath: string };
  }
> {
  const rootDir = options.rootDir;
  const appName = options.appName ?? "dexter";
  const controlPlane = options.controlPlane ?? "coolify";
  const targetService = options.targetService ?? appName;
  const stages = options.stages ?? DEFAULT_PROMOTION_STAGES;
  const requireApi = options.requireApi ?? true;
  const deployRunner = options.deployRunner ?? defaultDeploySelfRunner;
  const promotionId = options.promotionId ?? `promotion-${new Date().toISOString().slice(0, 10)}-001`;
  const auditLogPath = path.join(rootDir, "artifacts", "operations", "AUDIT_LOG.jsonl");

  const preflight = await runPromotionPreflight(rootDir);
  const eventsBefore = await countAuditEvents(auditLogPath);
  const pipelineActions: string[] = [];

  await appendAuditLogEvent(rootDir, {
    actor: process.env.DEXTER_DEPLOY_APPROVER ?? "promotion-pipeline",
    action: "promotion_pipeline_started",
    scope: targetService,
    reason: "dev_to_prod",
    metadata: { promotionId, stages: stages.map((item) => item.environment) },
  });
  pipelineActions.push("promotion_pipeline_started");

  const stageResults: PromotionStageResult[] = [];
  const baseEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.baseEnv,
    DEXTER_ROOT_DIR: rootDir,
  };

  for (const stage of stages) {
    const args = stageDeployArgs(stage, { appName, controlPlane, requireApi, healthUrl: options.healthUrl });
    const env = stageEnv(stage, baseEnv);
    const run = await deployRunner(args, env);
    const exitCode = run.code ?? 1;
    const parsed = parseDeployStdout(run.stdout);
    const artifacts = await collectStageArtifacts(rootDir, stage.environment);

    stageResults.push({
      environment: stage.environment,
      sourceEnvironment: stage.sourceEnvironment,
      approverRole: stage.approverRole,
      exitCode,
      deploymentId: parsed.deploymentId,
      deploymentMode: parsed.deploymentMode,
      artifacts,
    });

    await appendAuditLogEvent(rootDir, {
      actor: env.DEXTER_DEPLOY_APPROVER ?? "promotion-pipeline",
      action: "promotion_pipeline_stage",
      scope: stage.environment,
      reason: exitCode === 0 ? "stage_passed" : "stage_failed",
      metadata: {
        promotionId,
        sourceEnvironment: stage.sourceEnvironment,
        exitCode,
        deploymentId: parsed.deploymentId ?? null,
      },
    });
    pipelineActions.push(`promotion_pipeline_stage:${stage.environment}`);

    if (exitCode !== 0) {
      throw new Error(`Promotion stage failed: ${stage.environment} (exit ${exitCode}).`);
    }
  }

  await appendAuditLogEvent(rootDir, {
    actor: process.env.DEXTER_DEPLOY_APPROVER ?? "promotion-pipeline",
    action: "promotion_pipeline_completed",
    scope: targetService,
    reason: "dev_to_prod",
    metadata: { promotionId, stages: stageResults.map((item) => item.environment) },
  });
  pipelineActions.push("promotion_pipeline_completed");

  const eventsAfter = await countAuditEvents(auditLogPath);
  const artifactTrail = [
    path.join(rootDir, "artifacts", "release", "GO_NO_GO.md"),
    ...stageResults.flatMap((stage) => Object.values(stage.artifacts).filter((value): value is string => !!value)),
    auditLogPath,
  ];

  const manifest: PromotionPipelineManifest = {
    schemaVersion: "1.0",
    promotionId,
    generatedAt: new Date().toISOString(),
    appName,
    controlPlane,
    targetService,
    releaseDecision: preflight.releaseDecision,
    unresolvedEscalations: preflight.unresolvedEscalations,
    unresolvedOperatorHigh: preflight.unresolvedOperatorHigh,
    stages: stageResults,
    artifactTrail: [...new Set(artifactTrail)],
    audit: {
      logPath: auditLogPath,
      eventsBefore,
      eventsAfter,
      eventsDelta: eventsAfter - eventsBefore,
      pipelineActions,
    },
    passed: true,
  };

  await fs.ensureDir(path.dirname(manifestJsonPath(rootDir)));
  await fs.writeJson(manifestJsonPath(rootDir), manifest, { spaces: 2 });
  await fs.writeFile(
    manifestMarkdownPath(rootDir),
    [
      "# Promotion Pipeline Manifest",
      "",
      `Promotion ID: ${manifest.promotionId}`,
      `Generated at: ${manifest.generatedAt}`,
      `Target service: ${manifest.targetService}`,
      `Release decision: ${manifest.releaseDecision}`,
      `Passed: ${manifest.passed}`,
      "",
      "## Stages",
      ...manifest.stages.map(
        (stage) =>
          `- ${stage.sourceEnvironment} -> ${stage.environment}: exit=${stage.exitCode}, deploymentId=${stage.deploymentId ?? "n/a"}, mode=${stage.deploymentMode ?? "n/a"}`,
      ),
      "",
      "## Artifact Trail",
      ...manifest.artifactTrail.map((item) => `- ${item}`),
      "",
      "## Audit",
      `- Log: ${manifest.audit.logPath}`,
      `- Events delta: ${manifest.audit.eventsDelta}`,
      `- Pipeline actions: ${manifest.audit.pipelineActions.join(", ")}`,
      "",
    ].join("\n"),
  );

  await archivePromotionManifest(rootDir, manifest);

  const latestRunId = await findLatestRunId(rootDir);
  if (latestRunId) {
    await writeOpsStatusArtifact({
      rootDir,
      runDir: path.join(rootDir, "runs", latestRunId),
      runId: latestRunId,
    });
  }

  if (options.verifyGovernanceAfter ?? true) {
    const governance = await verifyGovernance({
      rootDir,
      minimumPromotions: options.minimumPromotionsForGovernance,
    });
    if (!governance.passed) {
      const failed = governance.checks.filter((check) => !check.passed).map((check) => check.name);
      throw new Error(`Governance verification failed: ${failed.join(", ")}`);
    }

    let repeatability: { passed: boolean; reportPath: string } | undefined;
    if (options.verifyRepeatabilityAfter ?? (options.minimumPromotionsForGovernance ?? 0) >= 3) {
      const repeatabilityReport = await verifyPromotionRepeatability(
        rootDir,
        options.minimumPromotionsForGovernance ?? 3,
      );
      if (!repeatabilityReport.passed) {
        const failed = repeatabilityReport.checks.filter((check) => !check.passed).map((check) => check.name);
        throw new Error(`Promotion repeatability verification failed: ${failed.join(", ")}`);
      }
      repeatability = {
        passed: repeatabilityReport.passed,
        reportPath: path.join(rootDir, "artifacts", "release", "PROMOTION_REPEATABILITY.json"),
      };
    }

    let operatorReadiness: { ready: boolean; reportPath: string } | undefined;
    if ((options.minimumPromotionsForGovernance ?? 0) >= 3) {
      const readiness = await writeOperatorWorkflowReadiness(rootDir);
      operatorReadiness = {
        ready: readiness.ready,
        reportPath: path.join(rootDir, "artifacts", "release", "OPERATOR_WORKFLOW_READINESS.json"),
      };
    }

    return {
      ...manifest,
      governance: {
        passed: governance.passed,
        reportPath: path.join(rootDir, "artifacts", "release", "GOVERNANCE_VERIFICATION.json"),
      },
      repeatability,
      operatorReadiness,
    };
  }

  return manifest;
}
