import path from "node:path";
import dotenv from "dotenv";
import { runClosedLoopE2e } from "../operations/closed-loop-e2e.js";

dotenv.config();

function parseArg(flag: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0 || index + 1 >= process.argv.length) {
    return fallback;
  }
  return process.argv[index + 1];
}

function parseBool(flag: string, fallback: boolean): boolean {
  const value = parseArg(flag);
  if (value === undefined) {
    return fallback;
  }
  return value === "true";
}

async function main(): Promise<void> {
  const rootDir = path.resolve(parseArg("--root-dir", process.cwd()) ?? process.cwd());
  const report = await runClosedLoopE2e({
    rootDir,
    project: parseArg("--project", process.env.DEXTER_COOLIFY_APP_NAME ?? "dexter"),
    idea: parseArg("--idea"),
    constraints: parseArg("--constraints", "self-hosted,policy-gated,api-deploy")
      ?.split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    skipPreflight: parseBool("--skip-preflight", false),
    strictHealth: parseBool("--strict-health", process.env.DEXTER_E2E_STRICT_HEALTH !== "false"),
  });

  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        runId: report.runId,
        deploymentMode: report.deploymentMode,
        deploymentId: report.deploymentId,
        healthUrl: report.health.url,
        reportPath: path.join(rootDir, "artifacts", "release", "CLOSED_LOOP_E2E.json"),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
