import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import { generateMilestone3Signoff } from "../operations/milestone-3-signoff.js";
import { loadSoakStatus, statusPath } from "../release/run-soak-cycle.js";
import { updateSoakReliability } from "../release/soak-reliability.js";
import { updateSoakTrends } from "../release/soak-trends.js";
import { writeReliabilityKpiReport } from "../release/reliability-kpi.js";

async function restoreSoakStatusFromGit(rootDir: string): Promise<void> {
  const raw = execFileSync("git", ["show", "HEAD:artifacts/release/SOAK_STATUS.json"], {
    cwd: rootDir,
    encoding: "utf8",
  });
  const status = JSON.parse(raw) as Awaited<ReturnType<typeof loadSoakStatus>>;
  await fs.writeJson(statusPath(rootDir), status, { spaces: 2 });
}

async function main() {
  const rootDir = process.cwd();
  await restoreSoakStatusFromGit(rootDir);
  const status = await loadSoakStatus(rootDir, 30);
  await updateSoakTrends(rootDir, status);
  await updateSoakReliability(rootDir);
  await writeReliabilityKpiReport(rootDir);
  const report = await generateMilestone3Signoff(rootDir);
  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        failedGates: report.gates.filter((gate) => !gate.passed).map((gate) => gate.id),
        soak: report.soak,
        reportPath: path.join(rootDir, "artifacts", "release", "MILESTONE_3_SIGNOFF.json"),
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
