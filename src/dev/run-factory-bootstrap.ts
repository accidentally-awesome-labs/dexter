import { spawn } from "node:child_process";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const rootDir = process.cwd();

function commandExists(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-lc", `command -v ${command}`], { stdio: "ignore" });
    child.on("close", (code) => resolve(code === 0));
  });
}

async function probeUrl(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

  checks.push({
    name: "docker",
    ok: await commandExists("docker"),
    detail: "required for optional deploy image build (DEXTER_BUILD_DEPLOY_IMAGE)",
  });

  const coolifyOrigin = (process.env.COOLIFY_ORIGIN ?? "http://127.0.0.1:8001").replace(/\/$/, "");
  const coolifyHealthy = await probeUrl(`${coolifyOrigin}/api/health`);
  checks.push({
    name: "coolify",
    ok: coolifyHealthy,
    detail: coolifyHealthy ? coolifyOrigin : `unreachable at ${coolifyOrigin}/api/health`,
  });

  const bridgePort = process.env.DEXTER_BRIDGE_PORT ?? "9876";
  let bridgeHealthy = false;
  try {
    const response = await fetch(`http://127.0.0.1:${bridgePort}/deploy`, {
      method: "POST",
      headers: { authorization: "Bearer probe", "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(3000),
    });
    bridgeHealthy = response.status === 401 || response.status === 200 || response.status === 502;
  } catch {
    bridgeHealthy = false;
  }
  checks.push({
    name: "dexter-bridge",
    ok: bridgeHealthy,
    detail: bridgeHealthy
      ? `listening on :${bridgePort}`
      : `start in another terminal: npm run coolify:bridge`,
  });

  const failed = checks.filter((item) => !item.ok);
  console.log(
    JSON.stringify(
      {
        rootDir,
        checks,
        nextSteps: [
          "npm run coolify:setup",
          process.env.DEXTER_COOLIFY_AUTO_PROVISION === "true"
            ? "npm run coolify:provision"
            : "(optional) npm run coolify:provision",
          "npm run coolify:bridge",
          "npm run factory:e2e",
        ],
      },
      null,
      2,
    ),
  );

  if (failed.length > 0 && process.env.DEXTER_FACTORY_BOOTSTRAP_STRICT === "true") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
