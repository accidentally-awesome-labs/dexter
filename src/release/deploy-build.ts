import { spawn } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import type { DeployManifest } from "./deploy-manifest.js";

const DEFAULT_DOCKERFILE = `FROM nginx:alpine
COPY generated/RUN_STAMP.json /usr/share/nginx/html/run-stamp.json
RUN printf 'ok' > /usr/share/nginx/html/health
`;

export interface BuildDeployImageResult {
  built: boolean;
  skipped: boolean;
  imageRef: string;
  detail: string;
}

function commandExists(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-lc", `command -v ${command}`], { stdio: "ignore" });
    child.on("close", (code) => resolve(code === 0));
  });
}

async function runShell(command: string, cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-lc", command], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export async function ensureDeployDockerfile(rootDir: string): Promise<boolean> {
  if (process.env.DEXTER_SCAFFOLD_DOCKERFILE === "false") {
    return false;
  }
  const dockerfilePath = path.join(rootDir, "Dockerfile");
  if (await fs.pathExists(dockerfilePath)) {
    return false;
  }
  await fs.writeFile(dockerfilePath, DEFAULT_DOCKERFILE, "utf8");
  return true;
}

export async function buildDeployImage(
  rootDir: string,
  manifest: DeployManifest,
): Promise<BuildDeployImageResult> {
  const imageRef = `${manifest.image}:${manifest.deployTag}`;

  if (process.env.DEXTER_SKIP_DEPLOY_BUILD === "true") {
    return { built: false, skipped: true, imageRef, detail: "DEXTER_SKIP_DEPLOY_BUILD=true" };
  }

  const customBuild = process.env.DEXTER_BUILD_COMMAND?.trim();
  if (customBuild) {
    const result = await runShell(customBuild, rootDir);
    if (result.code !== 0) {
      throw new Error(`DEXTER_BUILD_COMMAND failed: ${result.stderr || result.stdout}`);
    }
    return { built: true, skipped: false, imageRef, detail: "custom build command" };
  }

  if (process.env.DEXTER_DEPLOY_IMAGE && !process.env.DEXTER_BUILD_DEPLOY_IMAGE) {
    return {
      built: false,
      skipped: true,
      imageRef: `${manifest.image}:${manifest.deployTag}`,
      detail: "using DEXTER_DEPLOY_IMAGE without local build",
    };
  }

  const dockerAvailable = await commandExists("docker");
  if (!dockerAvailable) {
    return { built: false, skipped: true, imageRef, detail: "docker not available" };
  }

  await ensureDeployDockerfile(rootDir);
  const build = await runShell(`docker build -t ${imageRef} .`, rootDir);
  if (build.code !== 0) {
    throw new Error(`docker build failed: ${build.stderr || build.stdout}`);
  }

  return { built: true, skipped: false, imageRef, detail: `docker build -t ${imageRef}` };
}
