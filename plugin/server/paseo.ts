import type { PluginServerContext } from "@getpaseo/plugin/server";
import { homedir } from "node:os";
import { join } from "node:path";
import { CanvasBridge } from "./bridge";
import { createCanvasCore } from "./core";
import type { HostApi, ServerHost } from "./host";
import { managedMcp, ownerEnvironment, prepareCreation } from "./agent-integration";

/** The Paseo implementation of the server host boundary: the plugin SDK, unchanged underneath. */
export function paseoHost(server: PluginServerContext): ServerHost {
  const api = (context: { paseo: unknown }) => ({ api: context.paseo as HostApi });
  return {
    kind: "paseo", runsAgents: true,
    registerSettings: definition => { server.registerSettings(definition); },
    handle: (contract, handler) => server.handle(contract, (input, context) => handler(input as never, api(context))),
    on: (event, handler) => server.on(event, ((payload: never, context: { paseo: unknown }) => handler(payload, api(context))) as never),
  };
}

/**
 * The plugin: the shared core on the Paseo host, plus what only Paseo has. Every new agent gets the Lienzo tools
 * through a stdio MCP bridge injected at creation; sessions bind their owner token when they open; setup snippets
 * cover agents created before the plugin.
 */
export default function contribute(server: PluginServerContext) {
  const directory = join(process.env.PASEO_HOME || join(homedir(), ".paseo"), "canvas");
  const host = paseoHost(server);
  let bridge: CanvasBridge;
  const core = createCanvasCore(host, {
    directory,
    ensureTools: () => bridge.ensure(),
    agentSetup: async (input, { api }) => {
      core.gateway.bind(api); await core.gateway.verify(input.agentId, input.workspaceId); await bridge.ensure();
      const owner = await core.service.allocateOwner(input.agentId), entry = managedMcp(bridge, owner);
      const configuration = input.provider === "codex" ? `[mcp_servers.paseo-canvas]\ncommand = ${JSON.stringify(entry.command)}\nargs = ${JSON.stringify(entry.args)}\nenv = { ELECTRON_RUN_AS_NODE = "1" }\n` : JSON.stringify(input.provider === "opencode" ? { mcp: { "paseo-canvas": { type: "local", command: [entry.command, ...entry.args], environment: entry.env, enabled: true } } } : { mcpServers: { "paseo-canvas": entry } }, null, 2);
      return { configuration, requiresReload: true, instructions: "Merge this entry into this agent's provider/project MCP configuration, then reload the idle agent. This snippet is private to this agent. The plugin does not edit provider configuration or reload sessions itself. Agents created from now on get the tools automatically." };
    },
  });
  bridge = new CanvasBridge(directory, core.router);
  const { service, gateway } = core;
  // The bridge starts with the plugin so agents that are already open keep their tools across a reload.
  // It is not awaited and fails quietly: handlers and hooks retry it, and a daemon startup is never blocked.
  void bridge.ensure().catch(() => { console.error("Canvas bridge did not start with the plugin; it will retry on first use."); });
  const removeCreate = server.before("agent.create", async ({ request }, { paseo }) => {
    gateway.bind(paseo as unknown as HostApi); return prepareCreation(request, gateway, bridge);
  });
  const removeSession = server.before("agent.session_open", async ({ request }, { paseo }) => {
    try {
      gateway.bind(paseo as unknown as HostApi);
      const owner = request.env[ownerEnvironment];
      if (request.purpose === "interactive" && request.reason === "create" && owner) await service.bindOwner(owner, request.agentId);
      if (request.purpose === "interactive") await bridge.ensure();
    } catch { console.error("Canvas session preparation unavailable; opening the agent unchanged."); }
  });
  return async () => { removeCreate(); removeSession(); await core.stop(); await bridge.close(); await core.store.close(); };
}
