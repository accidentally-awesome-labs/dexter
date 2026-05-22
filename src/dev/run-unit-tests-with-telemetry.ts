import path from "node:path";
import { spawn } from "node:child_process";
import fs from "fs-extra";
import { ingestVitestReport, vitestReportPath } from "../verification/test-telemetry.js";

async function runVitest(args: string[]): Promise<number> {
  const rootDir = process.cwd();
  const reportPath = vitestReportPath(rootDir);
  await fs.ensureDir(path.dirname(reportPath));
  const quotedArgs = args.map((item) => `'${item.replace(/'/g, `'\\''`)}'`).join(" ");
  const command = [
    "npx vitest run",
    "--reporter=default",
    `--reporter=json --outputFile='${reportPath}'`,
    quotedArgs,
  ]
    .filter(Boolean)
    .join(" ");

  return new Promise((resolve, reject) => {
    const child = spawn("sh", ["-lc", command], {
      stdio: "inherit",
      env: process.env,
      cwd: rootDir,
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function main() {
  const rootDir = process.cwd();
  const vitestArgs = process.argv.slice(2);
  const vitestExitCode = await runVitest(vitestArgs);
  const { flaky, effectiveExitCode } = await ingestVitestReport(rootDir, {
    exitCode: vitestExitCode,
    source: "unit",
  });

  console.log(
    JSON.stringify(
      {
        vitestExitCode,
        effectiveExitCode,
        telemetryPath: path.join(rootDir, "artifacts", "verification", "TEST_TELEMETRY.json"),
        flakyCandidatesPath: path.join(rootDir, "artifacts", "verification", "FLAKY_CANDIDATES.json"),
        quarantinePath: path.join(rootDir, "artifacts", "verification", "FLAKY_QUARANTINE.json"),
        trackedTests: flaky.totalTrackedTests,
        flakyCandidates: flaky.flakyCandidateCount,
      },
      null,
      2,
    ),
  );

  process.exit(effectiveExitCode);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
