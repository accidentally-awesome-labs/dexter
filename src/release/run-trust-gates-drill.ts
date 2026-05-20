import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { verifyAttestation } from "./attestation.js";
import { verifyProvenance } from "./provenance.js";
import {
  consumeDeployNonce,
  generateDeployAuthorization,
  isDeployAuthorizationRevoked,
  revokeDeployAuthorizationNonce,
  verifyDeployAuthorizationPolicy,
} from "../deploy/authorization.js";

interface DrillResult {
  name: string;
  expected: string;
  actual: string;
  passed: boolean;
  details?: Record<string, unknown>;
}

async function copyIfExists(fromRoot: string, toRoot: string, relPath: string) {
  const source = path.join(fromRoot, relPath);
  if (!(await fs.pathExists(source))) {
    return;
  }
  const target = path.join(toRoot, relPath);
  await fs.ensureDir(path.dirname(target));
  await fs.copy(source, target);
}

async function makeFixture(rootDir: string): Promise<string> {
  const fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-trust-gates-"));
  const requiredPaths = [
    "artifacts/planning/PLANNING_SIGNATURES.json",
    "runs/latest/supply_chain_gate.json",
    "docs/specs/DEPLOY_AUTH_POLICY.json",
    "docs/specs/DEPLOY_AUTH_POLICY.bundle.json",
    "artifacts/release/ATTESTATION.json",
    "artifacts/release/PROVENANCE.intoto.json",
    "artifacts/release/DEPLOYMENT_GUIDE.md",
    "artifacts/release/OPERATIONS_RUNBOOK.md",
    "artifacts/release/RELEASE_NOTES.md",
    "artifacts/release/PRODUCTION_READINESS_CHECKLIST.md",
    "artifacts/verification/SBOM_AND_PROVENANCE.md",
    "artifacts/verification/SECURITY_REPORT.md",
  ];

  for (const relPath of requiredPaths) {
    await copyIfExists(rootDir, fixtureDir, relPath);
  }

  return fixtureDir;
}

async function runAttestationTamper(rootDir: string): Promise<DrillResult> {
  const fixture = await makeFixture(rootDir);
  try {
    const target = path.join(fixture, "artifacts/release/DEPLOYMENT_GUIDE.md");
    await fs.appendFile(target, "\n# Tamper marker\n");
    const valid = await verifyAttestation(fixture);
    return {
      name: "attestation_tamper",
      expected: "attestation verification fails after release artifact tampering",
      actual: valid ? "verification passed unexpectedly" : "verification failed as expected",
      passed: !valid,
    };
  } finally {
    await fs.remove(fixture);
  }
}

async function runProvenanceTamper(rootDir: string): Promise<DrillResult> {
  const fixture = await makeFixture(rootDir);
  try {
    const target = path.join(fixture, "artifacts/verification/SBOM_AND_PROVENANCE.md");
    await fs.appendFile(target, "\nTampered subject digest.\n");
    const valid = await verifyProvenance(fixture);
    return {
      name: "provenance_tamper",
      expected: "provenance verification fails when subject digest changes",
      actual: valid ? "verification passed unexpectedly" : "verification failed as expected",
      passed: !valid,
    };
  } finally {
    await fs.remove(fixture);
  }
}

async function runPolicyBundleTamper(rootDir: string): Promise<DrillResult> {
  const fixture = await makeFixture(rootDir);
  try {
    const auth = await generateDeployAuthorization(fixture, "dexter", {
      approvedBy: "trust-gates-drill",
      environment: "production",
      controlPlane: "coolify",
      tenantId: "default-tenant",
    });
    if (!auth) {
      return {
        name: "policy_bundle_tamper",
        expected: "policy gate rejects tampered policy bundle",
        actual: "deploy authorization could not be generated",
        passed: false,
      };
    }

    const before = await verifyDeployAuthorizationPolicy(fixture, auth, "production");
    const bundlePath = path.join(fixture, "docs/specs/DEPLOY_AUTH_POLICY.bundle.json");
    const bundle = await fs.readJson(bundlePath);
    bundle.policyDigest = `${bundle.policyDigest}tampered`;
    await fs.writeJson(bundlePath, bundle, { spaces: 2 });
    const after = await verifyDeployAuthorizationPolicy(fixture, auth, "production");

    return {
      name: "policy_bundle_tamper",
      expected: "policy gate passes before tamper and fails after tamper",
      actual: `before=${before} after=${after}`,
      passed: before && !after,
      details: { before, after },
    };
  } finally {
    await fs.remove(fixture);
  }
}

