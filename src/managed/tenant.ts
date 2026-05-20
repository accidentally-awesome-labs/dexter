import path from "node:path";
import fs from "fs-extra";
import { randomUUID } from "node:crypto";

export interface TenantRecord {
  tenantId: string;
  name: string;
  createdAt: string;
  policyProfile: "default" | "strict";
}

const tenantsFile = (rootDir: string) => path.join(rootDir, "state", "tenants.json");

export async function ensureTenant(rootDir: string, name: string): Promise<TenantRecord> {
  const file = tenantsFile(rootDir);
  await fs.ensureDir(path.dirname(file));
  const existing: TenantRecord[] = (await fs.pathExists(file)) ? await fs.readJson(file) : [];

  const found = existing.find((tenant) => tenant.name === name);
  if (found) {
    return found;
  }

  const tenant: TenantRecord = {
    tenantId: randomUUID(),
    name,
    createdAt: new Date().toISOString(),
    policyProfile: "default",
  };

  existing.push(tenant);
  await fs.writeJson(file, existing, { spaces: 2 });
  return tenant;
}
