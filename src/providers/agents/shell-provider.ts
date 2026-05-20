import { spawn } from "node:child_process";
import type { AgentExecutionInput, AgentExecutionOutput, AgentProvider } from "./types.js";

function run(command: string, cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
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

export class ShellAgentProvider implements AgentProvider {
  readonly id = "shell";

  async execute(input: AgentExecutionInput): Promise<AgentExecutionOutput> {
    const command = input.prompt.trim();
    const result = await run(command, input.workspaceDir);
    return {
      ok: result.code === 0,
      summary: `Shell provider executed prompt command with exit=${result.code}`,
      artifacts: [],
    };
  }
}
