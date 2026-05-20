import path from "node:path";
import fs from "fs-extra";
import {
  createHash,
  createHmac,
  timingSafeEqual,
  sign as cryptoSign,
  verify as cryptoVerify,
  createPrivateKey,
  createPublicKey,
} from "node:crypto";

export interface ArtifactAttestation {
  schemaVersion: "1.2";
  keyId: string;
  signatureAlg: "hmac-sha256" | "ed25519";
  generatedAt: string;
  files: Array<{
    path: string;
    sha256: string;
  }>;
  signature: string;
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function signPayload(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("hex");
}

function getPrivateKeyPem(): string | null {
  const direct = process.env.DEXTER_ATTESTATION_PRIVATE_KEY;
  if (direct) {
    return direct;
  }
  const b64 = process.env.DEXTER_ATTESTATION_PRIVATE_KEY_B64;
  if (!b64) {
    return null;
  }
  return Buffer.from(b64, "base64").toString("utf8");
}

function getPublicKeyPem(): string | null {
  const direct = process.env.DEXTER_ATTESTATION_PUBLIC_KEY;
  if (direct) {
    return direct;
  }
  const b64 = process.env.DEXTER_ATTESTATION_PUBLIC_KEY_B64;
  if (!b64) {
    return null;
  }
  return Buffer.from(b64, "base64").toString("utf8");
}

function splitEnvEntries(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function signAsymmetric(payload: string, privateKeyPem: string): string {
  const key = createPrivateKey(privateKeyPem);
  const signature = cryptoSign(null, Buffer.from(payload), key);
  return signature.toString("base64");
}

function verifyAsymmetric(payload: string, signatureB64: string, publicKeyPem: string): boolean {
  const key = createPublicKey(publicKeyPem);
  const signature = Buffer.from(signatureB64, "base64");
  return cryptoVerify(null, Buffer.from(payload), key, signature);
}

function payloadFor(attestation: Omit<ArtifactAttestation, "signature">): string {
  return JSON.stringify(attestation);
}

const signedChainFiles = [
  "artifacts/release/DEPLOYMENT_GUIDE.md",
  "artifacts/release/OPERATIONS_RUNBOOK.md",
  "artifacts/release/RELEASE_NOTES.md",
  "artifacts/release/PRODUCTION_READINESS_CHECKLIST.md",
  "artifacts/release/PROVENANCE.intoto.json",
  "artifacts/verification/SBOM_AND_PROVENANCE.md",
  "artifacts/verification/SECURITY_REPORT.md",
];

export async function generateAttestation(rootDir: string): Promise<ArtifactAttestation> {
  const files: ArtifactAttestation["files"] = [];

  for (const file of signedChainFiles) {
    const fullPath = path.join(rootDir, file);
    const content = await fs.readFile(fullPath, "utf8");
    files.push({
      path: file,
      sha256: hashContent(content),
    });
  }

  const privateKeyPem = getPrivateKeyPem();
  const signatureAlg: ArtifactAttestation["signatureAlg"] = privateKeyPem ? "ed25519" : "hmac-sha256";
  const unsigned: Omit<ArtifactAttestation, "signature"> = {
    schemaVersion: "1.2",
    keyId: process.env.DEXTER_ATTESTATION_KEY_ID ?? "default",
    signatureAlg,
    generatedAt: new Date().toISOString(),
    files,
  };

  const payload = payloadFor(unsigned);
  const signingKey = process.env.DEXTER_ATTESTATION_KEY ?? "dexter-dev-attestation-key";
  const signature = signatureAlg === "ed25519" && privateKeyPem
    ? signAsymmetric(payload, privateKeyPem)
    : signPayload(payload, signingKey);
  const attestation: ArtifactAttestation = {
    ...unsigned,
    signature,
  };

  await fs.writeJson(path.join(rootDir, "artifacts", "release", "ATTESTATION.json"), attestation, { spaces: 2 });
  return attestation;
}

export async function verifyAttestation(rootDir: string): Promise<boolean> {
  const releaseDir = path.join(rootDir, "artifacts", "release");
  const attestationPath = path.join(releaseDir, "ATTESTATION.json");
  if (!(await fs.pathExists(attestationPath))) {
    return false;
  }

  const attestation = (await fs.readJson(attestationPath)) as ArtifactAttestation;
  if (attestation.schemaVersion !== "1.2") {
    return false;
  }
  const { signature, ...unsigned } = attestation;
  for (const file of unsigned.files) {
    const fullPath = path.join(rootDir, file.path);
    if (!(await fs.pathExists(fullPath))) {
      return false;
    }
    const content = await fs.readFile(fullPath, "utf8");
    if (hashContent(content) !== file.sha256) {
      return false;
    }
  }

  const payload = payloadFor(unsigned);
  if (unsigned.signatureAlg === "ed25519") {
    const activePublicKey = getPublicKeyPem();
    const trustedPublicKeys = splitEnvEntries("DEXTER_ATTESTATION_TRUSTED_PUBLIC_KEYS");
    const allPublicKeys = [...(activePublicKey ? [activePublicKey] : []), ...trustedPublicKeys];
    for (const publicKey of allPublicKeys) {
      if (verifyAsymmetric(payload, signature, publicKey)) {
        return true;
      }
    }
    return false;
  }

  const activeKey = process.env.DEXTER_ATTESTATION_KEY ?? "dexter-dev-attestation-key";
  const trustedHmacKeys = splitEnvEntries("DEXTER_ATTESTATION_TRUSTED_KEYS");
  const keys = [activeKey, ...trustedHmacKeys];
  const actualBuf = Buffer.from(signature);
  for (const key of keys) {
    const expected = signPayload(payload, key);
    const expectedBuf = Buffer.from(expected);
    if (expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf)) {
      return true;
    }
  }
  return false;
}
