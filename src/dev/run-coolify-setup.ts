import crypto from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import dotenv from "dotenv";
import { CoolifyClient, defaultCoolifyAppsConfigPath } from "../providers/deployment/coolify-client.js";

dotenv.config();

const rootDir = process.cwd();
const envPath = path.join(rootDir, ".env");
const appsPath = defaultCoolifyAppsConfigPath(rootDir);

async function loadEnvFile(): Promise<Record<string, string>> {
  if (!(await fs.pathExists(envPath))) {
    return {};
  }
  const content = await fs.readFile(envPath, "utf8");
  const parsed: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    if (index < 0) {
      continue;
    }
    parsed[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return parsed;
}

async function writeEnvFile(values: Record<string, string>): Promise<void> {
  const existing = await loadEnvFile();
  const merged = { ...existing, ...values };
  const lines = [
    "# Generated/updated by npm run coolify:setup — do not commit",
    ...Object.entries(merged).map(([key, value]) => `${key}=${value}`),
    "",
  ];
  await fs.writeFile(envPath, lines.join("\n"), "utf8");
}

async function main(): Promise<void> {
  const origin = process.env.COOLIFY_ORIGIN ?? process.env.DEXTER_COOLIFY_ORIGIN;
  const apiToken = process.env.COOLIFY_API_TOKEN ?? process.env.DEXTER_COOLIFY_API_TOKEN;
  if (!origin || !apiToken) {
    console.error(
      [
        "Missing Coolify credentials.",
        "Set COOLIFY_ORIGIN and COOLIFY_API_TOKEN in .env (or export them), then re-run:",
        "  npm run coolify:setup",
        "",
        "Or run the local wiring drill without a real instance:",
        "  npm run coolify:integration-drill",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  const bridgeToken = process.env.DEXTER_BRIDGE_TOKEN ?? crypto.randomBytes(24).toString("hex");
  const bridgePort = process.env.DEXTER_BRIDGE_PORT ?? "9876";

  const client = new CoolifyClient({
    origin,
    apiToken,
    appsConfigPath: appsPath,
  });

  const applications = await client.listApplications();
  if (applications.length === 0) {
    console.error("No applications returned from Coolify. Create an app in Coolify first.");
    process.exitCode = 1;
    return;
  }

  const preferredNames = ["dexter", "dexter-ops-api", "dexter-worker"];
  const applicationsMap: Record<string, { uuid: string; comment?: string }> = {};
  for (const name of preferredNames) {
    const match = applications.find((app) => app.name === name);
    if (match) {
      applicationsMap[name] = { uuid: match.uuid };
    }
  }
  for (const app of applications) {
    if (!applicationsMap[app.name]) {
      applicationsMap[app.name] = { uuid: app.uuid, comment: "auto-discovered" };
    }
  }

  await fs.ensureDir(path.dirname(appsPath));
  await fs.writeJson(
    appsPath,
    {
      schemaVersion: "1.0",
      applications: applicationsMap,
    },
    { spaces: 2 },
  );

  const healthUrl =
    process.env.DEXTER_DEPLOY_HEALTH_URL ??
    `${origin.replace(/\/$/, "")}/api/health`;

  await writeEnvFile({
    COOLIFY_ORIGIN: origin.replace(/\/$/, ""),
    COOLIFY_API_TOKEN: apiToken,
    DEXTER_BRIDGE_TOKEN: bridgeToken,
    DEXTER_BRIDGE_PORT: bridgePort,
    DEXTER_COOLIFY_API_URL: `http://127.0.0.1:${bridgePort}`,
    DEXTER_COOLIFY_TOKEN: bridgeToken,
    DEXTER_DEPLOY_HEALTH_URL: healthUrl,
  });

  console.log(
    JSON.stringify(
      {
        status: "ok",
        appsPath,
        envPath,
        applicationCount: applications.length,
        mappedApps: Object.keys(applicationsMap),
        next: [
          "npm run coolify:bridge",
          "npm run production:preflight",
          "npm run deploy:self -- --environment staging --require-api true --health-url <url> --app dexter",
        ],
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
