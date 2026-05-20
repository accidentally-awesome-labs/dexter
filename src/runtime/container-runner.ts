import { spawn } from "node:child_process";
import type { TaskSpec } from "../protocols/types.js";

type RuntimeMode = "docker" | "podman";
type RunnerMode = "container" | "local-fallback";

export interface ContainerRunResult {
  ok: boolean;
  mode: RunnerMode;
  command: string;
  stdout: string;
  stderr: string;
}

async function commandExists(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-lc", `command -v ${command}`], { stdio: "ignore" });
    child.on("close", (code) => resolve(code === 0));
  });
}

async function run(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
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

export async function runTask(
  _rootDir: string,
  runtime: RuntimeMode,
  task: TaskSpec,
): Promise<ContainerRunResult> {
  const available = await commandExists(runtime);
  if (available) {
    const cmd = `${runtime} run --rm alpine:3.20 sh -lc "echo running ${task.id}"`;
    const result = await run(runtime, ["run", "--rm", "alpine:3.20", "sh", "-lc", `echo running ${task.id}`]);
    return {
      ok: result.code === 0,
      mode: "container",
      command: cmd,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    };
  }

  const fallbackCmd = `sh -lc "echo local-fallback ${task.id}"`;
  const result = await run("sh", ["-lc", `echo local-fallback ${task.id}`]);
  return {
    ok: result.code === 0,
    mode: "local-fallback",
    command: fallbackCmd,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}
