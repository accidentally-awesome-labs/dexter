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

export class CursorCliAgentProvider implements AgentProvider {
  readonly id = "cursor-cli";

  isReady(): { ready: boolean; reason?: string } {
    const template = process.env.DEXTER_CURSOR_CLI_COMMAND_TEMPLATE?.trim();
    if (!template) {
      return {
        ready: false,
        reason:
          "Set DEXTER_CURSOR_CLI_COMMAND_TEMPLATE with a {prompt} placeholder to enable cursor-cli backend.",
      };
    }
    if (!template.includes("{prompt}")) {
      return {
        ready: false,
        reason: "DEXTER_CURSOR_CLI_COMMAND_TEMPLATE must include a {prompt} placeholder.",
      };
    }
    return { ready: true };
  }

  async execute(input: AgentExecutionInput): Promise<AgentExecutionOutput> {
    const readiness = this.isReady();
    if (!readiness.ready) {
      return {
        ok: false,
        summary: `Cursor CLI provider is not configured: ${readiness.reason ?? "unknown reason"}`,
        artifacts: [],
      };
    }
    const template = process.env.DEXTER_CURSOR_CLI_COMMAND_TEMPLATE!.trim();
    const escapedPrompt = input.prompt.replaceAll('"', '\\"');
    const command = template.replaceAll("{prompt}", escapedPrompt);
    const result = await run(command, input.workspaceDir);
    return {
      ok: result.code === 0,
      summary: `Cursor CLI command executed with exit=${result.code}`,
      artifacts: [],
    };
  }
}
