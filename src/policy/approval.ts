import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export interface ApprovalRecord {
  hitlApproved: true;
  token: string;
  expiresAt: string;
  approvedBy: string;
  planDigest: string;
  signature: string;
  source: string;
}

function signingPayload(
  project: string,
  token: string,
  expiresAt: string,
  approvedBy: string,
  planDigest: string,
): string {
  return `${project}|${token}|${expiresAt}|${approvedBy}|${planDigest}`;
}

export function signApproval(
  project: string,
  token: string,
  expiresAt: string,
  approvedBy: string,
  planDigest: string,
  signingKey: string,
): string {
  return createHmac("sha256", signingKey)
    .update(signingPayload(project, token, expiresAt, approvedBy, planDigest))
    .digest("hex");
}

export function createApprovalRecord(
  project: string,
  planDigest: string,
  signingKey: string,
  options?: { ttlMinutes?: number; source?: string; approvedBy?: string },
): ApprovalRecord {
  const ttlMinutes = options?.ttlMinutes ?? 60;
  const source = options?.source ?? "manual-approval";
  const approvedBy = options?.approvedBy ?? "unknown-signer";
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
  const signature = signApproval(project, token, expiresAt, approvedBy, planDigest, signingKey);
  return {
    hitlApproved: true,
    token,
    expiresAt,
    approvedBy,
    planDigest,
    signature,
    source,
  };
}

export function isApprovalValid(
  project: string,
  expectedPlanDigest: string,
  record: Partial<ApprovalRecord>,
  signingKey: string,
): boolean {
  if (!record.hitlApproved || !record.token || !record.expiresAt || !record.signature || !record.approvedBy || !record.planDigest) {
    return false;
  }
  if (record.planDigest !== expectedPlanDigest) {
    return false;
  }
  const expected = signApproval(project, record.token, record.expiresAt, record.approvedBy, record.planDigest, signingKey);
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(record.signature);
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    return false;
  }

  const expiresAtMs = Date.parse(record.expiresAt);
  if (Number.isNaN(expiresAtMs)) {
    return false;
  }
  return expiresAtMs > Date.now();
}
