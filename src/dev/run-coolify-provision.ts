import path from "node:path";
import dotenv from "dotenv";
import { ensureCoolifyApplication } from "../providers/deployment/coolify-provision.js";

dotenv.config();

function parseArg(flag: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0 || index + 1 >= process.argv.length) {
    return fallback;
  }
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const rootDir = path.resolve(parseArg("--root-dir", process.cwd()) ?? process.cwd());
  const appName = parseArg("--app", process.env.DEXTER_COOLIFY_APP_NAME ?? "dexter") ?? "dexter";
  const image = parseArg("--image", process.env.DEXTER_DEPLOY_IMAGE ?? "nginx");
  const tag = parseArg("--tag", process.env.DEXTER_DEPLOY_TAG ?? "alpine");

  const result = await ensureCoolifyApplication({
    rootDir,
    appName,
    image,
    tag,
  });

  console.log(
    JSON.stringify(
      {
        appName: result.appName,
        uuid: result.uuid,
        created: result.created,
        fqdn: result.fqdn,
        appsConfig: path.join(rootDir, "infra", "coolify", "apps.json"),
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
