import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { generateOperationalSignoff } from "../src/operations/operational-signoff.js";
import { seedCrossMilestoneFixtures } from "./helpers/seed-cross-milestone-fixtures.js";

describe("operational signoff", () => {
  it("writes operational signoff from KPI metrics", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-operational-signoff-"));
    await seedCrossMilestoneFixtures(rootDir);

    const report = await generateOperationalSignoff(rootDir);
    expect(report.passed).toBe(true);
    expect(report.gates.length).toBeGreaterThan(0);
    expect(await fs.pathExists(path.join(rootDir, "artifacts/release/OPERATIONAL_SIGNOFF.json"))).toBe(
      true,
    );

    await fs.remove(rootDir);
  });
});
