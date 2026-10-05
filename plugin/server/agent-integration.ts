import type { PluginBeforeRequests, PluginHandlerContext } from "@getpaseo/plugin/server";
import { CanvasError } from "../shared/errors";
import type { CanvasBridge } from "./bridge";
import type { CanvasService } from "./service";
import { integrationInstructions, preapprovedTools } from "./tools";

export const ownerEnvironment = "PASEO_CANVAS_OWNER";
export const allWorkspaces = "*";
export type Paseo = PluginHandlerContext["paseo"];
type Creation = PluginBeforeRequests["agent.create"];
export function managedMcp(bridge: Pick<CanvasBridge, "script" | "endpoint">, owner: string) {
  return { type: "stdio" as const, command: process.execPath, args: [bridge.script, bridge.endpoint, owner] };
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
export class AgentGateway {
  private paseo: Paseo | null = null;
  constructor(readonly service: CanvasService) {}
  bind(paseo: Paseo) { this.paseo = paseo; }
  api(): Paseo {
    if (!this.paseo) throw new CanvasError("UNAVAILABLE", "Open the canvas panel or retry after the agent session opens.");
    return this.paseo;
  }
  async verify(agentId: string, workspaceId?: string) {
    const agent = this.api().agents.ref(agentId);
    const refreshed = await agent.refresh();
    if (!refreshed || agent.archivedAt || !agent.workspaceId) throw new CanvasError("FORBIDDEN", "Agent is unavailable or has no active workspace.");
    if (workspaceId && agent.workspaceId !== workspaceId) throw new CanvasError("FORBIDDEN", "Agent belongs to another workspace.");
    return agent;
  }
  async scope(owner: string) {
    const agentId = await this.service.owner(owner);
    if (!agentId) throw new CanvasError("FORBIDDEN", "Unknown/unbound canvas owner. Use canvas.agent.setup and reload the idle agent.");
    const agent = await this.verify(agentId);
    return { agentId, workspaceId: agent.workspaceId! };
  }
}

/** Hooks fail open. Opt-in is global ("*") or matched against the actual workspace directory. */
export async function prepareCreation(request: Creation, gateway: AgentGateway, bridge: CanvasBridge): Promise<Creation> {
  try {
    if (request.config.internal || request.config.mcpServers?.["paseo-canvas"] || !["codex", "claude", "opencode"].includes(request.config.provider)) return request;
    const enabled = (await gateway.service.injection()).workspaceIds;
    if (!enabled.length) return request;
    // "*" is the installer's global opt-in: every new agent on this host gets the tools, whatever its workspace.
    if (!enabled.includes(allWorkspaces)) {
      const workspaces = await gateway.api().workspaces.list();
      if (!workspaces.entries.some(workspace => enabled.includes(workspace.id) && workspace.workspaceDirectory === request.config.cwd)) return request;
    }
    await bridge.ensure();
    const owner = await gateway.service.allocateOwner();
    return injectAgent(request, bridge, owner);
  } catch { console.error("Canvas injection unavailable; preserving agent configuration."); return request; }
}
