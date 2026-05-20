import path from "node:path";
import fs from "fs-extra";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export interface DeployAuthorization {
  schemaVersion: "1.2";
  appName: string;
  audience: "control-plane";
  environment: string;
  sourceEnvironment: string;
  controlPlane: "coolify" | "dokploy" | "dokku";
  tenantId: string;
  nonce: string;
  policyVersion: string;
  policyDigest: string;
  planningDigest: string;
  supplyChainDigest: string;
  approvedBy: string;
  issuedAt: string;
  expiresAt: string;
  signature: string;
}

interface DeployAuthPolicy {
  schemaVersion: "1.0";
  allowCrossEnvironment: boolean;
  allowedTransitions: Array<{ from: string; to: string }>;
  controlPlaneByEnvironment: Record<string, Array<"coolify" | "dokploy" | "dokku">>;
}

interface PolicyBundle {
  schemaVersion: "1.0";
  policyVersion: string;
  policyDigest: string;
  generatedAt: string;
  signature: string;
}

function digest(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function signingPayload(data: Omit<DeployAuthorization, "signature">): string {
  return JSON.stringify(data);
}

function signPayload(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("hex");
}

async function fileDigest(rootDir: string, relPath: string): Promise<string | null> {
  const fullPath = path.join(rootDir, relPath);
  if (!(await fs.pathExists(fullPath))) {
    return null;
  }
  const content = await fs.readFile(fullPath, "utf8");
  return digest(content);
}

const policyPath = (rootDir: string) => path.join(rootDir, "docs", "specs", "DEPLOY_AUTH_POLICY.json");
const policyBundlePath = (rootDir: string) => path.join(rootDir, "docs", "specs", "DEPLOY_AUTH_POLICY.bundle.json");

function policyBundleKey(): string {
  return process.env.DEXTER_POLICY_BUNDLE_KEY ?? "dexter-dev-policy-bundle-key";
}

async function loadPolicy(rootDir: string): Promise<DeployAuthPolicy> {
  const p = policyPath(rootDir);
  if (!(await fs.pathExists(p))) {
    return {
      schemaVersion: "1.0",
      allowCrossEnvironment: false,
      allowedTransitions: [],
      controlPlaneByEnvironment: {
        production: ["coolify"],
        staging: ["coolify", "dokploy", "dokku"],
      },
    };
  }
  return (await fs.readJson(p)) as DeployAuthPolicy;
}

async function generatePolicyBundle(rootDir: string, policy: DeployAuthPolicy): Promise<PolicyBundle> {
  const policyDigest = digest(JSON.stringify(policy));
  const unsigned = {
    schemaVersion: "1.0" as const,
    policyVersion: policy.schemaVersion,
    policyDigest,
    generatedAt: new Date().toISOString(),
  };
  const signature = signPayload(JSON.stringify(unsigned), policyBundleKey());
  const bundle: PolicyBundle = { ...unsigned, signature };
  await fs.ensureDir(path.dirname(policyBundlePath(rootDir)));
  await fs.writeJson(policyBundlePath(rootDir), bundle, { spaces: 2 });
  return bundle;
}

async function verifyPolicyBundle(rootDir: string, policy: DeployAuthPolicy): Promise<PolicyBundle | null> {
  const p = policyBundlePath(rootDir);
  if (!(await fs.pathExists(p))) {
    return null;
  }
  const bundle = (await fs.readJson(p)) as PolicyBundle;
  if (bundle.schemaVersion !== "1.0") {
    return null;
  }
  const expectedDigest = digest(JSON.stringify(policy));
  if (bundle.policyDigest !== expectedDigest || bundle.policyVersion !== policy.schemaVersion) {
    return null;
  }
  const { signature, ...unsigned } = bundle;
  const expectedSignature = signPayload(JSON.stringify(unsigned), policyBundleKey());
  const a = Buffer.from(signature);
  const b = Buffer.from(expectedSignature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return null;
  }
  return bundle;
}

async function ensurePolicyBundle(rootDir: string, policy: DeployAuthPolicy): Promise<PolicyBundle> {
  const verified = await verifyPolicyBundle(rootDir, policy);
  if (verified) {
    return verified;
  }
  return generatePolicyBundle(rootDir, policy);
}

export async function generateDeployAuthorization(
  rootDir: string,
  appName: string,
  options?: {
    approvedBy?: string;
    ttlMinutes?: number;
    environment?: string;
    sourceEnvironment?: string;
    controlPlane?: "coolify" | "dokploy" | "dokku";
    tenantId?: string;
  },
): Promise<DeployAuthorization | null> {
  const planningDigest = await fileDigest(rootDir, "artifacts/planning/PLANNING_SIGNATURES.json");
  const supplyChainDigest = await fileDigest(rootDir, "runs/latest/supply_chain_gate.json");
  if (!planningDigest || !supplyChainDigest) {
    return null;
  }
  const policy = await loadPolicy(rootDir);
  const policyBundle = await ensurePolicyBundle(rootDir, policy);

  const approvedBy = options?.approvedBy ?? (process.env.DEXTER_DEPLOY_APPROVER ?? "dexter-system");
  const ttlMinutes = options?.ttlMinutes ?? 30;
  const environment = options?.environment ?? process.env.DEXTER_DEPLOY_ENV ?? "production";
  const sourceEnvironment = options?.sourceEnvironment ?? process.env.DEXTER_DEPLOY_SOURCE_ENV ?? environment;
  const controlPlane =
    options?.controlPlane ?? ((process.env.DEXTER_DEPLOY_CONTROL_PLANE as "coolify" | "dokploy" | "dokku") ?? "coolify");
  const tenantId = options?.tenantId ?? process.env.DEXTER_DEPLOY_TENANT ?? "default-tenant";
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
  const unsigned: Omit<DeployAuthorization, "signature"> = {
    schemaVersion: "1.2",
    appName,
    audience: "control-plane",
    environment,
    sourceEnvironment,
    controlPlane,
    tenantId,
    nonce: randomUUID(),
    policyVersion: policyBundle.policyVersion,
    policyDigest: policyBundle.policyDigest,
    planningDigest,
    supplyChainDigest,
    approvedBy,
    issuedAt,
    expiresAt,
  };
  const key = process.env.DEXTER_DEPLOY_AUTH_KEY ?? "dexter-dev-deploy-key";
  const signature = signPayload(signingPayload(unsigned), key);
  return { ...unsigned, signature };
}

export function verifyDeployAuthorization(appName: string, auth: DeployAuthorization): boolean {
  if (auth.schemaVersion !== "1.2" || auth.appName !== appName) {
    return false;
  }
  if (auth.audience !== "control-plane") {
    return false;
  }
  if (!auth.environment || !auth.sourceEnvironment || !auth.tenantId || !auth.controlPlane || !auth.nonce) {
    return false;
  }
  if (!auth.policyVersion || !auth.policyDigest) {
    return false;
  }
  if (Date.parse(auth.expiresAt) <= Date.now()) {
    return false;
  }
  const key = process.env.DEXTER_DEPLOY_AUTH_KEY ?? "dexter-dev-deploy-key";
  const { signature, ...unsigned } = auth;
  const expected = signPayload(signingPayload(unsigned), key);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyDeployAuthorizationScope(
  auth: DeployAuthorization,
  expected: {
    environment: string;
    controlPlane: "coolify" | "dokploy" | "dokku";
    tenantId: string;
  },
): boolean {
  return (
    auth.environment === expected.environment &&
    auth.controlPlane === expected.controlPlane &&
    auth.tenantId === expected.tenantId
  );
}

export async function verifyDeployAuthorizationPolicy(
  rootDir: string,
  auth: DeployAuthorization,
  expectedEnvironment: string,
): Promise<boolean> {
  const policy = await loadPolicy(rootDir);
  if (policy.schemaVersion !== "1.0") {
    return false;
  }
  const bundle = await verifyPolicyBundle(rootDir, policy);
  if (!bundle) {
    return false;
  }
  if (auth.policyVersion !== bundle.policyVersion || auth.policyDigest !== bundle.policyDigest) {
    return false;
  }

  if (auth.sourceEnvironment !== expectedEnvironment) {
    if (!policy.allowCrossEnvironment) {
      return false;
    }
    const allowed = policy.allowedTransitions.some(
      (transition) => transition.from === auth.sourceEnvironment && transition.to === expectedEnvironment,
    );
    if (!allowed) {
      return false;
    }
  }

  const allowedControlPlanes = policy.controlPlaneByEnvironment[expectedEnvironment] ?? [];
  return allowedControlPlanes.includes(auth.controlPlane);
}

interface NonceLedger {
  schemaVersion: "1.0";
  entries: Array<{ nonce: string; expiresAt: string }>;
}

const ledgerPath = (rootDir: string) => path.join(rootDir, "state", "deploy_nonce_ledger.json");
const revocationPath = (rootDir: string) => path.join(rootDir, "state", "deploy_auth_revocations.json");

export async function consumeDeployNonce(rootDir: string, auth: DeployAuthorization): Promise<boolean> {
  const pathToLedger = ledgerPath(rootDir);
  const now = Date.now();
  const ledger: NonceLedger = (await fs.pathExists(pathToLedger))
    ? ((await fs.readJson(pathToLedger)) as NonceLedger)
    : { schemaVersion: "1.0", entries: [] };

  const filtered = ledger.entries.filter((item) => Date.parse(item.expiresAt) > now);
  if (filtered.some((item) => item.nonce === auth.nonce)) {
    return false;
  }
  filtered.push({ nonce: auth.nonce, expiresAt: auth.expiresAt });

  await fs.ensureDir(path.dirname(pathToLedger));
  await fs.writeJson(pathToLedger, { schemaVersion: "1.0", entries: filtered }, { spaces: 2 });
  return true;
}

interface RevocationLedger {
  schemaVersion: "1.0";
  revoked: Array<{ nonce: string; reason: string; expiresAt: string; revokedAt: string }>;
}

export async function revokeDeployAuthorizationNonce(
  rootDir: string,
  nonce: string,
  reason: string,
  expiresAt: string,
): Promise<void> {
  const p = revocationPath(rootDir);
  const current: RevocationLedger = (await fs.pathExists(p))
    ? ((await fs.readJson(p)) as RevocationLedger)
    : { schemaVersion: "1.0", revoked: [] };
  const now = new Date().toISOString();
  const filtered = current.revoked.filter((item) => Date.parse(item.expiresAt) > Date.now() && item.nonce !== nonce);
  filtered.push({ nonce, reason, expiresAt, revokedAt: now });
  await fs.ensureDir(path.dirname(p));
  await fs.writeJson(p, { schemaVersion: "1.0", revoked: filtered }, { spaces: 2 });
}

export async function isDeployAuthorizationRevoked(rootDir: string, auth: DeployAuthorization): Promise<boolean> {
  const p = revocationPath(rootDir);
  if (!(await fs.pathExists(p))) {
    return false;
  }
  const ledger = (await fs.readJson(p)) as RevocationLedger;
  const active = ledger.revoked.filter((item) => Date.parse(item.expiresAt) > Date.now());
  return active.some((item) => item.nonce === auth.nonce);
}
