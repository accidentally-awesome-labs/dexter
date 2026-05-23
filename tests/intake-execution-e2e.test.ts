import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, describe, expect, it } from "vitest";
import { buildResumeCheck } from "../src/core/run-selector.js";
import { runDexterFromIntakeArtifacts } from "../src/intake/run-from-intake.js";
import { normalizeFromCliPrompt } from "../src/intake/normalize.js";
import { processIntakeBrief } from "../src/intake/process-intake.js";
import { verifyIntakeExecutionCoherence } from "../src/intake/execution-coherence.js";

async function seedHooks(rootDir: string) {
  const hooksDir = path.join(rootDir, "infra", "coolify", "hooks");
  await fs.ensureDir(hooksDir);
  await fs.writeFile(path.join(hooksDir, "deploy.sh"), "#!/usr/bin/env sh\necho deploy\n");
  await fs.writeFile(path.join(hooksDir, "rollback.sh"), "#!/usr/bin/env sh\necho rollback\n");
}

function isolateIntakeDeployEnv(): void {
  delete process.env.DEXTER_COOLIFY_API_URL;
  delete process.env.DEXTER_COOLIFY_TOKEN;
  delete process.env.DEXTER_BRIDGE_TOKEN;
  delete process.env.DEXTER_REQUIRE_API_DEPLOY;
  delete process.env.COOLIFY_ORIGIN;
  delete process.env.COOLIFY_API_TOKEN;
}

describe("intake to execution end-to-end", () => {
  afterEach(() => {
    delete process.env.DEXTER_AUTO_APPROVE_HITL;
    delete process.env.DEXTER_SKIP_CLARIFICATION_GATE;
    isolateIntakeDeployEnv();
  });

  it("runs from intake artifacts through execution and run summary", async () => {
    isolateIntakeDeployEnv();
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-intake-exec-"));
    await seedHooks(rootDir);
    process.env.DEXTER_AUTO_APPROVE_HITL = "true";
    process.env.DEXTER_SKIP_CLARIFICATION_GATE = "true";

    const brief = normalizeFromCliPrompt({
      project: "sample-app",
      idea: "Build a deterministic execution pipeline with stable planning outputs and policy checks.",
      constraints: ["self-hosted-first", "type-safe"],
      targetUsers: ["engineers"],
    });
    await processIntakeBrief(rootDir, brief);

    const result = await runDexterFromIntakeArtifacts(rootDir, { skipClarificationGate: true });
    const runDir = path.join(rootDir, "runs", result.runId);
    const runSummary = await fs.readJson(path.join(runDir, "run_summary.json"));
    const intakeManifest = await fs.readJson(path.join(runDir, "intake_execution_manifest.json"));
    const taskGraph = await fs.readJson(path.join(rootDir, "artifacts", "planning", "TASK_GRAPH.json"));

    expect(runSummary.intake?.intakeId).toBe(brief.intakeId);
    expect(typeof runSummary.intake?.riskScore).toBe("number");
    expect(runSummary.intake?.tasksRoutedToHitl).toBeGreaterThan(0);
    expect(typeof runSummary.intakeExecutionCoherent).toBe("boolean");
    expect(intakeManifest.runId).toBe(result.runId);
    expect(intakeManifest.coherence.passed).toBe(runSummary.intakeExecutionCoherent);
    expect(taskGraph.every((task: { riskPriority?: unknown; routing?: unknown }) => task.riskPriority && task.routing)).toBe(
      true,
    );
  }, 30_000);

  it("keeps escalations coherent with high-risk HITL routing", async () => {
    isolateIntakeDeployEnv();
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-intake-exec-risk-"));
    await seedHooks(rootDir);
    process.env.DEXTER_AUTO_APPROVE_HITL = "true";
    process.env.DEXTER_SKIP_CLARIFICATION_GATE = "true";

    const brief = normalizeFromCliPrompt({
      project: "payments",
      idea: "Patch production authentication outage with PCI scope, customer-facing billing impact, and urgent incident response.",
      constraints: ["SOC2"],
      targetUsers: ["oncall-team"],
    });
    await processIntakeBrief(rootDir, brief);

    const result = await runDexterFromIntakeArtifacts(rootDir, { skipClarificationGate: true });
    const runDir = path.join(rootDir, "runs", result.runId);
    const taskGraph = await fs.readJson(path.join(rootDir, "artifacts", "planning", "TASK_GRAPH.json"));
    const execution = await fs.readJson(path.join(runDir, "execution_results.json"));
    const runSummary = await fs.readJson(path.join(runDir, "run_summary.json"));

    expect(brief.riskPriority.highRisk).toBe(true);
    expect(taskGraph.every((task: { routing?: { routedMode?: string } }) => task.routing?.routedMode === "HITL")).toBe(
      true,
    );

    const coherence = verifyIntakeExecutionCoherence({
      intake: brief,
      tasks: taskGraph,
      execution,
      runStatus: runSummary.runStatus,
      unresolvedRequired: runSummary.requiredEscalations ?? 0,
      operatorHighEscalations: runSummary.operatorHighEscalations ?? 0,
    });
    expect(coherence.passed).toBe(true);

    const resume = await buildResumeCheck(rootDir, result.runId);
    expect(resume.runId).toBe(result.runId);
    expect(resume.runStatus).toBeTruthy();
  }, 60_000);
});
