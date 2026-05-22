import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { writeCrossMilestoneKpiReport } from "../src/operations/cross-milestone-kpi.js";
import { seedCrossMilestoneFixtures } from "./helpers/seed-cross-milestone-fixtures.js";

describe("cross-milestone KPI", () => {
  it("passes autonomy and reliability using committed fixtures", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-cross-kpi-"));
    await seedCrossMilestoneFixtures(rootDir);

    const report = await writeCrossMilestoneKpiReport(rootDir);
    const autonomy = report.metrics.find((metric) => metric.id === "autonomy");
    const reliability = report.metrics.find((metric) => metric.id === "reliability");
    const safety = report.metrics.find((metric) => metric.id === "safety");
    expect(autonomy?.passed).toBe(true);
    expect(reliability?.passed).toBe(true);
    expect(safety?.passed).toBe(true);

    await fs.remove(rootDir);
  });
});
