import type { RpcInput } from "@getpaseo/plugin";
import type { PluginLifecycleEvents } from "@getpaseo/plugin/server";
import * as rpc from "../shared/rpc";
import { copilotSettingsSchema, documentContentSchema, type AgentEvent, type CopilotSettings } from "../shared/model";
import { CanvasError } from "../shared/errors";
import { documentRecord, type CanvasState, type CopilotRecord, type DocumentRecord } from "./store";
import { newId } from "./reducer";
import { latestAgent, type CanvasService } from "./service";
import type { AgentGateway } from "./agent-integration";

/** How long the pill keeps saying "drawing" after a Lienzo tool call ends. */
export const DRAWING_WINDOW_MS = 3000;
const NOTICE_KIND = "copilot.mode";
const cadenceText: Record<CopilotSettings["cadence"], string> = {
  thinking: "after each bit of reasoning or tool use",
  step: "after each step worth showing",
  task: "once, when the task is done",
  custom: "following the person's rule",
};

/** What every canvas MCP response carries, so the agent always knows whether to draw. */
export type CopilotSummary = Pick<CopilotSettings, "enabled" | "cadence" | "rule" | "documentId">;
const defaults = (): CopilotSettings => copilotSettingsSchema.parse({});
const settingsOf = (record: CopilotRecord | undefined): CopilotSettings => {
  const { enabled, cadence, rule, remind, documentId } = record ?? defaults();
  return { enabled, cadence, rule, remind, documentId };
};

/**
 * True when a timeline tool name is one of ours. Providers prefix MCP tools differently
 * (Claude: mcp__paseo-canvas__canvas_apply; others: paseo-canvas.canvas_apply or the bare name).
 */
export function isLienzoTool(name: string, toolNames: readonly string[]): boolean {
  if (/paseo-canvas/.test(name)) return true;
  return toolNames.some(tool => name === tool || [`__${tool}`, `.${tool}`, `/${tool}`, `:${tool}`].some(suffix => name.endsWith(suffix)));
}

/** In-memory: Lienzo tool calls in flight per agent and when the last one ended. Not persisted on purpose. */
export class ToolActivity {
  private readonly inFlight = new Map<string, number>();
  private readonly lastEnded = new Map<string, number>();
  private readonly turnStarted = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}
  start(agentId: string) { this.inFlight.set(agentId, (this.inFlight.get(agentId) ?? 0) + 1); }
  end(agentId: string) {
    const count = (this.inFlight.get(agentId) ?? 1) - 1;
    if (count > 0) this.inFlight.set(agentId, count); else this.inFlight.delete(agentId);
    this.lastEnded.set(agentId, this.now());
  }
  turn(agentId: string) { this.turnStarted.set(agentId, this.now()); }
  drawing(agentId: string) {
    const ended = this.lastEnded.get(agentId);
    return (this.inFlight.get(agentId) ?? 0) > 0 || ended !== undefined && this.now() - ended < DRAWING_WINDOW_MS;
  }
  lastToolAt(agentId: string) {
    if ((this.inFlight.get(agentId) ?? 0) > 0) return new Date(this.now()).toISOString();
    const ended = this.lastEnded.get(agentId); return ended === undefined ? null : new Date(ended).toISOString();
  }
  /** A Lienzo tool ran during the turn that is ending (a backstop for timelines that do not name our tools). */
  usedThisTurn(agentId: string) {
    const started = this.turnStarted.get(agentId), ended = this.lastEnded.get(agentId);
    return (this.inFlight.get(agentId) ?? 0) > 0 || started !== undefined && ended !== undefined && ended >= started;
  }
}

