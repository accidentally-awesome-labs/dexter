import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import type { IdeaInput } from "../protocols/types.js";
import { runDexter } from "../core/orchestrator.js";
import { planFromIntakeArtifacts } from "./plan-from-intake.js";
import { runIntakePipelineFromIdea } from "./run-intake-pipeline.js";
import type { IntakeBrief } from "./schema.js";

const pilotRequestSchema = z.object({
  id: z.string().min(1),
  project: z.string().min(2),
  idea: z.string().min(10),
  constraints: z.array(z.string()).default([]),
  targetUsers: z.array(z.string()).default([]),
  labels: z.array(z.string()).default([]),
  expectHighRisk: z.boolean().optional(),
  expectClarification: z.boolean().optional(),
  manualTaskDecompositionOverride: z.boolean().default(false),
});

const pilotCatalogSchema = z.object({
  schemaVersion: z.literal("1.0"),
  requests: z.array(pilotRequestSchema).min(1),
});

export type PilotRequest = z.infer<typeof pilotRequestSchema>;

export interface PilotRequestIntervention {
  type:
    | "clarification_required"
    | "clarification_bypassed"
    | "manual_task_decomposition_override"
    | "hitl_auto_approved"
    | "execution_blocked";
  details: string;
}

export interface PilotRequestResult {
  requestId: string;
  project: string;
  completed: boolean;
  highRisk: boolean;
  clarificationRequired: boolean;
  allTasksRoutedHitl: boolean;
  autoDecomposed: boolean;
  manualTaskDecompositionOverride: boolean;
  manualInterventions: PilotRequestIntervention[];
  runId?: string;
  intakeId?: string;
  taskCount?: number;
  error?: string;
}

export interface PilotBatchEvaluation {
  requestsTotal: number;
  completedCount: number;
  autoDecompositionCount: number;
  autoDecompositionRate: number;
  autoDecompositionPassed: boolean;
  highRiskCount: number;
  highRiskHitlCompliantCount: number;
  highRiskHitlPassed: boolean;
  passed: boolean;
}

export interface PilotBatchReport {
  schemaVersion: "1.0";
  generatedAt: string;
  batch: "m2-day9";
  requestsTotal: number;
  evaluation: PilotBatchEvaluation;
  results: PilotRequestResult[];
}

export async function loadPilotRequests(rootDir: string): Promise<PilotRequest[]> {
  const catalogPath = path.join(rootDir, "docs", "operations", "INTAKE_PILOT_REQUESTS.json");
  const raw = await fs.readJson(catalogPath);
  return pilotCatalogSchema.parse(raw).requests;
}

function toIdeaInput(request: PilotRequest): IdeaInput {
  return {
    project: request.project,
    idea: request.idea,
    constraints: request.constraints,
    targetUsers: request.targetUsers,
    labels: request.labels,
  };
}

async function snapshotPilotArtifacts(rootDir: string, requestId: string): Promise<string> {
  const destDir = path.join(rootDir, "artifacts", "intake", "pilot-batch", requestId);
  await fs.ensureDir(destDir);
  const candidates = [
    "INTAKE_BRIEF.json",
    "INTAKE_BRIEF.md",
    "CLARIFICATION_LOG.json",
    "CLARIFICATION_LOG.md",
    "INTAKE_TO_PLAN_MANIFEST.json",
  ];
  for (const name of candidates) {
    const src = path.join(rootDir, "artifacts", "intake", name);
    if (await fs.pathExists(src)) {
      await fs.copy(src, path.join(destDir, name));
    }
  }
  const taskGraph = path.join(rootDir, "artifacts", "planning", "TASK_GRAPH.json");
  if (await fs.pathExists(taskGraph)) {
    await fs.copy(taskGraph, path.join(destDir, "TASK_GRAPH.json"));
  }
  return destDir;
}

function analyzeTaskGraph(tasks: Array<{ routing?: { routedMode?: string } }>): {
  allTasksRoutedHitl: boolean;
} {
  return {
    allTasksRoutedHitl: tasks.every((task) => task.routing?.routedMode === "HITL"),
  };
}

