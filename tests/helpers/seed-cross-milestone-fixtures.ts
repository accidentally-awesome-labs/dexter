import path from "node:path";
import fs from "fs-extra";

const FIXTURES_DIR = path.join(process.cwd(), "tests/fixtures/cross-milestone-kpi");

async function copyIfExists(sourceRoot: string, rootDir: string, relativePath: string): Promise<void> {
  const source = path.join(sourceRoot, relativePath);
  if (!(await fs.pathExists(source))) {
    return;
  }
  const destination = path.join(rootDir, relativePath);
  await fs.ensureDir(path.dirname(destination));
  await fs.copy(source, destination);
}

async function copyReleaseTrustBundle(sourceRoot: string, rootDir: string): Promise<void> {
  const attestationPath = path.join(sourceRoot, "artifacts/release/ATTESTATION.json");
  if (!(await fs.pathExists(attestationPath))) {
    return;
  }
  const attestation = (await fs.readJson(attestationPath)) as { files?: Array<{ path: string }> };
  for (const file of attestation.files ?? []) {
    await copyIfExists(sourceRoot, rootDir, file.path);
  }
  await copyIfExists(sourceRoot, rootDir, "artifacts/release/ATTESTATION.json");

  const provenancePath = path.join(sourceRoot, "artifacts/release/PROVENANCE.intoto.json");
  if (await fs.pathExists(provenancePath)) {
    const provenance = (await fs.readJson(provenancePath)) as {
      subject?: Array<{ name: string }>;
    };
    for (const subject of provenance.subject ?? []) {
      await copyIfExists(sourceRoot, rootDir, subject.name);
    }
    await copyIfExists(sourceRoot, rootDir, "artifacts/release/PROVENANCE.intoto.json");
  }
}

export async function seedCrossMilestoneFixtures(rootDir: string): Promise<void> {
  const sourceRoot = process.cwd();
  await fs.copy(path.join(sourceRoot, "docs"), path.join(rootDir, "docs"));
  await fs.copy(path.join(sourceRoot, "docs/specs"), path.join(rootDir, "docs/specs"));

  await fs.ensureDir(path.join(rootDir, "artifacts/intake/pilot-batch"));
  await fs.copy(
    path.join(FIXTURES_DIR, "pilot-batch-report.json"),
    path.join(rootDir, "artifacts/intake/pilot-batch/PILOT_BATCH_REPORT.json"),
  );

  await fs.ensureDir(path.join(rootDir, "artifacts/release/promotions"));
  await fs.copy(
    path.join(FIXTURES_DIR, "soak-trends.json"),
    path.join(rootDir, "artifacts/release/SOAK_TRENDS.json"),
  );
  await fs.copy(
    path.join(FIXTURES_DIR, "promotion-history.json"),
    path.join(rootDir, "artifacts/release/PROMOTION_HISTORY.json"),
  );
  await fs.copy(
    path.join(FIXTURES_DIR, "promotion-fixture-001.json"),
    path.join(rootDir, "artifacts/release/promotions/promotion-fixture-001.json"),
  );

  await copyReleaseTrustBundle(sourceRoot, rootDir);

  await fs.ensureDir(path.join(rootDir, "artifacts/execution"));
  await fs.writeJson(path.join(rootDir, "artifacts/execution/ESCALATION_STATE.json"), {
    generatedAt: new Date().toISOString(),
    items: [],
  });

  await fs.ensureDir(path.join(rootDir, "artifacts/verification"));
  await fs.writeJson(path.join(rootDir, "artifacts/verification/FAILURE_TAXONOMY.json"), {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    totalFailures: 0,
    allMapped: true,
    unmappedCount: 0,
    classSummaries: [],
    failures: [],
  });
}
