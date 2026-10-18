import { canvasPreferences, interfacePreferences } from "../shared/preferences";
import * as rpc from "../shared/rpc";
import { CanvasError } from "../shared/errors";
import type { RpcInput } from "../shared/contract";
import { CanvasStore } from "./store";
import { CanvasService } from "./service";
import { ToolRouter, toolNames, type CallerScope } from "./tools";
import { CopilotService } from "./copilot";
import { AgentGateway, type HandlerContext, type ServerHost } from "./host";

export interface CanvasCoreOptions {
  /** Private directory holding state.json and the writer lock. */
  directory: string;
  /** Maps an MCP caller's owner token to its agent and workspace. Defaults to the host's agent registry. */
  resolveScope?: (owner: string) => Promise<CallerScope>;
  /** Makes the agent tools reachable before a connection is saved (the Paseo MCP bridge). */
  ensureTools?: () => Promise<void>;
  /** Host-specific setup snippet for an agent that existed before the tools. Absent: the RPC says it is unavailable. */
  agentSetup?: (input: RpcInput<typeof rpc.agentSetup>, context: HandlerContext) => Promise<{ configuration: string; instructions: string; requiresReload: boolean }>;
}
export interface CanvasCore {
  readonly host: ServerHost;
  readonly store: CanvasStore;
  readonly service: CanvasService;
  readonly copilot: CopilotService;
  readonly gateway: AgentGateway;
  readonly router: ToolRouter;
  /** Removes the lifecycle hooks. The store stays open. */
  stop(): Promise<void>;
}

/**
 * The Lienzo server: one store, its service, the MCP tool router, the copilot and every panel RPC, registered on a
 * host. The canvas is one-way: no RPC sends anything to an agent. Agents draw and read (the selection, block state)
 * through the tools. What depends on running agents (the optional copilot reminder, verifying agent IDs) is wired
 * only when the host says it runs agents.
 */
export function createCanvasCore(host: ServerHost, options: CanvasCoreOptions): CanvasCore {
  host.registerSettings(canvasPreferences);
  host.registerSettings(interfacePreferences);
  const store = new CanvasStore(options.directory), service = new CanvasService(store), gateway = new AgentGateway(service);
  const copilot = new CopilotService(service, toolNames);
  const router = new ToolRouter(service, options.resolveScope ?? (owner => gateway.scope(owner)), copilot);
  const agents = host.runsAgents;
  const ensureTools = options.ensureTools ?? (async () => {});

  host.handle(rpc.listDocuments, input => service.list(input));
  host.handle(rpc.readDocument, input => service.read(input));
  host.handle(rpc.readRuntime, input => service.runtimeRead(input));
  host.handle(rpc.setRuntime, input => service.runtimeSet(input));
  host.handle(rpc.watchDocument, input => service.watch(input));
  host.handle(rpc.createDocument, input => service.create(input));
  host.handle(rpc.mutateDocument, input => service.mutate(input));
  host.handle(rpc.undoDocument, input => service.undo(input));
  host.handle(rpc.redoDocument, input => service.undo(input, "user", true));
  host.handle(rpc.readHistory, input => service.history(input));
  host.handle(rpc.setSelection, input => service.selection(input));
  host.handle(rpc.readCatalog, () => service.catalog());
  host.handle(rpc.mutateCatalog, input => service.catalogMutate(input));
  host.handle(rpc.validatePack, input => service.validatePack(input));
  host.handle(rpc.importPack, input => service.importPack(input));
  host.handle(rpc.exportPack, input => service.exportPack(input));
  host.handle(rpc.instantiatePack, input => service.instantiatePack(input));
  host.handle(rpc.exportGroup, input => service.exportGroup(input));
  host.handle(rpc.readSharing, input => service.sharing(input));
  host.handle(rpc.configureSharing, input => service.configureSharing(input));
  host.handle(rpc.createSheet, input => service.createSheet(input));
  host.handle(rpc.listSheets, input => service.sheets(input));
  host.handle(rpc.readCopilot, input => copilot.read(input));
  host.handle(rpc.listCopilot, input => copilot.list(input));
  host.handle(rpc.setCopilot, async (input, { api }) => {
    if (agents) { gateway.bind(api); await gateway.verify(input.agentId, input.workspaceId); }
    return copilot.set(input);
  });
  host.handle(rpc.readInjection, () => service.injection());
  host.handle(rpc.configureInjection, input => service.configureInjection(input));
  host.handle(rpc.connectAgent, async (input, { api }) => {
    if (agents) { gateway.bind(api); if (input.connection) await gateway.verify(input.connection.agentId, input.workspaceId); }
    await ensureTools();
    // An agent chosen in the panel is pinned: automatic connection never replaces it.
    const result = await service.connect({ ...input, connection: input.connection && { ...input.connection, pinned: true } });
    if (!agents) return result;
    const state = await store.read();
    return { ...result, requiresReload: !!input.connection && !Object.values(state.owners).some(owner => owner.agentId === input.connection!.agentId) };
  });
  host.handle(rpc.agentSetup, async (input, context) => {
    if (!options.agentSetup) throw new CanvasError("UNAVAILABLE", "This app connects agents over MCP. Open Connect an agent for the command.");
    return options.agentSetup(input, context);
  });

  const removers: (() => void)[] = [];
  if (host.on) {
    // A tool call always happens inside a turn, so this is where a freshly reloaded backend gets its SDK handle back.
    removers.push(host.on("agent.turn_started", async (event, { api }) => {
      gateway.bind(api); copilot.activity.turn(event.agent.id);
      try { await ensureTools(); } catch { console.error("Canvas bridge unavailable at turn start."); }
    }));
    removers.push(host.on("agent.turn_ended", async (event, { api }) => {
      gateway.bind(api);
      try { await copilot.turnEnded(event, gateway); } catch { console.error("Lienzo copilot reminder skipped."); }
    }));
    removers.push(host.on("agent.archived", async event => {
      try { await service.releaseAgent(event.agent.id); await copilot.forget(event.agent.id); } catch { console.error("Canvas could not release an archived agent's canvases."); }
    }));
  }
  return {
    host, store, service, copilot, gateway, router,
    async stop() { for (const remove of removers.reverse()) remove(); },
  };
}
