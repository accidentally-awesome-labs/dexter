import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { runDexter } from "../src/core/orchestrator.js";
import { compilePlanFromIntake, planFromIntakeArtifacts } from "../src/intake/plan-from-intake.js";
import { normalizeFromCliPrompt } from "../src/intake/normalize.js";
import { processIntakeBrief } from "../src/intake/process-intake.js";
import { validateTaskGraph } from "../src/skills/planning/graph-validator.js";

const discovery = {
  brief: "Discovery brief for intake-to-plan wiring.",
  glossary: {},
  marketEvidence: [],
  risks: [],
};

describe("intake to plan wiring", () => {
  it("produces task graph metadata from intake brief", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-intake-plan-"));
    const brief = normalizeFromCliPrompt({
      project: "payments",
      idea: "Patch production authentication outage with PCI scope, customer-facing billing impact, and urgent incident response.",
      constraints: ["SOC2"],
      targetUsers: ["oncall-team"],
    });
    await processIntakeBrief(rootDir, brief);

    const { plan, manifest } = await planFromIntakeArtifacts(rootDir, discovery, brief, {
      project: "payments",
    });

    expect(manifest.tasksWithRiskPriority).toBe(plan.tasks.length);
    expect(manifest.tasksRoutedToHitl).toBeGreaterThan(0);
    expect(plan.tasks.every((task) => task.riskPriority)).toBe(true);
    expect(plan.tasks.every((task) => task.routing)).toBe(true);

    const validation = validateTaskGraph(plan.tasks);
    expect(validation.valid).toBe(true);

    expect(plan.tasks[0]?.riskPriority?.riskScore).toBeGreaterThan(0);
    expect(await fs.pathExists(path.join(rootDir, "artifacts", "intake", "INTAKE_TO_PLAN_MANIFEST.json"))).toBe(
      true,
    );
  });

  it("is deterministic for fixed intake input", () => {
    const brief = normalizeFromCliPrompt({
      project: "sample-app",
      idea: "Build a deterministic execution pipeline with stable planning outputs.",
      constraints: ["self-hosted-first"],
      targetUsers: ["engineers"],
    });

    const first = compilePlanFromIntake(discovery, brief, { project: "sample-app" });
    const second = compilePlanFromIntake(discovery, brief, { project: "sample-app" });

    expect(JSON.stringify(first.tasks)).toBe(JSON.stringify(second.tasks));
  });

  it("keeps replay-stable planning outputs across orchestrator runs", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-intake-replay-"));
    const hooksDir = path.join(rootDir, "infra", "coolify", "hooks");
    await fs.ensureDir(hooksDir);
    await fs.writeFile(path.join(hooksDir, "deploy.sh"), "#!/usr/bin/env sh\necho deploy\n");
    await fs.writeFile(path.join(hooksDir, "rollback.sh"), "#!/usr/bin/env sh\necho rollback\n");

    process.env.DEXTER_AUTO_APPROVE_HITL = "true";
    process.env.DEXTER_SKIP_CLARIFICATION_GATE = "true";

    const input = {
      project: "sample-app",
      idea: "Build a deterministic execution pipeline",
      constraints: ["self-hosted-first"],
      targetUsers: ["engineers"],
    };

    await runDexter(rootDir, input);
    const firstTaskGraph = await fs.readJson(path.join(rootDir, "artifacts", "planning", "TASK_GRAPH.json"));
    const firstManifest = await fs.readJson(path.join(rootDir, "artifacts", "intake", "INTAKE_TO_PLAN_MANIFEST.json"));

    await runDexter(rootDir, input);
    const secondTaskGraph = await fs.readJson(path.join(rootDir, "artifacts", "planning", "TASK_GRAPH.json"));
    const secondManifest = await fs.readJson(path.join(rootDir, "artifacts", "intake", "INTAKE_TO_PLAN_MANIFEST.json"));

    expect(JSON.stringify(secondTaskGraph)).toBe(JSON.stringify(firstTaskGraph));
    expect(secondManifest.taskCount).toBe(firstManifest.taskCount);
    expect(secondManifest.tasksWithRiskPriority).toBe(firstManifest.tasksWithRiskPriority);
    expect(secondManifest.tasksRoutedToHitl).toBe(firstManifest.tasksRoutedToHitl);
  }, 30_000);
});
