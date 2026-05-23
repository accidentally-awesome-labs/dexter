import path from "node:path";
import fs from "fs-extra";
import { runIntakePilotBatch } from "../intake/pilot-batch.js";

async function seedHooks(rootDir: string) {
  const hooksDir = path.join(rootDir, "infra", "coolify", "hooks");
  await fs.ensureDir(hooksDir);
  await fs.writeFile(path.join(hooksDir, "deploy.sh"), "#!/usr/bin/env sh\necho deploy\n");
  await fs.writeFile(path.join(hooksDir, "rollback.sh"), "#!/usr/bin/env sh\necho rollback\n");
}

function parseIntArg(flag: string): number | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) {
    return undefined;
  }
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) ? value : undefined;
}

async function main() {
  const rootDir = process.cwd();
  const fullRun = process.argv.includes("--full-run");
  const skipClarificationGate =
    process.argv.includes("--skip-clarification-gate") ||
    process.env.DEXTER_SKIP_CLARIFICATION_GATE === "true";
  const requestOffset = parseIntArg("--offset");
  const requestLimit = parseIntArg("--limit");
  const batchIdIndex = process.argv.indexOf("--batch");
  const batchId =
    batchIdIndex !== -1 && batchIdIndex + 1 < process.argv.length
      ? process.argv[batchIdIndex + 1]
      : undefined;

  if (fullRun) {
    process.env.DEXTER_AUTO_APPROVE_HITL = "true";
    await seedHooks(rootDir);
  }

  const { reportPath, markdownPath, report } = await runIntakePilotBatch(rootDir, {
    fullRun,
    skipClarificationGate,
    requestOffset,
    requestLimit,
    batchId,
  });

  if (!report.evaluation.passed) {
    console.error(
      JSON.stringify(
        {
          reportPath,
          markdownPath,
          evaluation: report.evaluation,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        reportPath,
        markdownPath,
        requestsTotal: report.requestsTotal,
        autoDecompositionRate: report.evaluation.autoDecompositionRate,
        highRiskHitlPassed: report.evaluation.highRiskHitlPassed,
        passed: report.evaluation.passed,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
