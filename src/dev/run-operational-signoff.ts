import path from "node:path";
import { generateOperationalSignoff } from "../operations/operational-signoff.js";

async function main(): Promise<void> {
  const rootDir = process.cwd();
  const report = await generateOperationalSignoff(rootDir);
  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        failedGates: report.gates.filter((gate) => !gate.passed).map((gate) => gate.id),
        kpiReportPath: report.kpi.reportPath,
        reportPath: path.join(rootDir, "artifacts", "release", "OPERATIONAL_SIGNOFF.json"),
      },
      null,
      2,
    ),
  );
  if (!report.passed) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
