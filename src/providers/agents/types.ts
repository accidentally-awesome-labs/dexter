import type { TaskSpec } from "../../protocols/types.js";

export interface AgentExecutionInput {
  task: TaskSpec;
  prompt: string;
  workspaceDir: string;
  rootDir: string;
}

export interface AgentExecutionOutput {
  ok: boolean;
  summary: string;
  artifacts?: string[];
}

export interface AgentProvider {
  id: string;
  execute(input: AgentExecutionInput): Promise<AgentExecutionOutput>;
}
