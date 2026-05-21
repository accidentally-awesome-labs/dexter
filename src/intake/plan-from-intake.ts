import path from "node:path";
import fs from "fs-extra";
import type { DiscoveryArtifact, PlanArtifact } from "../protocols/types.js";
import { compilePlan } from "../skills/planning/compiler.js";
import type { IntakeBrief } from "./schema.js";
import { readClarificationLog } from "./clarification-gate.js";

export interface IntakeToPlanManifest {
  schemaVersion: "1.0";
  intakeId: string;
  project: string;
  generatedAt: string;
  clarificationRequired: boolean;
  clarificationLogPath: string | null;
  planningArtifacts: {
    taskGraphPath: string;
    prdPath: string;
  };
  taskCount: number;
  tasksWithRiskPriority: number;
  tasksRoutedToHitl: number;
}

const manifestPath = (rootDir: string) =>
  path.join(rootDir, "artifacts", "intake", "INTAKE_TO_PLAN_MANIFEST.json");

export function risksFromIntakeBrief(brief: IntakeBrief): DiscoveryArtifact["risks"] {
  if (!brief.riskPriority.highRisk) {
    return [];
  }
  return [
    {
      id: "risk-intake-high",
      title: "High-risk intake requires elevated governance controls.",
      level: brief.riskPriority.riskLevel,
      mitigation: "Route affected tasks through HITL and enforce policy gate approval before execution.",
    },
  ];
}

export async function writeIntakeToPlanManifest(
  rootDir: string,
  brief: IntakeBrief,
  plan: PlanArtifact,
): Promise<{ manifestPath: string; manifest: IntakeToPlanManifest }> {
  const clarification = await readClarificationLog(rootDir);
  const manifest: IntakeToPlanManifest = {
    schemaVersion: "1.0",
    intakeId: brief.intakeId,
    project: brief.project,
    generatedAt: new Date().toISOString(),
    clarificationRequired: brief.ambiguity.clarificationRequired,
    clarificationLogPath: clarification
      ? path.join(rootDir, "artifacts", "intake", "CLARIFICATION_LOG.md")
      : null,
    planningArtifacts: {
      taskGraphPath: path.join(rootDir, "artifacts", "planning", "TASK_GRAPH.json"),
      prdPath: path.join(rootDir, "artifacts", "planning", "PRD.md"),
    },
    taskCount: plan.tasks.length,
    tasksWithRiskPriority: plan.tasks.filter((task) => task.riskPriority).length,
    tasksRoutedToHitl: plan.tasks.filter((task) => task.routing?.routedMode === "HITL").length,
  };

  const outPath = manifestPath(rootDir);
  await fs.ensureDir(path.dirname(outPath));
  await fs.writeJson(outPath, manifest, { spaces: 2 });
  return { manifestPath: outPath, manifest };
}

export function compilePlanFromIntake(
  discovery: DiscoveryArtifact,
  intakeBrief: IntakeBrief,
  options?: { project?: string; priorLessons?: string[] },
): PlanArtifact {
  return compilePlan(discovery, {
    project: options?.project ?? intakeBrief.project,
    priorLessons: options?.priorLessons ?? [],
    intakeBrief,
  });
}

export async function planFromIntakeArtifacts(
  rootDir: string,
  discovery: DiscoveryArtifact,
  intakeBrief: IntakeBrief,
  options?: { project?: string; priorLessons?: string[] },
): Promise<{ plan: PlanArtifact; manifest: IntakeToPlanManifest; manifestPath: string }> {
  const mergedDiscovery: DiscoveryArtifact = {
    ...discovery,
    risks: [...discovery.risks, ...risksFromIntakeBrief(intakeBrief)],
  };
  const plan = compilePlanFromIntake(mergedDiscovery, intakeBrief, options);
  const manifest = await writeIntakeToPlanManifest(rootDir, intakeBrief, plan);
  return { plan, manifest: manifest.manifest, manifestPath: manifest.manifestPath };
}