/** The one-line notice queued as a batched canvas event: delivered with the next feedback, never as its own turn. */
export function noticeLabel(settings: CopilotSettings) {
  if (!settings.enabled) return "Lienzo copilot is off: do not draw unless asked.";
  return `Lienzo copilot is on: draw ${settings.cadence === "custom" && settings.rule ? `when ${settings.rule.slice(0, 200)}` : cadenceText[settings.cadence]} in Lienzo ${settings.documentId}.`;
}
function queueNotice(record: DocumentRecord, agentId: string, settings: CopilotSettings) {
  const inBatch = new Set(record.outboundBatches.filter(batch => batch.status !== "completed").flatMap(batch => batch.eventIds));
  // Only the latest mode matters: an older notice that has not left yet is replaced.
  record.events = record.events.filter(event => !(event.action.kind === NOTICE_KIND && event.agentId === agentId && event.status === "pending" && !inBatch.has(event.id)));
  if (!settings.enabled) return;
  const event: AgentEvent = {
    id: newId("evt"), documentId: record.document.id, agentId, workspaceId: record.document.workspaceId, createdAt: new Date().toISOString(), revision: record.document.revision,
    action: { kind: NOTICE_KIND, label: noticeLabel(settings), payload: { enabled: true, cadence: settings.cadence, rule: settings.rule, documentId: settings.documentId }, targetIds: [], delivery: "batched" },
    context: documentContentSchema.parse({ title: record.document.title, blocks: [], groups: [], communication: record.document.communication }),
    status: "pending",
  };
  record.events.push(event);
  record.runtimeVersion++;
}

export function reminderText(settings: CopilotSettings) {
  return `[Lienzo] The copilot is on (${settings.cadence === "task" ? "once per task" : "after each step"}) and this turn changed things without updating the canvas. Update Lienzo ${settings.documentId} with what is worth showing, in the Hoja for this topic, or say in one line why not.`;
}

export type ReminderDecision = "off" | "no-remind" | "cadence" | "outcome" | "repeat" | "drew" | "quiet" | "busy" | "unavailable" | "sent";

export class CopilotService {
  readonly activity: ToolActivity;
  constructor(readonly service: CanvasService, readonly toolNames: readonly string[], now: () => number = Date.now) { this.activity = new ToolActivity(now); }

  async summary(agentId: string): Promise<CopilotSummary> {
    const { enabled, cadence, rule, documentId } = settingsOf((await this.service.store.read()).copilot[agentId]);
    return { enabled, cadence, rule, documentId };
  }
  private view(state: CanvasState, agentId: string, workspaceId?: string) {
    const settings = settingsOf(state.copilot[agentId]);
    const record = settings.documentId && Object.hasOwn(state.documents, settings.documentId) ? state.documents[settings.documentId] : undefined;
    const usable = record && (!workspaceId || record.document.workspaceId === workspaceId) ? record : undefined;
    const latest = usable ? latestAgent(usable, agentId) : null;
    const titles = latest ? latest.ids.flatMap(id => { const entity = [...usable!.document.blocks, ...usable!.document.groups].find(item => item.id === id); return entity?.title ? [entity.title] : []; }).slice(0, 3) : [];
    return {
      agentId, copilot: settings,
      hasTools: Object.values(state.owners).some(owner => owner.agentId === agentId),
      drawing: this.activity.drawing(agentId), lastToolAt: this.activity.lastToolAt(agentId),
      document: usable ? { id: usable.document.id, title: usable.document.title } : null,
      latest: latest && usable ? { ...latest, documentId: usable.document.id, titles } : null,
    };
  }
  async read(input: RpcInput<typeof rpc.readCopilot>) { return this.view(await this.service.store.read(), input.agentId, input.workspaceId); }
  async list(input: RpcInput<typeof rpc.listCopilot>) {
    const state = await this.service.store.read();
    return { agents: Object.fromEntries(input.agentIds.map(agentId => { const view = this.view(state, agentId); return [agentId, { enabled: view.copilot.enabled, drawing: view.drawing, hasTools: view.hasTools }]; })) };
  }
  /**
   * Changes an agent's copilot. Turning it on without a Lienzo creates one for the conversation, connected to the agent.
   * Attaching an existing Lienzo connects it to this agent. Turning on, or changing how often to draw while on, queues
   * a one-line notice through the canvas event delivery; it rides along with the next feedback and starts no turn.
   */
  async set(input: RpcInput<typeof rpc.setCopilot>) {
    const current = settingsOf((await this.service.store.read()).copilot[input.agentId]);
    const attach = input.patch.documentId !== undefined ? input.patch.documentId : current.documentId;
    const enabled = input.patch.enabled ?? current.enabled, cadence = input.patch.cadence ?? current.cadence, rule = input.patch.rule ?? current.rule;
    // Refuse before anything is created, so a rejected change leaves no empty Lienzo behind.
    if (enabled && cadence === "custom" && !rule.trim()) throw new CanvasError("VALIDATION", "A custom cadence needs a rule: say when the agent should draw.");
    let created: string | undefined;
    if (enabled && !attach) {
      const document = await this.service.create({ workspaceId: input.workspaceId, content: documentContentSchema.parse({ title: input.title ?? "Lienzo", description: "This conversation's Lienzo: the agent draws here while the copilot is on.", blocks: [], groups: [], communication: { instructions: "" } }) }, "user", { agentId: input.agentId, workspaceId: input.workspaceId });
      created = document.document.id;
    }
    return this.service.store.transaction(state => {
      const before = settingsOf(state.copilot[input.agentId]);
      const next: CopilotSettings = { ...before };
      for (const key of ["enabled", "cadence", "rule", "remind"] as const) if (input.patch[key] !== undefined) (next as Record<string, unknown>)[key] = input.patch[key];
      if (input.patch.documentId !== undefined) next.documentId = input.patch.documentId;
      if (created && !next.documentId) next.documentId = created;
      if (next.documentId && next.documentId !== before.documentId) {
        const record = documentRecord(state, next.documentId, input.workspaceId);
        if (record.connection?.agentId !== input.agentId) { record.connection = { agentId: input.agentId, workspaceId: input.workspaceId }; record.runtimeVersion++; }
      }
      if (next.cadence === "custom" && next.enabled && !next.rule.trim()) throw new CanvasError("VALIDATION", "A custom cadence needs a rule: say when the agent should draw.");
      const record = state.copilot[input.agentId];
      state.copilot[input.agentId] = { ...next, workspaceId: input.workspaceId, reminded: record?.reminded ?? false, updatedAt: new Date().toISOString() };
      const changedMode = next.enabled !== before.enabled || next.enabled && (next.cadence !== before.cadence || next.rule !== before.rule || next.documentId !== before.documentId);
      if (changedMode) {
        for (const id of new Set([before.documentId, next.documentId])) {
          if (!id || !Object.hasOwn(state.documents, id)) continue;
          queueNotice(state.documents[id], input.agentId, id === next.documentId ? next : { ...next, enabled: false });
        }
      }
      return this.view(state, input.agentId, input.workspaceId);
    });
  }
  /** Agent gone: its copilot entry goes too. */
  forget(agentId: string) {
    return this.service.store.transaction(state => { delete state.copilot[agentId]; });
  }

