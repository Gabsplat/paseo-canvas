import type { RpcContract, RpcInput, RpcOutput, SettingsDefinition } from "../shared/contract";
import { CanvasError } from "../shared/errors";
import { agentLabel } from "../shared/comments";
import type { CanvasService } from "./service";

/**
 * Everything the Lienzo server core needs from whatever runs it. The Paseo plugin implements it with the plugin SDK
 * (server/paseo.ts); the desktop app implements it in its main process. Nothing in service, store, tools or copilot
 * imports a host SDK: they depend on these shapes only.
 */
export type AgentStatus = "initializing" | "idle" | "running" | "error" | "closed";

/** A live handle on one agent, for hosts that run agents. */
export interface HostAgentRef {
  readonly id: string;
  readonly workspaceId: string | null;
  readonly status: AgentStatus | null;
  readonly archivedAt: string | null;
  readonly activeTurn?: { turnId: string } | null;
  /** Rereads the agent; resolves falsy when it no longer exists. */
  refresh(): Promise<unknown>;
  /** Sends a message to the agent, starting a turn when it is idle. Used only by the optional copilot reminder. */
  send(text: string, options: { messageId: string }): Promise<unknown>;
}
/** The agents a host can reach. Absent on hosts that do not run agents (the desktop app). */
export interface HostApi {
  readonly agents: { ref(agentId: string): HostAgentRef };
}

/** What a host hands an RPC handler. `api` is present only on hosts that run agents. */
export interface HandlerContext { readonly api?: HostApi }

/** The parts of a finished turn the copilot reminder reads. */
export interface TurnEndedEvent {
  readonly agent: { readonly id: string };
  readonly turnId?: string | null;
  readonly outcome: { readonly kind: string };
  readonly timeline: ReadonlyArray<{ readonly type: string; readonly name?: string; readonly status?: string }>;
}
export interface LifecycleEvents {
  "agent.turn_started": { readonly agent: { readonly id: string } };
  "agent.turn_ended": TurnEndedEvent;
  "agent.archived": { readonly agent: { readonly id: string } };
}

export interface ServerHost {
  /** "paseo" or "desktop"; informational. */
  readonly kind: string;
  /** True when the host runs agents: their IDs can be verified and the optional copilot reminder can reach them. */
  readonly runsAgents: boolean;
  registerSettings(definition: SettingsDefinition): void;
  handle<C extends RpcContract>(contract: C, handler: (input: RpcInput<C>, context: HandlerContext) => Promise<RpcOutput<C>> | RpcOutput<C>): void;
  /** Lifecycle hooks; hosts without agents do not provide them. Returns a remover. */
  on?<E extends keyof LifecycleEvents>(event: E, handler: (event: LifecycleEvents[E], context: HandlerContext) => Promise<void> | void): () => void;
}

/** Resolves and checks agents through the host API most recently handed to a handler or hook. */
export class AgentGateway {
  private paseo: HostApi | null = null;
  constructor(readonly service: CanvasService) {}
  bind(api: HostApi | undefined) { if (api) this.paseo = api; }
  api(): HostApi {
    if (!this.paseo) throw new CanvasError("UNAVAILABLE", "Open the canvas panel or retry after the agent session opens.");
    return this.paseo;
  }
  /** The name each verified agent signs comments with (its conversation title or provider), kept in memory. */
  readonly labels = new Map<string, string>();
  async verify(agentId: string, workspaceId?: string) {
    const agent = this.api().agents.ref(agentId);
    const refreshed = await agent.refresh();
    const info = (refreshed as { agent?: { title?: string | null; provider?: string | null } } | null)?.agent;
    if (info) this.labels.set(agentId, agentLabel(agentId, info.title, info.provider));
    if (!refreshed || agent.archivedAt || !agent.workspaceId) throw new CanvasError("FORBIDDEN", "Agent is unavailable or has no active workspace.");
    if (workspaceId && agent.workspaceId !== workspaceId) throw new CanvasError("FORBIDDEN", "Agent belongs to another workspace.");
    return agent;
  }
  async scope(owner: string) {
    const agentId = await this.service.owner(owner);
    if (!agentId) throw new CanvasError("FORBIDDEN", "Unknown/unbound canvas owner. Use canvas.agent.setup and reload the idle agent.");
    const agent = await this.verify(agentId);
    return { agentId, workspaceId: agent.workspaceId!, label: this.labels.get(agentId) };
  }
}
