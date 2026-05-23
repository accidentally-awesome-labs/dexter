import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { runIncidentSimulations } from "../operations/incident-simulations.js";

async function main(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-incident-sim-"));
  const report = await runIncidentSimulations(rootDir, process.cwd());
  console.log(
    JSON.stringify(
      {
        reportPath: path.join(rootDir, "artifacts", "release", "INCIDENT_SIMULATION_REPORT.json"),
        ...report,
      },
      null,
      2,
    ),
  );
  await fs.remove(rootDir);
  if (!report.passed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