  /**
   * The reminder rule. Sends one short follow-up only when: the copilot is on with remind, the cadence is step or task,
   * the turn completed, it changed things (a tool call that is not ours), no Lienzo tool ran, the agent is idle, and
   * the previous turn did not already get a reminder. Never for thinking (or custom).
   */
  async turnEnded(event: PluginLifecycleEvents["agent.turn_ended"], gateway: AgentGateway): Promise<ReminderDecision> {
    const agentId = event.agent.id;
    const record = (await this.service.store.read()).copilot[agentId];
    const settings = settingsOf(record);
    if (!settings.enabled) return "off";
    if (!settings.remind) return "no-remind";
    if (settings.cadence !== "step" && settings.cadence !== "task") return "cadence";
    if (event.outcome.kind !== "completed") return "outcome";
    const mark = (reminded: boolean) => this.service.store.transaction(state => { const entry = state.copilot[agentId]; if (entry && entry.reminded !== reminded) entry.reminded = reminded; });
    if (record?.reminded) { await mark(false); return "repeat"; }
    const calls = event.timeline.filter(item => item.type === "tool_call");
    if (calls.some(call => isLienzoTool(call.name, this.toolNames)) || this.activity.usedThisTurn(agentId)) return "drew";
    if (!calls.some(call => call.status !== "canceled")) return "quiet";
    let agent;
    try { agent = await gateway.verify(agentId); } catch { return "unavailable"; }
    // A send to a busy agent would interrupt its turn (for example one started by canvas feedback just now).
    // The turn that is ending may still be reported as active; only a different turn counts as busy.
    if (agent.status === "closed" || agent.status === "error") return "unavailable";
    if ((agent.status === "running" || agent.status === "initializing") && agent.activeTurn?.turnId !== (event.turnId ?? undefined)) return "busy";
    await agent.send(reminderText(settings), { messageId: newId("msg") });
    await mark(true);
    return "sent";
  }
}
