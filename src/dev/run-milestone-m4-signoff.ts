import path from "node:path";
import { generateMilestone4Signoff } from "../operations/milestone-4-signoff.js";

async function main(): Promise<void> {
  const rootDir = process.cwd();
  const report = await generateMilestone4Signoff(rootDir);
  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        failedGates: report.gates.filter((gate) => !gate.passed).map((gate) => gate.id),
        diagnosisMs: report.diagnosis.durationMs,
        incidentSimulations: report.incidentSimulations,
        reportPath: path.join(rootDir, "artifacts", "release", "MILESTONE_4_SIGNOFF.json"),
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
