import path from "node:path";
import fs from "fs-extra";
import { generateGoNoGoDecision } from "../release/generate-go-no-go.js";
import { loadSoakStatus } from "../release/run-soak-cycle.js";
import {
  evaluateWeeklyPassRateTrend,
  maxConsecutivePassStreak,
  trailingConsecutivePassStreak,
} from "../release/soak-metrics.js";
import { loadSoakReliabilityReport } from "../release/soak-reliability.js";
import { loadSoakTrends, soakTrendsPath } from "../release/soak-trends.js";
import {
  loadReliabilityKpiReport,
  reliabilityKpiJsonPath,
  reliabilityKpiMarkdownPath,
} from "../release/reliability-kpi.js";
import { writeReliabilityKpiReport } from "../release/reliability-kpi.js";
import { failureTaxonomyMarkdownPath } from "../verification/failure-taxonomy.js";
import { regressionPreventionIndexPath } from "../verification/regression-prevention.js";
import type { MilestoneGate } from "./milestone-signoff.js";
import { loadMilestone3SignoffPolicy } from "./milestone-3-signoff-policy.js";

export interface Milestone3SignoffReport {
  schemaVersion: "1.0";
  milestone: "M3";
  generatedAt: string;
  passed: boolean;
  gates: MilestoneGate[];
  soak: {
    totalCycles: number;
    maxConsecutivePasses: number;
    trailingConsecutivePasses: number;
    currentStreak: number;
  };
}

const signoffJsonPath = (rootDir: string) => path.join(rootDir, "artifacts", "release", "MILESTONE_3_SIGNOFF.json");
const signoffMarkdownPath = (rootDir: string) => path.join(rootDir, "artifacts", "release", "MILESTONE_3_SIGNOFF.md");

async function fileExists(rootDir: string, relPath: string): Promise<boolean> {
  return fs.pathExists(path.join(rootDir, relPath));
}

