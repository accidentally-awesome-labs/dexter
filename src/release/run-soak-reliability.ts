import { loadSoakTrends } from "./soak-trends.js";
import { loadSoakStatus } from "./run-soak-cycle.js";
import { updateSoakReliability } from "./soak-reliability.js";
import { loadSoakSchedulePolicy } from "./soak-schedule-policy.js";

async function main() {
  const rootDir = process.cwd();
  const policy = await loadSoakSchedulePolicy(rootDir);
  const trends = await loadSoakTrends(rootDir);
  if (!trends) {
    throw new Error("SOAK_TRENDS.json not found. Run at least one soak cycle first.");
  }
  const status = await loadSoakStatus(rootDir, policy.targetStreak);
  const result = await updateSoakReliability(rootDir, { trends, status });
  console.log(
    JSON.stringify(
      {
        jsonPath: result.jsonPath,
        markdownPath: result.markdownPath,
        reliabilityStatus: result.report.reliabilityStatus,
        warningCount: result.report.warnings.length,
        passRateDelta: result.report.deltas.rolling100PassRate.delta,
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
