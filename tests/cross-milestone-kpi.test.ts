import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { writeCrossMilestoneKpiReport } from "../src/operations/cross-milestone-kpi.js";

describe("cross-milestone KPI", () => {
  it("passes autonomy and reliability using pilot and soak fixtures", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-cross-kpi-"));
    await fs.copy(path.join(process.cwd(), "docs"), path.join(rootDir, "docs"));
    await fs.ensureDir(path.join(rootDir, "artifacts/intake/pilot-batch"));
    await fs.copy(
      path.join(process.cwd(), "artifacts/intake/pilot-batch/PILOT_BATCH_REPORT.json"),
      path.join(rootDir, "artifacts/intake/pilot-batch/PILOT_BATCH_REPORT.json"),
    );
    await fs.copy(
      path.join(process.cwd(), "artifacts/release/SOAK_TRENDS.json"),
      path.join(rootDir, "artifacts/release/SOAK_TRENDS.json"),
    );
    await fs.ensureDir(path.join(rootDir, "artifacts/release/promotions"));
    await fs.copy(
      path.join(process.cwd(), "artifacts/release/PROMOTION_HISTORY.json"),
      path.join(rootDir, "artifacts/release/PROMOTION_HISTORY.json"),
    );
    for (const file of await fs.readdir(path.join(process.cwd(), "artifacts/release/promotions"))) {
      await fs.copy(
        path.join(process.cwd(), "artifacts/release/promotions", file),
        path.join(rootDir, "artifacts/release/promotions", file),
      );
    }
    await fs.ensureDir(path.join(rootDir, "artifacts/execution"));
    await fs.writeJson(path.join(rootDir, "artifacts/execution/ESCALATION_STATE.json"), {
      generatedAt: new Date().toISOString(),
      items: [],
    });

    const report = await writeCrossMilestoneKpiReport(rootDir);
    const autonomy = report.metrics.find((metric) => metric.id === "autonomy");
    const reliability = report.metrics.find((metric) => metric.id === "reliability");
    expect(autonomy?.passed).toBe(true);
    expect(reliability?.passed).toBe(true);

    await fs.remove(rootDir);
  });
});