export async function generateMilestone3Signoff(rootDir: string): Promise<Milestone3SignoffReport> {
  const policy = await loadMilestone3SignoffPolicy(rootDir);
  const gates: MilestoneGate[] = [];

  const soakStatus = await loadSoakStatus(rootDir, 30);
  const maxStreak = maxConsecutivePassStreak(soakStatus.history);
  const trailingStreak = trailingConsecutivePassStreak(soakStatus.history);

  const consecutivePassesMet =
    maxStreak >= policy.minConsecutiveSoakPasses ||
    soakStatus.longestStreak >= policy.minConsecutiveSoakPasses;
  gates.push({
    id: "soak_consecutive_passes",
    description: `${policy.minConsecutiveSoakPasses}+ consecutive soak passes without failure`,
    passed: consecutivePassesMet,
    detail: `maxConsecutive=${maxStreak}, longestStreak=${soakStatus.longestStreak}, trailing=${trailingStreak}, required>=${policy.minConsecutiveSoakPasses}`,
  });

  gates.push({
    id: "soak_total_cycles",
    description: `${policy.minTotalSoakCycles}+ total soak cycles recorded`,
    passed: soakStatus.totalCycles >= policy.minTotalSoakCycles,
    detail: `totalCycles=${soakStatus.totalCycles}, required>=${policy.minTotalSoakCycles}`,
  });

  const reliability = await loadSoakReliabilityReport(rootDir);
  const criticalWarnings = reliability?.warnings.filter((warning) => warning.severity === "critical").length ?? 0;
  gates.push({
    id: "no_critical_soak_blocker",
    description: "No critical soak reliability blocker",
    passed: (reliability?.reliabilityStatus ?? "unknown") !== "critical" && criticalWarnings === 0,
    detail: `reliabilityStatus=${reliability?.reliabilityStatus ?? "missing"}, criticalWarnings=${criticalWarnings}`,
  });

  const trends = await loadSoakTrends(rootDir);
  gates.push({
    id: "soak_trends_artifact",
    description: "Soak trend rollups persisted",
    passed: (await fs.pathExists(soakTrendsPath(rootDir))) || Boolean(trends),
    detail: trends ? `rolling100=${trends.rolling100.passRate}` : "SOAK_TRENDS.json missing",
  });

  const weeklyTrend = evaluateWeeklyPassRateTrend(trends);
  gates.push({
    id: "weekly_pass_rate_trend",
    description: "Repeat-failure pressure not increasing week-over-week (pass rate non-declining)",
    passed: policy.requireWeeklyPassRateNonDeclining ? weeklyTrend.passed : true,
    detail: weeklyTrend.detail,
  });

  const taxonomyMd = await fileExists(rootDir, "artifacts/verification/FAILURE_TAXONOMY.md");
  gates.push({
    id: "failure_taxonomy",
    description: "Failure taxonomy report available",
    passed: taxonomyMd,
    detail: taxonomyMd ? failureTaxonomyMarkdownPath(rootDir) : "FAILURE_TAXONOMY.md missing",
  });

  const memoryQualityPolicy = await fileExists(rootDir, "docs/operations/MEMORY_QUALITY_POLICY.json");
  gates.push({
    id: "memory_quality_controls",
    description: "Stale lesson decay policy configured",
    passed: memoryQualityPolicy,
    detail: memoryQualityPolicy ? "MEMORY_QUALITY_POLICY.json present" : "Missing memory quality policy",
  });

  const memoryContradictionPolicy = await fileExists(rootDir, "docs/operations/MEMORY_CONTRADICTION_POLICY.json");
  gates.push({
    id: "memory_contradiction_controls",
    description: "Contradiction checks policy configured",
    passed: memoryContradictionPolicy,
    detail: memoryContradictionPolicy
      ? "MEMORY_CONTRADICTION_POLICY.json present"
      : "Missing memory contradiction policy",
  });

  const flakyPolicy = await fileExists(rootDir, "docs/operations/FLAKY_TEST_POLICY.json");
  const quarantinePolicy = await fileExists(rootDir, "docs/operations/FLAKY_QUARANTINE_POLICY.json");
  gates.push({
    id: "flaky_quarantine_policy",
    description: "Flaky detection and quarantine policies configured",
    passed: flakyPolicy && quarantinePolicy,
    detail: `flakyTest=${flakyPolicy}, quarantine=${quarantinePolicy}`,
  });

  const regressionPolicy = await fileExists(rootDir, "docs/operations/REGRESSION_PREVENTION_TEMPLATES.json");
  const regressionIndex = await fs.pathExists(regressionPreventionIndexPath(rootDir));
  gates.push({
    id: "regression_prevention_templates",
    description: "Regression-prevention templates available",
    passed: regressionPolicy,
    detail: regressionPolicy
      ? `policy present, index=${regressionIndex ? "yes" : "pending first escalation"}`
      : "REGRESSION_PREVENTION_TEMPLATES.json missing",
  });

  const soakSchedulePolicy = await fileExists(rootDir, "docs/operations/SOAK_SCHEDULE_POLICY.json");
  gates.push({
    id: "continuous_soak_scheduling",
    description: "Continuous soak scheduling policy configured",
    passed: soakSchedulePolicy,
    detail: soakSchedulePolicy ? "SOAK_SCHEDULE_POLICY.json present" : "Missing soak schedule policy",
  });

  const existingKpi = await loadReliabilityKpiReport(rootDir);
  const kpi =
    existingKpi?.kpi.gatesPassed === true
      ? {
          jsonPath: reliabilityKpiJsonPath(rootDir),
          markdownPath: reliabilityKpiMarkdownPath(rootDir),
          report: existingKpi,
        }
      : await writeReliabilityKpiReport(rootDir);
  gates.push({
    id: "reliability_kpi_gates",
    description: "Reliability KPI acceptance gates satisfied",
    passed: kpi.report.kpi.gatesPassed,
    detail: `gatesPassed=${kpi.report.kpi.gatesPassed}, soakPassRate=${kpi.report.kpi.soakPassRate}, repeatFailure=${kpi.report.kpi.soakRepeatFailureRate}`,
  });

  const kpiArtifact = await fs.pathExists(reliabilityKpiJsonPath(rootDir));
  gates.push({
    id: "reliability_kpi_artifact",
    description: "Reliability KPI review artifact generated",
    passed: kpiArtifact,
    detail: kpiArtifact ? kpi.jsonPath : "RELIABILITY_KPI.json missing",
  });

  const release = await generateGoNoGoDecision(rootDir);
  gates.push({
    id: "release_decision_go",
    description: "Release decision is GO",
    passed: release.decision === "GO",
    detail: `decision=${release.decision}, unresolvedEscalations=${release.unresolvedEscalations}`,
  });

  const passed = gates.every((gate) => gate.passed);
  const report: Milestone3SignoffReport = {
    schemaVersion: "1.0",
    milestone: "M3",
    generatedAt: new Date().toISOString(),
    passed,
    gates,
    soak: {
      totalCycles: soakStatus.totalCycles,
      maxConsecutivePasses: maxStreak,
      trailingConsecutivePasses: trailingStreak,
      currentStreak: soakStatus.currentStreak,
    },
  };

  await fs.ensureDir(path.dirname(signoffJsonPath(rootDir)));
  await fs.writeJson(signoffJsonPath(rootDir), report, { spaces: 2 });
  await fs.writeFile(
    signoffMarkdownPath(rootDir),
    [
      "# Milestone 3 Signoff",
      "",
      "Reliability and learning at scale — acceptance for continuous soak operation.",
      "",
      `Generated at: ${report.generatedAt}`,
      `Passed: ${report.passed}`,
      "",
      "## Soak Streak",
      `- Total cycles: ${report.soak.totalCycles}`,
      `- Max consecutive passes: ${report.soak.maxConsecutivePasses}`,
      `- Trailing consecutive passes: ${report.soak.trailingConsecutivePasses}`,
      `- Current streak: ${report.soak.currentStreak}`,
      "",
      "## Acceptance Gates",
      ...report.gates.map((gate) => `- [${gate.passed ? "x" : " "}] ${gate.description} — ${gate.detail}`),
      "",
      "## Milestone 3 Accepted",
      report.passed
        ? "All reliability acceptance gates are satisfied. Milestone 3 is accepted."
        : "One or more gates failed. Resolve blockers and re-run `npm run milestone:m3:signoff`.",
      "",
    ].join("\n"),
  );

  return report;
}
