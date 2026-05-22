import path from "node:path";
import fs from "fs-extra";
import { loadSoakStatus, statusPath, statusMarkdownPath, toSoakStatusMarkdown } from "../release/run-soak-cycle.js";
import { pruneSoakHistoryAfter, recalculateSoakStatusFromHistory } from "../release/soak-metrics.js";
import { updateSoakTrends } from "../release/soak-trends.js";
import { updateSoakReliability } from "../release/soak-reliability.js";
import { writeReliabilityKpiReport } from "../release/reliability-kpi.js";
import type { SoakStatus } from "../release/soak-types.js";

function parseArg(flag: string, fallback = ""): string {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? (process.argv[idx + 1] ?? fallback) : fallback;
}

async function main() {
  const rootDir = process.cwd();
  const targetStreak = Math.max(1, Number.parseInt(parseArg("--target-streak", "30"), 10) || 30);
  const pruneAfter = parseArg("--prune-after", "");
  const existing = await loadSoakStatus(rootDir, targetStreak);
  let status: SoakStatus = existing;
  if (pruneAfter) {
    const prunedHistory = pruneSoakHistoryAfter(existing.history, pruneAfter).slice(-200);
    const recalculated = recalculateSoakStatusFromHistory(prunedHistory, targetStreak);
    status = {
      schemaVersion: "1.0",
      targetStreak,
      history: prunedHistory,
      ...recalculated,
    };
    await fs.writeJson(statusPath(rootDir), status, { spaces: 2 });
    await fs.writeFile(statusMarkdownPath(rootDir), toSoakStatusMarkdown(status));
  }

  const { trendsPath, trends } = await updateSoakTrends(rootDir, status);
  const reliability = await updateSoakReliability(rootDir, { trends, status });
  const kpi = await writeReliabilityKpiReport(rootDir);

  console.log(
    JSON.stringify(
      {
        prunedAfter: pruneAfter,
        statusPath: statusPath(rootDir),
        totalCycles: status.totalCycles,
        longestStreak: status.longestStreak,
        currentStreak: status.currentStreak,
        trendsPath,
        rolling100PassRate: trends.rolling100.passRate,
        reliabilityStatus: reliability.report.reliabilityStatus,
        kpiGatesPassed: kpi.report.kpi.gatesPassed,
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
