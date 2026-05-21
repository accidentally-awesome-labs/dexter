import path from "node:path";
import fs from "fs-extra";
import type { AgentExecutionInput, AgentExecutionOutput, AgentProvider } from "./types.js";

export class ScriptedAgentProvider implements AgentProvider {
  readonly id = "scripted";

  isReady(): { ready: boolean } {
    return { ready: true };
  }

  async execute(input: AgentExecutionInput): Promise<AgentExecutionOutput> {
    const outputDir = path.join(input.workspaceDir, ".dexter-agent");
    await fs.ensureDir(outputDir);
    const outPath = path.join(outputDir, `${input.task.id}.md`);
    const payload = [
      `# Agent Execution`,
      `- task: ${input.task.id}`,
      `- provider: ${this.id}`,
      "",
      "## Prompt",
      input.prompt,
      "",
      "## Output",
      "Scripted provider executed successfully.",
    ].join("\n");
    await fs.writeFile(outPath, payload);
    return {
      ok: true,
      summary: `Scripted provider wrote ${path.relative(input.workspaceDir, outPath)}`,
      artifacts: [outPath],
    };
  }
}
