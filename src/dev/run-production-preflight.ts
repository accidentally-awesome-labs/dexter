import path from "node:path";
import {
  runProductionPreflight,
  writeProductionPreflightArtifacts,
} from "../operations/production-preflight.js";
import type { DeploymentProviderId } from "../providers/deployment/types.js";

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
  const controlPlane = (parseArg("--control-plane", "coolify") ?? "coolify") as DeploymentProviderId;
  const report = await runProductionPreflight({
    rootDir,
    controlPlane,
    requireApiProbe: parseBool("--probe-api", true),
    requireAlerts: parseBool("--require-alerts", false),
    strictSecrets: parseBool("--strict-secrets", false),
  });
  const artifacts = await writeProductionPreflightArtifacts(rootDir, report);
  console.log(JSON.stringify({ passed: report.passed, artifacts }, null, 2));
  for (const check of report.checks) {
    const status = check.passed ? "PASS" : "FAIL";
    console.log(`${status} [${check.severity}] ${check.id}: ${check.detail}`);
  }
  if (!report.passed) {
    console.error("\nProduction preflight failed. See artifacts/release/PRODUCTION_PREFLIGHT.md");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
