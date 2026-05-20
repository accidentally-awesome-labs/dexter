import path from "node:path";
import fs from "fs-extra";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export interface PlanningSignatureRecord {
  schemaVersion: "1.0";
  generatedAt: string;
  files: Array<{
    path: string;
    hmacSha256: string;
  }>;
}

const planningFiles = [
  "artifacts/planning/PRD.md",
  "artifacts/planning/TASK_GRAPH.json",
  "artifacts/planning/ARCHITECTURE_SPEC.md",
  "artifacts/planning/NFR_SPEC.md",
  "artifacts/planning/TEST_STRATEGY.md",
];

function sign(content: string, key: string): string {
  return createHmac("sha256", key).update(content).digest("hex");
}

function digest(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function generatePlanningSignatures(rootDir: string): Promise<PlanningSignatureRecord> {
  const key = process.env.DEXTER_PLAN_SIGNING_KEY ?? "dexter-dev-plan-key";
  const files: PlanningSignatureRecord["files"] = [];

  for (const file of planningFiles) {
    const fullPath = path.join(rootDir, file);
    const content = await fs.readFile(fullPath, "utf8");
    files.push({
      path: file,
      hmacSha256: sign(content, key),
    });
  }

  const record: PlanningSignatureRecord = {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    files,
  };

  const outPath = path.join(rootDir, "artifacts", "planning", "PLANNING_SIGNATURES.json");
  await fs.writeJson(outPath, record, { spaces: 2 });
  return record;
}

export async function verifyPlanningSignatures(rootDir: string): Promise<boolean> {
  const key = process.env.DEXTER_PLAN_SIGNING_KEY ?? "dexter-dev-plan-key";
  const signaturePath = path.join(rootDir, "artifacts", "planning", "PLANNING_SIGNATURES.json");
  if (!(await fs.pathExists(signaturePath))) {
    return false;
  }

  const record = (await fs.readJson(signaturePath)) as PlanningSignatureRecord;
  if (record.schemaVersion !== "1.0") {
    return false;
  }

  for (const item of record.files) {
    const fullPath = path.join(rootDir, item.path);
    if (!(await fs.pathExists(fullPath))) {
      return false;
    }
    const content = await fs.readFile(fullPath, "utf8");
    const expected = sign(content, key);
    const expectedBuf = Buffer.from(expected);
    const actualBuf = Buffer.from(item.hmacSha256);
    if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
      return false;
    }
  }

  return true;
}

export async function computePlanningSignatureDigest(rootDir: string): Promise<string | null> {
  const signaturePath = path.join(rootDir, "artifacts", "planning", "PLANNING_SIGNATURES.json");
  if (!(await fs.pathExists(signaturePath))) {
    return null;
  }
  const content = await fs.readFile(signaturePath, "utf8");
  return digest(content);
}
