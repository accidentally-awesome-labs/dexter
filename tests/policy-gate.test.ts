import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { evaluatePolicyGate } from "../src/policy/gate.js";
import type { PlanArtifact } from "../src/protocols/types.js";
import { createApprovalRecord } from "../src/policy/approval.js";
import { generatePlanningSignatures, computePlanningSignatureDigest } from "../src/planning/signature.js";

const samplePlan: PlanArtifact = {
  prd: "prd",
  architecture: "arch",
  nfrSpec: "nfr",
  testStrategy: "tests",
  tasks: [
    {
      id: "t1",
      title: "HITL task",
      description: "requires approval",
      mode: "HITL",
      dependencies: [],
      acceptanceCriteria: ["approved"],
      nfrTags: ["governance"],
    },
  ],
};

describe("policy gate", () => {
  async function seedPlanning(rootDir: string) {
    const planningDir = path.join(rootDir, "artifacts", "planning");
    await fs.ensureDir(planningDir);
    await fs.writeFile(path.join(planningDir, "PRD.md"), "prd");
    await fs.writeFile(path.join(planningDir, "TASK_GRAPH.json"), "{\"tasks\":[]}");
    await fs.writeFile(path.join(planningDir, "ARCHITECTURE_SPEC.md"), "arch");
    await fs.writeFile(path.join(planningDir, "NFR_SPEC.md"), "nfr");
    await fs.writeFile(path.join(planningDir, "TEST_STRATEGY.md"), "tests");
    await generatePlanningSignatures(rootDir);
  }

  it("blocks when HITL approval and hooks are missing", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-policy-"));
    await seedPlanning(rootDir);
    const decision = await evaluatePolicyGate({
      rootDir,
      idea: {
        project: "alpha",
        idea: "build system",
        constraints: [],
        targetUsers: [],
      },
      plan: samplePlan,
      controlPlane: "coolify",
    });

    expect(decision.approved).toBe(false);
    expect(decision.blockers.join(" ")).toContain("approvals.json");
    expect(decision.blockers.join(" ")).toContain("Missing rollback hook");
    expect(decision.blockers.join(" ")).toContain("Missing deploy hook");
  });

  it("approves when approvals and hooks exist", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-policy-ok-"));
    await seedPlanning(rootDir);
    await fs.ensureDir(path.join(rootDir, "infra", "coolify", "hooks"));
    await fs.writeFile(path.join(rootDir, "infra", "coolify", "hooks", "deploy.sh"), "echo deploy\n");
    await fs.writeFile(path.join(rootDir, "infra", "coolify", "hooks", "rollback.sh"), "echo rollback\n");
    await fs.ensureDir(path.join(rootDir, "state", "alpha"));
    const planDigest = await computePlanningSignatureDigest(rootDir);
    if (!planDigest) {
      throw new Error("missing plan digest");
    }
    await fs.writeJson(
      path.join(rootDir, "state", "alpha", "approvals.json"),
      createApprovalRecord("alpha", planDigest, "dexter-dev-signing-key", { approvedBy: "qa-user" }),
    );

    const decision = await evaluatePolicyGate({
      rootDir,
      idea: {
        project: "alpha",
        idea: "build system",
        constraints: [],
        targetUsers: [],
      },
      plan: samplePlan,
      controlPlane: "coolify",
    });

    expect(decision.approved).toBe(true);
    expect(decision.blockers).toHaveLength(0);
  });
});
