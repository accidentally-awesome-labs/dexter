import path from "node:path";
import fs from "fs-extra";
import {
  CoolifyClient,
  createCoolifyClientFromEnv,
  defaultCoolifyAppsConfigPath,
  loadCoolifyAppsConfig,
  type CoolifyAppsConfig,
} from "./coolify-client.js";

export interface EnsureCoolifyApplicationOptions {
  rootDir: string;
  appName: string;
  image?: string;
  tag?: string;
  portsExposes?: string;
}

export interface EnsureCoolifyApplicationResult {
  appName: string;
  uuid: string;
  created: boolean;
  fqdn?: string;
}

async function writeAppsConfig(rootDir: string, appName: string, uuid: string): Promise<void> {
  const configPath = defaultCoolifyAppsConfigPath(rootDir);
  const existing =
    (await loadCoolifyAppsConfig(configPath)) ??
    ({
      schemaVersion: "1.0",
      applications: {},
    } satisfies CoolifyAppsConfig);
  existing.applications[appName] = { uuid };
  await fs.ensureDir(path.dirname(configPath));
  await fs.writeJson(configPath, existing, { spaces: 2 });
}

export async function ensureCoolifyApplication(
  options: EnsureCoolifyApplicationOptions,
): Promise<EnsureCoolifyApplicationResult> {
  const client = createCoolifyClientFromEnv(options.rootDir);
  if (!client) {
    throw new Error("Coolify provision requires COOLIFY_ORIGIN and COOLIFY_API_TOKEN.");
  }

  const existing = await client.findApplicationByName(options.appName, options.rootDir);
  if (existing?.uuid) {
    return {
      appName: options.appName,
      uuid: existing.uuid,
      created: false,
      fqdn: existing.fqdn,
    };
  }

  const image = options.image ?? process.env.DEXTER_DEPLOY_IMAGE ?? "nginx";
  const tag = options.tag ?? process.env.DEXTER_DEPLOY_TAG ?? "alpine";
  const created = await client.createDockerImageApplication({
    name: options.appName,
    dockerImage: image,
    dockerTag: tag,
    portsExposes: options.portsExposes ?? "80",
    projectUuid: process.env.DEXTER_COOLIFY_PROJECT_UUID,
    serverUuid: process.env.DEXTER_COOLIFY_SERVER_UUID,
    environmentName: process.env.DEXTER_COOLIFY_ENVIRONMENT_NAME ?? "production",
    instantDeploy: process.env.DEXTER_COOLIFY_INSTANT_DEPLOY !== "false",
  });

  await writeAppsConfig(options.rootDir, options.appName, created.uuid);
  return {
    appName: options.appName,
    uuid: created.uuid,
    created: true,
    fqdn: created.fqdn,
  };
}
