import path from "node:path";
import fs from "fs-extra";
import { createHash } from "node:crypto";

interface ProvenanceOptions {
  runId: string;
  project: string;
}

const provenanceSubjects = [
  "artifacts/release/DEPLOYMENT_GUIDE.md",
  "artifacts/release/OPERATIONS_RUNBOOK.md",
  "artifacts/release/RELEASE_NOTES.md",
  "artifacts/release/PRODUCTION_READINESS_CHECKLIST.md",
  "artifacts/verification/SBOM_AND_PROVENANCE.md",
  "artifacts/verification/SECURITY_REPORT.md",
];

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function generateProvenance(rootDir: string, options: ProvenanceOptions) {
  const subject: Array<{ name: string; digest: { sha256: string } }> = [];

  for (const file of provenanceSubjects) {
    const fullPath = path.join(rootDir, file);
    if (!(await fs.pathExists(fullPath))) {
      continue;
    }
    const content = await fs.readFile(fullPath, "utf8");
    subject.push({
      name: file,
      digest: { sha256: sha256(content) },
    });
  }

  const provenance = {
    _type: "https://in-toto.io/Statement/v1",
    predicateType: "https://slsa.dev/provenance/v1",
    subject,
    predicate: {
      buildDefinition: {
        buildType: "dexter/autonomous-factory/v1",
        externalParameters: {
          project: options.project,
          runId: options.runId,
        },
        internalParameters: {
          pipelineStages: [
            "discovery",
            "planning",
            "policyGate",
            "provisioning",
            "execution",
            "verification",
            "release",
          ],
        },
        resolvedDependencies: [],
      },
      runDetails: {
        builder: {
          id: "dexter-core",
        },
        metadata: {
          invocationId: options.runId,
          startedOn: new Date().toISOString(),
          finishedOn: new Date().toISOString(),
        },
      },
    },
  };

  const outputPath = path.join(rootDir, "artifacts", "release", "PROVENANCE.intoto.json");
  await fs.writeJson(outputPath, provenance, { spaces: 2 });
  return { outputPath, provenance };
}

export async function verifyProvenance(rootDir: string): Promise<boolean> {
  const provenancePath = path.join(rootDir, "artifacts", "release", "PROVENANCE.intoto.json");
  if (!(await fs.pathExists(provenancePath))) {
    return false;
  }

  const statement = (await fs.readJson(provenancePath)) as {
    _type?: string;
    predicateType?: string;
    subject?: Array<{ name: string; digest: { sha256: string } }>;
  };
  if (statement._type !== "https://in-toto.io/Statement/v1") {
    return false;
  }
  if (statement.predicateType !== "https://slsa.dev/provenance/v1") {
    return false;
  }
  if (!Array.isArray(statement.subject) || statement.subject.length === 0) {
    return false;
  }

  const hasSbom = statement.subject.some((item) => item.name === "artifacts/verification/SBOM_AND_PROVENANCE.md");
  if (!hasSbom) {
    return false;
  }

  for (const subject of statement.subject) {
    const filePath = path.join(rootDir, subject.name);
    if (!(await fs.pathExists(filePath))) {
      return false;
    }
    const content = await fs.readFile(filePath, "utf8");
    if (sha256(content) !== subject.digest.sha256) {
      return false;
    }
  }
  return true;
}
