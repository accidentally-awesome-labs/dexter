import { writeReliabilityKpiReport } from "./reliability-kpi.js";

async function main() {
  const rootDir = process.cwd();
  const result = await writeReliabilityKpiReport(rootDir);
  console.log(
    JSON.stringify(
      {
        jsonPath: result.jsonPath,
        markdownPath: result.markdownPath,
        gatesPassed: result.report.kpi.gatesPassed,
        soakPassRate: result.report.kpi.soakPassRate,
        soakRepeatFailureRate: result.report.kpi.soakRepeatFailureRate,
        topRisks: result.report.topRisks.map((risk) => risk.taxonomyClass),
        mitigationBacklog: result.report.mitigationBacklog.map((item) => ({
          priority: item.priority,
          failureClass: item.failureClass,
          owner: item.owner,
        })),
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