export function evaluatePilotBatch(results: PilotRequestResult[]): PilotBatchEvaluation {
  const requestsTotal = results.length;
  const completedCount = results.filter((result) => result.completed).length;
  const autoDecompositionCount = results.filter(
    (result) => result.autoDecomposed && !result.manualTaskDecompositionOverride,
  ).length;
  const autoDecompositionRate = requestsTotal === 0 ? 0 : autoDecompositionCount / requestsTotal;
  const highRiskResults = results.filter((result) => result.highRisk);
  const highRiskHitlCompliantCount = highRiskResults.filter((result) => result.allTasksRoutedHitl).length;

  return {
    requestsTotal,
    completedCount,
    autoDecompositionCount,
    autoDecompositionRate,
    autoDecompositionPassed: autoDecompositionRate >= 0.8,
    highRiskCount: highRiskResults.length,
    highRiskHitlCompliantCount,
    highRiskHitlPassed:
      highRiskResults.length === 0
        ? true
        : highRiskHitlCompliantCount === highRiskResults.length,
    passed:
      completedCount === requestsTotal &&
      autoDecompositionRate >= 0.8 &&
      (highRiskResults.length === 0 || highRiskHitlCompliantCount === highRiskResults.length),
  };
}

export async function processPilotRequest(
  rootDir: string,
  request: PilotRequest,
  options?: {
    fullRun?: boolean;
    skipClarificationGate?: boolean;
  },
): Promise<PilotRequestResult> {
  const interventions: PilotRequestIntervention[] = [];
  const idea = toIdeaInput(request);

  if (request.manualTaskDecompositionOverride) {
    interventions.push({
      type: "manual_task_decomposition_override",
      details: "Operator replaced auto-generated task graph with manual decomposition.",
    });
  }

  if (process.env.DEXTER_AUTO_APPROVE_HITL === "true") {
    interventions.push({
      type: "hitl_auto_approved",
      details: "HITL approvals auto-approved for pilot execution.",
    });
  }

  try {
    let intakeBrief: IntakeBrief;
    try {
      const intake = await runIntakePipelineFromIdea(rootDir, idea, {
        skipClarificationGate: options?.skipClarificationGate ?? false,
      });
      intakeBrief = intake.brief;
      if (intake.brief.ambiguity.clarificationRequired) {
        interventions.push({
          type: "clarification_required",
          details: `Ambiguity score ${intake.brief.ambiguity.score} exceeded threshold ${intake.brief.ambiguity.threshold}.`,
        });
        if (!options?.skipClarificationGate) {
          return {
            requestId: request.id,
            project: request.project,
            completed: false,
            highRisk: intakeBrief.riskPriority.highRisk,
            clarificationRequired: true,
            allTasksRoutedHitl: false,
            autoDecomposed: false,
            manualTaskDecompositionOverride: request.manualTaskDecompositionOverride,
            manualInterventions: interventions,
            intakeId: intakeBrief.intakeId,
            error: "Clarification gate blocked request.",
          };
        }
        interventions.push({
          type: "clarification_bypassed",
          details: "Clarification gate bypassed to continue pilot execution.",
        });
      }
    } catch (error) {
      if (!options?.skipClarificationGate) {
        throw error;
      }
      const retry = await runIntakePipelineFromIdea(rootDir, idea, { skipClarificationGate: true });
      intakeBrief = retry.brief;
      interventions.push({
        type: "clarification_bypassed",
        details: "Clarification gate bypassed after initial block.",
      });
    }

    const discovery = {
      brief: intakeBrief.summary,
      glossary: {},
      marketEvidence: [],
      risks: [],
    };
    const planned = await planFromIntakeArtifacts(rootDir, discovery, intakeBrief, {
      project: request.project,
    });
    const { allTasksRoutedHitl } = analyzeTaskGraph(planned.plan.tasks);

    let runId: string | undefined;
    if (options?.fullRun) {
      const run = await runDexter(rootDir, idea, {
        intakeBrief,
        skipIntakePipeline: true,
      });
      runId = run.runId;
    }

    await snapshotPilotArtifacts(rootDir, request.id);
    await fs.writeJson(
      path.join(rootDir, "artifacts", "intake", "pilot-batch", request.id, "PILOT_REQUEST_RESULT.json"),
      {
        requestId: request.id,
        interventions,
        highRisk: intakeBrief.riskPriority.highRisk,
        allTasksRoutedHitl,
        autoDecomposed: !request.manualTaskDecompositionOverride,
      },
      { spaces: 2 },
    );

    return {
      requestId: request.id,
      project: request.project,
      completed: true,
      highRisk: intakeBrief.riskPriority.highRisk,
      clarificationRequired: intakeBrief.ambiguity.clarificationRequired,
      allTasksRoutedHitl,
      autoDecomposed: !request.manualTaskDecompositionOverride,
      manualTaskDecompositionOverride: request.manualTaskDecompositionOverride,
      manualInterventions: interventions,
      runId,
      intakeId: intakeBrief.intakeId,
      taskCount: planned.plan.tasks.length,
    };
  } catch (error) {
    interventions.push({
      type: "execution_blocked",
      details: error instanceof Error ? error.message : String(error),
    });
    return {
      requestId: request.id,
      project: request.project,
      completed: false,
      highRisk: false,
      clarificationRequired: false,
      allTasksRoutedHitl: false,
      autoDecomposed: false,
      manualTaskDecompositionOverride: request.manualTaskDecompositionOverride,
      manualInterventions: interventions,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runIntakePilotBatch(
  rootDir: string,
  options?: {
    fullRun?: boolean;
    skipClarificationGate?: boolean;
    requestOffset?: number;
    requestLimit?: number;
    batchId?: string;
  },
): Promise<{ reportPath: string; markdownPath: string; report: PilotBatchReport }> {
  const requests = await loadPilotRequests(rootDir);
  const offset = options?.requestOffset ?? 0;
  const end = options?.requestLimit ? offset + options.requestLimit : undefined;
  const selected = requests.slice(offset, end);
  const results: PilotRequestResult[] = [];

  for (const request of selected) {
    results.push(
      await processPilotRequest(rootDir, request, {
        fullRun: options?.fullRun,
        skipClarificationGate: options?.skipClarificationGate,
      }),
    );
  }

  const evaluation = evaluatePilotBatch(results);
  const report: PilotBatchReport = {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    batch: options?.batchId ?? (offset === 0 && selected.length <= 5 ? "m2-day9" : "m2-day10"),
    requestsTotal: results.length,
    evaluation,
    results,
  };

  const batchDir = path.join(rootDir, "artifacts", "intake", "pilot-batch");
  await fs.ensureDir(batchDir);
  const reportPath = path.join(batchDir, "PILOT_BATCH_REPORT.json");
  const markdownPath = path.join(batchDir, "PILOT_BATCH_INTERVENTIONS.md");
  await fs.writeJson(reportPath, report, { spaces: 2 });
  await fs.writeFile(
    markdownPath,
    [
      "# Pilot Batch Interventions",
      "",
      `Generated at: ${report.generatedAt}`,
      `Requests: ${report.requestsTotal}`,
      `Auto-decomposition rate: ${(evaluation.autoDecompositionRate * 100).toFixed(1)}%`,
      `Passed: ${evaluation.passed}`,
      "",
      ...results.flatMap((result) => [
        `## ${result.requestId}`,
        `- Project: ${result.project}`,
        `- Completed: ${result.completed}`,
        `- High risk: ${result.highRisk}`,
        `- Clarification required: ${result.clarificationRequired}`,
        `- Auto decomposed: ${result.autoDecomposed}`,
        `- All tasks routed HITL: ${result.allTasksRoutedHitl}`,
        ...(result.manualInterventions.length > 0
          ? [
              "",
              "### Interventions",
              ...result.manualInterventions.map((item) => `- ${item.type}: ${item.details}`),
            ]
          : ["", "### Interventions", "- None"]),
        "",
      ]),
    ].join("\n"),
  );

  return { reportPath, markdownPath, report };
}

export function assertPilotExpectations(
  request: PilotRequest,
  result: PilotRequestResult,
): void {
  if (request.expectHighRisk !== undefined && request.expectHighRisk !== result.highRisk) {
    throw new Error(`Request ${request.id} expected highRisk=${request.expectHighRisk} got ${result.highRisk}`);
  }
  if (result.highRisk && !result.allTasksRoutedHitl) {
    throw new Error(`Request ${request.id} is high risk but not all tasks routed to HITL.`);
  }
  if (result.completed && result.highRisk) {
    const hitlOnly = result.allTasksRoutedHitl;
    if (!hitlOnly) {
      throw new Error(`High-risk request ${request.id} must route all tasks through HITL.`);
    }
  }
  if (result.completed && !result.autoDecomposed && !result.manualTaskDecompositionOverride) {
    throw new Error(`Request ${request.id} completed without auto decomposition.`);
  }
}
