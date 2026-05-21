import type { AgentProvider } from "./types.js";
import { ScriptedAgentProvider } from "./scripted-provider.js";
import { ShellAgentProvider } from "./shell-provider.js";
import { CursorCliAgentProvider } from "./cursor-cli-provider.js";

const providers: Record<string, () => AgentProvider> = {
  scripted: () => new ScriptedAgentProvider(),
  shell: () => new ShellAgentProvider(),
  "cursor-cli": () => new CursorCliAgentProvider(),
};

function getProvider(id: string): AgentProvider {
  const make = providers[id] ?? providers.scripted;
  return make();
}

export function createAgentProvider(id?: string): AgentProvider {
  const selected = id ?? process.env.DEXTER_AGENT_BACKEND ?? "scripted";
  return getProvider(selected);
}

export function resolveAgentProvider(id?: string): {
  provider: AgentProvider;
  selectedId: string;
  requestedId: string;
  fallbackReason?: string;
} {
  return resolveAgentProviderWithPolicy(id, { allowFallback: true });
}

export function resolveAgentProviderWithPolicy(
  id: string | undefined,
  options: { allowFallback: boolean },
): {
  provider: AgentProvider;
  selectedId: string;
  requestedId: string;
  fallbackReason?: string;
} {
  const requestedId = id ?? process.env.DEXTER_AGENT_BACKEND ?? "scripted";
  const selectedId = providers[requestedId] ? requestedId : "scripted";
  const selectedProvider = getProvider(selectedId);
  const selectedReadiness = selectedProvider.isReady();
  if (selectedReadiness.ready) {
    return {
      provider: selectedProvider,
      selectedId,
      requestedId,
      fallbackReason: selectedId !== requestedId ? `Unknown backend "${requestedId}".` : undefined,
    };
  }
  if (!options.allowFallback) {
    throw new Error(`Requested backend "${requestedId}" is not ready: ${selectedReadiness.reason ?? "unknown reason"}`);
  }
  const fallback = getProvider("scripted");
  const fallbackReadiness = fallback.isReady();
  if (!fallbackReadiness.ready) {
    throw new Error(
      `No ready agent backend. requested=${requestedId} reason=${selectedReadiness.reason ?? "unavailable"} fallback scripted unavailable.`,
    );
  }
  return {
    provider: fallback,
    selectedId: fallback.id,
    requestedId,
    fallbackReason: `Requested backend "${requestedId}" not ready: ${selectedReadiness.reason ?? "unknown reason"}`,
  };
}

export function listAgentProviderIds(): string[] {
  return Object.keys(providers);
}
