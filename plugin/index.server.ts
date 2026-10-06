import type { PluginServerContext } from "@getpaseo/plugin/server";
import { homedir } from "node:os";
import { join } from "node:path";
import * as rpc from "./shared/rpc";
import { CanvasStore } from "./server/store";
import { CanvasService } from "./server/service";
import { CanvasBridge } from "./server/bridge";
import { ToolRouter } from "./server/tools";
import { AgentGateway, managedMcp, ownerEnvironment, prepareCreation } from "./server/agent-integration";
import { FeedbackDispatcher } from "./server/feedback";

export default function contribute(server: PluginServerContext) {
  const directory = join(process.env.PASEO_HOME || join(homedir(), ".paseo"), "canvas");
  const store = new CanvasStore(directory), service = new CanvasService(store), gateway = new AgentGateway(service);
  const bridge = new CanvasBridge(directory, new ToolRouter(service, owner => gateway.scope(owner)));
  const feedback = new FeedbackDispatcher(service, gateway);
  // The bridge starts with the plugin so agents that are already open keep their tools across a reload.
  // It is not awaited and fails quietly: handlers and hooks retry it, and a daemon startup is never blocked.
  void bridge.ensure().catch(() => { console.error("Canvas bridge did not start with the plugin; it will retry on first use."); });
  server.handle(rpc.listDocuments, input => service.list(input));
  server.handle(rpc.readDocument, input => service.read(input));
  server.handle(rpc.watchDocument, input => service.watch(input));
  server.handle(rpc.createDocument, input => service.create(input));
  server.handle(rpc.mutateDocument, input => service.mutate(input));
  server.handle(rpc.undoDocument, input => service.undo(input));
  server.handle(rpc.redoDocument, input => service.undo(input, "user", true));
  server.handle(rpc.readHistory, input => service.history(input));
  server.handle(rpc.setSelection, input => service.selection(input));
  server.handle(rpc.readCatalog, () => service.catalog());
  server.handle(rpc.mutateCatalog, input => service.catalogMutate(input));
  server.handle(rpc.validatePack, input => service.validatePack(input));
  server.handle(rpc.importPack, input => service.importPack(input));
  server.handle(rpc.exportPack, input => service.exportPack(input));
  server.handle(rpc.instantiatePack, input => service.instantiatePack(input));
  server.handle(rpc.exportGroup, input => service.exportGroup(input));
  server.handle(rpc.readAgentEvents, input => service.events(input));
  server.handle(rpc.readSharing, input => service.sharing(input));
  server.handle(rpc.configureSharing, input => service.configureSharing(input));
  server.handle(rpc.readInjection, () => service.injection());
  server.handle(rpc.configureInjection, input => service.configureInjection(input));
  server.handle(rpc.connectAgent, async (input, { paseo }) => {
    gateway.bind(paseo);
    if (input.connection) await gateway.verify(input.connection.agentId, input.workspaceId);
    await bridge.ensure();
    // A recipient chosen in the panel is pinned: automatic connection never replaces it.
    const result = await service.connect({ ...input, connection: input.connection && { ...input.connection, pinned: true } });
    const state = await store.read();
    return { ...result, requiresReload: !!input.connection && !Object.values(state.owners).some(owner => owner.agentId === input.connection!.agentId) };
  });
  server.handle(rpc.agentSetup, async (input, { paseo }) => {
    gateway.bind(paseo); await gateway.verify(input.agentId, input.workspaceId); await bridge.ensure();
    const owner = await service.allocateOwner(input.agentId), entry = managedMcp(bridge, owner);
    const configuration = input.provider === "codex" ? `[mcp_servers.paseo-canvas]\ncommand = ${JSON.stringify(entry.command)}\nargs = ${JSON.stringify(entry.args)}\nenv = { ELECTRON_RUN_AS_NODE = "1" }\n` : JSON.stringify(input.provider === "opencode" ? { mcp: { "paseo-canvas": { type: "local", command: [entry.command, ...entry.args], environment: entry.env, enabled: true } } } : { mcpServers: { "paseo-canvas": entry } }, null, 2);
    return { configuration, requiresReload: true, instructions: "Merge this entry into this agent's provider/project MCP configuration, then reload the idle agent. This snippet is private to this agent. The plugin does not edit provider configuration or reload sessions itself. New agents can receive tools automatically after enabling canvas.injection for their workspace." };
  });
  server.handle(rpc.agentAction, async (input, { paseo }) => {
    gateway.bind(paseo);
    // Nobody receives this canvas yet: hand it to the most recent agent of this workspace that has the tools.
    if (!(await service.read(input)).connection) for (const agentId of (await service.toolAgents()).slice(0, 20)) {
      try {
        const agent = await gateway.verify(agentId, input.workspaceId);
        if (agent.status === "closed" || agent.status === "error") continue;
        await service.autoConnect(input.documentId, input.workspaceId, agentId, false); break;
      } catch { /* archived or in another workspace */ }
    }
    await service.action(input);
    if (input.action.delivery === "immediate") await feedback.drain();
    return (await service.events(input)).events.find(event => event.id === input.eventId)!;
  });
  server.handle(rpc.flushAgentEvents, async (input, { paseo }) => {
    gateway.bind(paseo);
    const current = await service.read(input);
    if (current.connection) await feedback.drain(current.connection.agentId, true);
    return service.events(input);
  });
  const removeCreate = server.before("agent.create", async ({ request }, { paseo }) => {
    gateway.bind(paseo); return prepareCreation(request, gateway, bridge);
  });
  const removeSession = server.before("agent.session_open", async ({ request }, { paseo }) => {
    try {
      gateway.bind(paseo);
      const owner = request.env[ownerEnvironment];
      if (request.purpose === "interactive" && request.reason === "create" && owner) await service.bindOwner(owner, request.agentId);
      if (request.purpose === "interactive") await bridge.ensure();
    } catch { console.error("Canvas session preparation unavailable; opening the agent unchanged."); }
  });
  // A tool call always happens inside a turn, so this is where a freshly reloaded backend gets its SDK handle back.
  const removeTurnStart = server.on("agent.turn_started", async (_event, { paseo }) => {
    gateway.bind(paseo);
    try { await bridge.ensure(); } catch { console.error("Canvas bridge unavailable at turn start."); }
  });
  const removeTurn = server.on("agent.turn_ended", async (event, { paseo }) => {
    gateway.bind(paseo);
    try { await feedback.drain(event.agent.id); } catch { console.error("Canvas feedback remains pending; retry from the canvas panel."); }
  });
  const removeArchived = server.on("agent.archived", async event => {
    try { await service.releaseAgent(event.agent.id); } catch { console.error("Canvas could not release an archived agent's canvases."); }
  });
  return async () => { removeArchived(); removeCreate(); removeSession(); removeTurnStart(); removeTurn(); await feedback.close(); await bridge.close(); await store.close(); };
}