async function runNonceReplay(rootDir: string): Promise<DrillResult> {
  const fixture = await makeFixture(rootDir);
  try {
    const auth = await generateDeployAuthorization(fixture, "dexter", {
      approvedBy: "trust-gates-drill",
      environment: "production",
      controlPlane: "coolify",
      tenantId: "default-tenant",
    });
    if (!auth) {
      return {
        name: "nonce_replay",
        expected: "second nonce use is rejected",
        actual: "deploy authorization could not be generated",
        passed: false,
      };
    }
    const first = await consumeDeployNonce(fixture, auth);
    const second = await consumeDeployNonce(fixture, auth);

    return {
      name: "nonce_replay",
      expected: "first nonce use accepted and replay rejected",
      actual: `first=${first} second=${second}`,
      passed: first && !second,
      details: { first, second },
    };
  } finally {
    await fs.remove(fixture);
  }
}

async function runRevocation(rootDir: string): Promise<DrillResult> {
  const fixture = await makeFixture(rootDir);
  try {
    const auth = await generateDeployAuthorization(fixture, "dexter", {
      approvedBy: "trust-gates-drill",
      environment: "production",
      controlPlane: "coolify",
      tenantId: "default-tenant",
    });
    if (!auth) {
      return {
        name: "revocation_enforced",
        expected: "revoked deploy authorization is blocked",
        actual: "deploy authorization could not be generated",
        passed: false,
      };
    }

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await revokeDeployAuthorizationNonce(fixture, auth.nonce, "trust-gates-drill", expiresAt);
    const revoked = await isDeployAuthorizationRevoked(fixture, auth);

    return {
      name: "revocation_enforced",
      expected: "revoked nonce appears in revocation ledger",
      actual: revoked ? "revocation detected" : "revocation not detected",
      passed: revoked,
    };
  } finally {
    await fs.remove(fixture);
  }
}

async function runCrossEnvironmentPolicy(rootDir: string): Promise<DrillResult> {
  const fixture = await makeFixture(rootDir);
  try {
    const auth = await generateDeployAuthorization(fixture, "dexter", {
      approvedBy: "trust-gates-drill",
      environment: "production",
      sourceEnvironment: "staging",
      controlPlane: "coolify",
      tenantId: "default-tenant",
    });
    if (!auth) {
      return {
        name: "cross_environment_policy",
        expected: "unauthorized cross-environment deploy is rejected",
        actual: "deploy authorization could not be generated",
        passed: false,
      };
    }

    const allowed = await verifyDeployAuthorizationPolicy(fixture, auth, "production");
    return {
      name: "cross_environment_policy",
      expected: "staging->production blocked unless policy transition exists",
      actual: allowed ? "policy allowed transition unexpectedly" : "policy blocked transition as expected",
      passed: !allowed,
    };
  } finally {
    await fs.remove(fixture);
  }
}

function toMarkdown(results: DrillResult[]): string {
  const passed = results.filter((item) => item.passed).length;
  const total = results.length;
  const failed = total - passed;
  return [
    "# Trust Gates Report",
    "",
    `- Generated at: ${new Date().toISOString()}`,
    `- Passed: ${passed}/${total}`,
    `- Failed: ${failed}`,
    "",
    "## Scenario Results",
    ...results.map(
      (item) =>
        `- [${item.passed ? "PASS" : "FAIL"}] ${item.name}: expected "${item.expected}", observed "${item.actual}"`,
    ),
    "",
  ].join("\n");
}

async function main() {
  const rootDir = process.cwd();
  const results: DrillResult[] = [];
  results.push(await runAttestationTamper(rootDir));
  results.push(await runProvenanceTamper(rootDir));
  results.push(await runPolicyBundleTamper(rootDir));
  results.push(await runNonceReplay(rootDir));
  results.push(await runRevocation(rootDir));
  results.push(await runCrossEnvironmentPolicy(rootDir));

  const report = {
    generatedAt: new Date().toISOString(),
    total: results.length,
    passed: results.filter((item) => item.passed).length,
    failed: results.filter((item) => !item.passed).length,
    results,
  };

  const outDir = path.join(rootDir, "artifacts", "verification");
  await fs.ensureDir(outDir);
  const jsonPath = path.join(outDir, "TRUST_GATES_REPORT.json");
  const markdownPath = path.join(outDir, "TRUST_GATES_REPORT.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(markdownPath, toMarkdown(results));

  console.log(
    JSON.stringify(
      {
        jsonPath,
        markdownPath,
        total: report.total,
        passed: report.passed,
        failed: report.failed,
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
