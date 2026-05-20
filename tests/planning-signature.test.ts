import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { generatePlanningSignatures, verifyPlanningSignatures } from "../src/planning/signature.js";

async function seedPlanning(rootDir: string) {
  const dir = path.join(rootDir, "artifacts", "planning");
  await fs.ensureDir(dir);
  await fs.writeFile(path.join(dir, "PRD.md"), "prd");
  await fs.writeFile(path.join(dir, "TASK_GRAPH.json"), "{\"tasks\":[]}");
  await fs.writeFile(path.join(dir, "ARCHITECTURE_SPEC.md"), "arch");
  await fs.writeFile(path.join(dir, "NFR_SPEC.md"), "nfr");
  await fs.writeFile(path.join(dir, "TEST_STRATEGY.md"), "tests");
}

describe("planning signatures", () => {
  it("verifies generated planning signatures", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-plan-sign-"));
    await seedPlanning(rootDir);
    await generatePlanningSignatures(rootDir);
    await expect(verifyPlanningSignatures(rootDir)).resolves.toBe(true);
  });

  it("fails when planning artifact is tampered", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-plan-tamper-"));
    await seedPlanning(rootDir);
    await generatePlanningSignatures(rootDir);
    await fs.writeFile(path.join(rootDir, "artifacts", "planning", "PRD.md"), "mutated");
    await expect(verifyPlanningSignatures(rootDir)).resolves.toBe(false);
  });
});
