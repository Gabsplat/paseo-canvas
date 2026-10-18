import type { PluginBeforeRequests } from "@getpaseo/plugin/server";
import { AgentGateway, type HostApi } from "./host";
import type { CanvasBridge } from "./bridge";
import { integrationInstructions, preapprovedTools } from "./tools";

export const ownerEnvironment = "PASEO_CANVAS_OWNER";
// Paseo-only: tool injection at agent creation and the stdio bridge entry. The gateway lives behind the host boundary.
export { AgentGateway };
export type Paseo = HostApi;
type Creation = PluginBeforeRequests["agent.create"];
export function managedMcp(bridge: Pick<CanvasBridge, "script" | "endpoint">, owner: string) {
  // The packaged desktop daemon runs on Electron's binary and Paseo strips ELECTRON_RUN_AS_NODE from agent
  // environments; without it the provider would launch the app instead of this script. Plain Node ignores it.
  return { type: "stdio" as const, command: process.execPath, args: [bridge.script, bridge.endpoint, owner], env: { ELECTRON_RUN_AS_NODE: "1" }, alwaysLoad: true };
}
export function injectAgent(request: Creation, bridge: Pick<CanvasBridge, "script" | "endpoint">, owner: string): Creation {
  if (request.config.internal || !["codex", "claude", "opencode"].includes(request.config.provider)) return request;
  const existing = request.config.mcpServers?.["paseo-canvas"];
  // Any explicit same-name entry belongs to the user; do not overwrite it.
  if (existing) return request;
  // Paseo 0.10.3 translates Codex preapprovals into enabled_tools as well as
  // approvals. A partial grant list hides the mixed read/write catalog tool.
  // Leave this server to the agent's normal permission policy on Codex instead.
  const preapproved = (request.config.toolPolicy?.preapproved ?? []).filter(ref => request.config.provider !== "codex" || ref.server !== "paseo-canvas");
  if (request.config.provider !== "codex") for (const tool of preapprovedTools) if (!preapproved.some(ref => ref.server === "paseo-canvas" && ref.tool === tool)) preapproved.push({ kind: "mcp", server: "paseo-canvas", tool });
  return {
    ...request, env: { ...request.env, [ownerEnvironment]: owner },
    config: { ...request.config,
      mcpServers: { ...request.config.mcpServers, "paseo-canvas": managedMcp(bridge, owner) },
      toolPolicy: request.config.toolPolicy || preapproved.length ? { ...request.config.toolPolicy, preapproved } : undefined,
      systemPrompt: request.config.systemPrompt?.includes("[Paseo Canvas]") ? request.config.systemPrompt : [request.config.systemPrompt, integrationInstructions].filter(Boolean).join("\n\n"),
    },
  };
}
/**
 * Every new agent gets the Lienzo tools and the short copilot instructions, with the copilot off: whether it draws is
 * decided per conversation afterwards (CopilotService). Hooks fail open. The stored injection preference is legacy and
 * no longer filters agents.
 */
export async function prepareCreation(request: Creation, gateway: AgentGateway, bridge: CanvasBridge): Promise<Creation> {
  try {
    if (request.config.internal || request.config.mcpServers?.["paseo-canvas"] || !["codex", "claude", "opencode"].includes(request.config.provider)) return request;
    await bridge.ensure();
    const owner = await gateway.service.allocateOwner();
    return injectAgent(request, bridge, owner);
  } catch { console.error("Canvas injection unavailable; preserving agent configuration."); return request; }
}
