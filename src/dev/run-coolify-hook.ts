import dotenv from "dotenv";
import { createCoolifyClientFromEnv } from "../providers/deployment/coolify-client.js";

dotenv.config();

async function main(): Promise<void> {
  const action = process.argv[2];
  const appName = process.argv[3] ?? "dexter";
  if (action !== "deploy" && action !== "rollback") {
    console.error("Usage: run-coolify-hook.ts <deploy|rollback> [appName]");
    process.exitCode = 1;
    return;
  }

  const client = createCoolifyClientFromEnv();
  if (!client) {
    console.error("Missing COOLIFY_ORIGIN and COOLIFY_API_TOKEN (or DEXTER_COOLIFY_* aliases).");
    process.exitCode = 1;
    return;
  }

  if (action === "deploy") {
    const result = await client.deployApplication(appName);
    console.log(JSON.stringify({ action, ...result }));
    return;
  }

  const mode = (process.env.COOLIFY_ROLLBACK_MODE as "restart" | "redeploy" | undefined) ?? "restart";
  const result = await client.rollbackApplication(appName, { mode });
  console.log(JSON.stringify({ action, ...result }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
