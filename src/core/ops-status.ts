import path from "node:path";
import fs from "fs-extra";
import { readCanaryGateStatus } from "../operations/canary-gate.js";
import { readSloRollbackStatus } from "../operations/slo-rollback.js";

type EscalationStatus = "open" | "in_progress" | "resolved" | "waived";
type EscalationTarget = "operator" | "planner";
type EscalationPriority = "high" | "medium";
type RunStatus = "healthy" | "degraded" | "blocked" | "unknown";

interface RunSummary {
  runId?: string;
  runStatus?: string;
  productionReady?: boolean;
}

interface EscalationItem {
  key: string;
  status: EscalationStatus;
  target: EscalationTarget;
  priority: EscalationPriority;
  reason: string;
  lastRunId: string;
}

interface ReplanSummary {
  maxWaves?: number;
  stoppedReason?: string;
  waves?: Array<{
    wave: number;
    attempted: boolean;
    stalled: boolean;
    runStatusAfterWave: string;
    unresolvedAfterWave: number;
  }>;
}

export async function writeOpsStatusArtifact(options: {
  rootDir: string;
  runDir: string;
  runId: string;
}): Promise<{
  jsonPath: string;
  markdownPath: string;
}> {
  const { rootDir, runDir, runId } = options;
  const executionDir = path.join(rootDir, "artifacts", "execution");
  await fs.ensureDir(executionDir);

  const runSummaryPath = path.join(runDir, "run_summary.json");
  const runSummary: (RunSummary & {
    intake?: {
      intakeId?: string;
      riskScore?: number;
      highRisk?: boolean;
      tasksRoutedToHitl?: number;
      tasksRoutedToAfk?: number;
    };
    intakeExecutionCoherent?: boolean;
  }) | null = (await fs.pathExists(runSummaryPath))
    ? ((await fs.readJson(runSummaryPath)) as RunSummary & {
        intake?: {
          intakeId?: string;
          riskScore?: number;
          highRisk?: boolean;
          tasksRoutedToHitl?: number;
          tasksRoutedToAfk?: number;
        };
        intakeExecutionCoherent?: boolean;
      })
    : null;

  const intakeManifestPath = path.join(runDir, "intake_execution_manifest.json");
  const intakeManifest = (await fs.pathExists(intakeManifestPath))
    ? ((await fs.readJson(intakeManifestPath)) as {
        coherence?: { passed?: boolean };
        routing?: { routedToHitl?: number; routedToAfk?: number };
        intake?: { riskScore?: number; highRisk?: boolean };
      })
    : null;

  const escalationStatePath = path.join(executionDir, "ESCALATION_STATE.json");
  const escalationItems: EscalationItem[] = (await fs.pathExists(escalationStatePath))
    ? (((await fs.readJson(escalationStatePath)) as { items?: EscalationItem[] }).items ?? [])
    : [];

  const unresolvedStatuses = new Set<EscalationStatus>(["open", "in_progress"]);
  const unresolvedAll = escalationItems.filter((item) => unresolvedStatuses.has(item.status));
  const unresolvedRun = unresolvedAll.filter((item) => item.lastRunId === runId);
  const unresolved = unresolvedRun.length > 0 ? unresolvedRun : unresolvedAll;

  const unresolvedOperatorHigh = unresolved.filter((item) => item.target === "operator" && item.priority === "high").length;
  const unresolvedPlanner = unresolved.filter((item) => item.target === "planner").length;

  const replanPath = path.join(runDir, "replan_waves_summary.json");
  const replan = (await fs.pathExists(replanPath)) ? ((await fs.readJson(replanPath)) as ReplanSummary) : null;
  const canaryGate = await readCanaryGateStatus(rootDir);
  const sloRollback = await readSloRollbackStatus(rootDir);

  const runStatus = (runSummary?.runStatus as RunStatus | undefined) ?? "unknown";
  const resumeAllowed = unresolved.length === 0 && runStatus === "healthy";

  const nextCommands: string[] = [];
  if (unresolved.length > 0) {
    nextCommands.push("npm run escalation:list -- --unresolved-only true --output table");
    nextCommands.push('npm run escalation:resolve -- --all-unresolved true --status resolved --note "resolved from ops dashboard"');
  }
  if (unresolvedOperatorHigh > 0) {
    nextCommands.push('npm run escalation:resolve -- --all-unresolved true --target operator --status resolved --note "operator escalation resolved"');
  }
  if (runStatus === "blocked") {
    nextCommands.push("npm run resume:check -- --latest-blocked true --output table");
    nextCommands.push("npm run run:resume -- --latest-blocked true");
  } else if (runStatus === "degraded") {
    nextCommands.push("npm run resume:check -- --latest-degraded true --output table");
    nextCommands.push("npm run run:resume -- --latest-degraded true");
  } else if (runStatus === "healthy") {
    nextCommands.push("npm run release:decision");
    nextCommands.push("npm run verify");
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    runId,
    runStatus,
    productionReady: runSummary?.productionReady ?? false,
    unresolved: {
      count: unresolved.length,
      operatorHigh: unresolvedOperatorHigh,
      planner: unresolvedPlanner,
      keys: unresolved.map((item) => item.key),
    },
    replan: replan
      ? {
          stoppedReason: replan.stoppedReason ?? "unknown",
          maxWaves: replan.maxWaves ?? null,
          attemptedWaves: replan.waves?.length ?? 0,
        }
      : null,
    intake: runSummary?.intake
      ? {
          intakeId: runSummary.intake.intakeId ?? null,
          riskScore: runSummary.intake.riskScore ?? intakeManifest?.intake?.riskScore ?? null,
          highRisk: runSummary.intake.highRisk ?? intakeManifest?.intake?.highRisk ?? null,
          tasksRoutedToHitl:
            runSummary.intake.tasksRoutedToHitl ?? intakeManifest?.routing?.routedToHitl ?? null,
          tasksRoutedToAfk: runSummary.intake.tasksRoutedToAfk ?? intakeManifest?.routing?.routedToAfk ?? null,
          executionCoherent: runSummary.intakeExecutionCoherent ?? intakeManifest?.coherence?.passed ?? null,
        }
      : null,
    promotion: {
      canaryGate: {
        present: canaryGate.present,
        passed: canaryGate.passed,
        prodPromotionAllowed: canaryGate.prodPromotionAllowed,
        expired: canaryGate.expired,
        burnState: canaryGate.burnState ?? null,
        generatedAt: canaryGate.generatedAt ?? null,
        artifactPath: path.join(rootDir, "artifacts", "release", "CANARY_GATE_RESULT.json"),
      },
      sloRollback: {
        present: sloRollback.present,
        triggered: sloRollback.triggered,
        artifactPath: sloRollback.artifactPath,
      },
    },
    resume: {
      allowed: resumeAllowed,
      reason: resumeAllowed ? "Run is healthy with no unresolved escalations." : "Resolve unresolved escalations before resuming.",
    },
    nextCommands,
  };

  const jsonPath = path.join(executionDir, "OPS_STATUS.json");
  const markdownPath = path.join(executionDir, "OPS_STATUS.md");
  await fs.writeJson(jsonPath, payload, { spaces: 2 });
  await fs.writeFile(
    markdownPath,
    [
      "# Ops Status",
      "",
      `Generated at: ${payload.generatedAt}`,
      `Run ID: ${payload.runId}`,
      `Run status: ${payload.runStatus}`,
      `Production ready: ${payload.productionReady}`,
      "",
      "## Intake Execution",
      ...(payload.intake
        ? [
            `- Intake ID: ${payload.intake.intakeId ?? "unknown"}`,
            `- Risk score: ${payload.intake.riskScore ?? "unknown"}`,
            `- High risk: ${payload.intake.highRisk ?? "unknown"}`,
            `- Routed to HITL: ${payload.intake.tasksRoutedToHitl ?? "unknown"}`,
            `- AFK eligible: ${payload.intake.tasksRoutedToAfk ?? "unknown"}`,
            `- Execution coherent: ${payload.intake.executionCoherent ?? "unknown"}`,
          ]
        : ["- No intake execution metadata for this run"]),
      "",
      "## Unresolved Escalations",
      `- Count: ${payload.unresolved.count}`,
      `- Operator high: ${payload.unresolved.operatorHigh}`,
      `- Planner: ${payload.unresolved.planner}`,
      ...(payload.unresolved.keys.length > 0 ? payload.unresolved.keys.map((key) => `- key=${key}`) : ["- None"]),
      "",
      "## Replan",
      ...(payload.replan
        ? [
            `- Stopped reason: ${payload.replan.stoppedReason}`,
            `- Max waves: ${payload.replan.maxWaves ?? "none"}`,
            `- Attempted waves: ${payload.replan.attemptedWaves}`,
          ]
        : ["- No replan data for this run"]),
      "",
      "## Canary Gate",
      `- Present: ${payload.promotion.canaryGate.present}`,
      `- Passed: ${payload.promotion.canaryGate.passed}`,
      `- Prod promotion allowed: ${payload.promotion.canaryGate.prodPromotionAllowed}`,
      `- Expired: ${payload.promotion.canaryGate.expired}`,
      `- Burn state: ${payload.promotion.canaryGate.burnState ?? "unknown"}`,
      "",
      "## SLO Rollback",
      `- Present: ${payload.promotion.sloRollback.present}`,
      `- Triggered: ${payload.promotion.sloRollback.triggered}`,
      `- Artifact: ${payload.promotion.sloRollback.artifactPath}`,
      "",
      "## Resume Readiness",
      `- Allowed: ${payload.resume.allowed}`,
      `- Reason: ${payload.resume.reason}`,
      "",
      "## Next Commands",
      ...(payload.nextCommands.length > 0 ? payload.nextCommands.map((cmd) => `- ${cmd}`) : ["- None"]),
      "",
    ].join("\n"),
  );

  await fs.writeJson(path.join(runDir, "ops_status_summary.json"), payload, { spaces: 2 });
  return { jsonPath, markdownPath };
}
