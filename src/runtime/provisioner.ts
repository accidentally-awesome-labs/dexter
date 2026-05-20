import path from "node:path";
import fs from "fs-extra";

export interface ProvisioningProfile {
  containerRuntime: "docker" | "podman";
  controlPlane: "coolify" | "dokploy" | "dokku";
  rootless: boolean;
}

export async function provisionIsolatedEnvironment(rootDir: string, profile: ProvisioningProfile) {
  const runtimeDir = path.join(rootDir, "state", "runtime");
  await fs.ensureDir(runtimeDir);

  const metadata = {
    profile,
    createdAt: new Date().toISOString(),
    reproducibility: {
      pinnedImages: true,
      replaySupported: true,
    },
  };

  await fs.writeJson(path.join(runtimeDir, "provisioning.json"), metadata, { spaces: 2 });
  return metadata;
}
