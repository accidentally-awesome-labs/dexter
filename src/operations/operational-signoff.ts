import path from "node:path";
import fs from "fs-extra";
import { writeCrossMilestoneKpiReport } from "./cross-milestone-kpi.js";
import type { MilestoneGate } from "./milestone-signoff.js";

export interface OperationalSignoffReport {
  schemaVersion: "1.0";
  milestone: "operational";
  generatedAt: string;
  passed: boolean;
  gates: MilestoneGate[];
  kpi: {
    passed: boolean;
    reportPath: string;
  };
}

const signoffJsonPath = (rootDir: string) =>
  path.join(rootDir, "artifacts", "release", "OPERATIONAL_SIGNOFF.json");
const signoffMarkdownPath = (rootDir: string) =>
  path.join(rootDir, "artifacts", "release", "OPERATIONAL_SIGNOFF.md");

export async function generateOperationalSignoff(rootDir: string): Promise<OperationalSignoffReport> {
  const kpiReport = await writeCrossMilestoneKpiReport(rootDir);
  const kpiPath = path.join(rootDir, "artifacts", "release", "CROSS_MILESTONE_KPI.json");

  const gates: MilestoneGate[] = kpiReport.metrics.map((metric) => ({
    id: metric.id,
    description: metric.title,
    passed: metric.passed,
    detail: metric.detail,
  }));

  gates.push({
    id: "cross_milestone_kpi_artifact",
    description: "Cross-milestone KPI report generated",
    passed: await fs.pathExists(kpiPath),
    detail: kpiPath,
  });

  const passed = gates.every((gate) => gate.passed);
  const report: OperationalSignoffReport = {
    schemaVersion: "1.0",
    milestone: "operational",
    generatedAt: new Date().toISOString(),
    passed,
    gates,
    kpi: {
      passed: kpiReport.passed,
      reportPath: kpiPath,
    },
  };

  await fs.ensureDir(path.dirname(signoffJsonPath(rootDir)));
  await fs.writeJson(signoffJsonPath(rootDir), report, { spaces: 2 });
  await fs.writeFile(
    signoffMarkdownPath(rootDir),
    [
      "# Operational Signoff (Cross-Milestone KPIs)",
      "",
      `Generated at: ${report.generatedAt}`,
      `Passed: ${report.passed}`,
      "",
      "## KPI Gates",
      ...report.gates.map((gate) => `- [${gate.passed ? "x" : " "}] ${gate.description} — ${gate.detail}`),
      "",
      report.passed
        ? "Dexter meets cross-milestone KPI targets for fully operational status."
        : "One or more KPI targets are not met. Re-run `npm run operational:signoff` after remediation.",
      "",
    ].join("\n"),
  );

  return report;
}
