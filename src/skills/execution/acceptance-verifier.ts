import path from "node:path";
import fs from "fs-extra";
import { spawn } from "node:child_process";
import type { AcceptanceCheck, TaskSpec } from "../../protocols/types.js";

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

async function runCheck(workspacePath: string, check: AcceptanceCheck): Promise<{ ok: boolean; detail: string }> {
  if (check.type === "file-exists") {
    if (!check.path) {
      return { ok: false, detail: "file-exists check missing path" };
    }
    const target = path.join(workspacePath, check.path);
    const exists = await fs.pathExists(target);
    return { ok: exists, detail: exists ? `Found file ${check.path}` : `Missing file ${check.path}` };
  }
  const command = check.command?.trim();
  if (!command) {
    return { ok: false, detail: "shell check missing command" };
  }
  const result = await runShell(command, workspacePath);
  return {
    ok: result.code === 0,
    detail: result.code === 0 ? `Shell check passed: ${command}` : `Shell check failed: ${command}`,
  };
}

export async function verifyTaskAcceptance(
  task: TaskSpec,
  workspacePath: string,
): Promise<{ passed: boolean; details: string[] }> {
  const checks = task.acceptanceChecks ?? [];
  if (checks.length === 0) {
    return {
      passed: true,
      details: ["No structured acceptance checks defined; defaulting to pass."],
    };
  }
  const details: string[] = [];
  let passed = true;
  for (const check of checks) {
    const result = await runCheck(workspacePath, check);
    details.push(result.detail);
    if (!result.ok) {
      passed = false;
    }
  }
  return { passed, details };
}
