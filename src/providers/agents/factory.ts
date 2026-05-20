import type { AgentProvider } from "./types.js";
import { ScriptedAgentProvider } from "./scripted-provider.js";
import { ShellAgentProvider } from "./shell-provider.js";

const providers: Record<string, () => AgentProvider> = {
  scripted: () => new ScriptedAgentProvider(),
  shell: () => new ShellAgentProvider(),
  "cursor-cli": () => new ShellAgentProvider(),
};

export function createAgentProvider(id?: string): AgentProvider {
  const selected = id ?? process.env.DEXTER_AGENT_BACKEND ?? "scripted";
  const make = providers[selected] ?? providers.scripted;
  return make();
}

export function listAgentProviderIds(): string[] {
  return Object.keys(providers);
}
