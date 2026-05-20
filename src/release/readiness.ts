import path from "node:path";
import fs from "fs-extra";

export interface ReadinessCheck {
  path: string;
  present: boolean;
}

export const requiredReadinessPaths = [
  "docs/security/SECURITY_BASELINE.md",
  "docs/security/THREAT_MODEL_TEMPLATE.md",
  "docs/security/ATTESTATION_KEY_ROTATION_POLICY.md",
  "docs/specs/AUTONOMY_POLICY.md",
  "docs/specs/DEPLOY_AUTH_POLICY.json",
  "docs/specs/DEPLOY_AUTH_POLICY.bundle.json",
  "docs/specs/STACK_MATRIX_V1.md",
  "docs/operations/SLO_TEMPLATE.md",
  "docs/operations/INCIDENT_RUNBOOK.md",
  "docs/operations/DR_PLAYBOOK.md",
  "artifacts/discovery/BRIEF.md",
  "artifacts/discovery/GLOSSARY.md",
  "artifacts/discovery/MARKET_EVIDENCE.md",
  "artifacts/discovery/RISK_REGISTER.md",
  "artifacts/planning/PRD.md",
  "artifacts/planning/TASK_GRAPH.json",
  "artifacts/planning/TEST_STRATEGY.md",
  "artifacts/planning/NFR_SPEC.md",
  "artifacts/planning/PLANNING_SIGNATURES.json",
  "artifacts/verification/VERIFICATION_REPORT.md",
  "artifacts/verification/ROLLBACK_PLAN.md",
  "artifacts/verification/SBOM_AND_PROVENANCE.md",
  "artifacts/verification/SECURITY_REPORT.md",
  "artifacts/release/DEPLOYMENT_GUIDE.md",
  "artifacts/release/OPERATIONS_RUNBOOK.md",
  "artifacts/release/RELEASE_NOTES.md",
  "artifacts/release/PRODUCTION_READINESS_CHECKLIST.md",
  "artifacts/release/ATTESTATION.json",
  "artifacts/release/PROVENANCE.intoto.json",
  "tech-radar/RADAR.md",
  "tech-radar/BENCHMARK_SCORES.md",
  "tech-radar/UPGRADE_DECISIONS.md",
  "global-memory/LEARNING_SCHEMA.md",
  "global-memory/INGESTION_POLICY.md",
  "global-memory/RETRIEVAL_POLICY.md",
  "global-memory/MEMORY_QUALITY_REPORT.md",
];

export async function evaluateReadiness(rootDir: string): Promise<ReadinessCheck[]> {
  return Promise.all(
    requiredReadinessPaths.map(async (requiredPath) => ({
      path: requiredPath,
      present: await fs.pathExists(path.join(rootDir, requiredPath)),
    })),
  );
}
