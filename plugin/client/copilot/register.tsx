import React from 'react';
import { View } from 'react-native';
import { Icon } from '@getpaseo/plugin/client/react-native';
import type { PluginButtonContentProps, PluginButtonIconProps, PluginButtonRegistration, PluginClientContext } from '@getpaseo/plugin/client';
import * as rpc from '../../shared/rpc';
import { CopilotPopover, StatusDot, type CopilotApi, type CopilotView } from './CopilotPopover';
import { requestCanvasIntent } from './intent';
import { PILL_LABEL, PILL_TITLE, POLL_MS, pillStatus, providerModel, type PillEntry, type PillStatus } from './model';

const PANEL_ID = 'canvas';
type AgentSeen = { id: string; workspaceId?: string | null; status?: string | null; archivedAt?: string | null; title?: string | null };

function pillIcon(status: PillStatus) {
  return function LienzoPillIcon({ size, color, theme }: PluginButtonIconProps) {
    return <View style={{ width: size, height: size }}>
      <Icon name="Frame" size={size} color={color} />
      <View style={{ position: 'absolute', right: -2, top: -2 }}><StatusDot status={status} colors={theme.colors} size={7} /></View>
    </View>;
  };
}
const icons: Record<PillStatus, ReturnType<typeof pillIcon>> = { off: pillIcon('off'), on: pillIcon('on'), drawing: pillIcon('drawing') };

/**
 * One "Lienzo" composer pill per agent. Agents come from an owned agent-list subscription (snapshot, then updates,
 * and a fresh snapshot after a reconnect). The status dot is polled through canvas.copilot.list only while an agent
 * with the copilot on is running, plus one tail poll so "drawing now" clears.
 */
export function registerCopilotPills(client: PluginClientContext): () => void {
  // Hosts older than the composer-pill API (the manifest still admits Paseo 0.10.3) simply get no pill.
  if (typeof client.addComposerPill !== 'function' || !client.paseo?.agents?.list) return () => {};
  const pills = new Map<string, { registration: PluginButtonRegistration; workspaceId: string; status: PillStatus }>();
  const agents = new Map<string, AgentSeen>();
  const entries = new Map<string, PillEntry>();
  const lifetime = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined, polling = false;

  const show = (agentId: string) => {
    const pill = pills.get(agentId), status = pillStatus(entries.get(agentId));
    if (!pill || pill.status === status) return;
    pill.status = status; pill.registration.update({ icon: icons[status] });
  };
  const refresh = async () => {
    const ids = [...pills.keys()];
    if (!ids.length || lifetime.signal.aborted) return;
    try {
      const result = await client.rpc(rpc.listCopilot, { agentIds: ids });
      for (const [id, entry] of Object.entries(result.agents)) { entries.set(id, entry); show(id); }
    } catch { /* the daemon may be reloading; the next poll retries */ }
  };
  const schedule = () => {
    if (lifetime.signal.aborted || timer) return;
    const active = [...pills.keys()].some(id => entries.get(id)?.enabled && (agents.get(id)?.status === 'running' || entries.get(id)?.drawing));
    if (!active && !polling) return;
    polling = active;
    timer = setTimeout(() => { timer = undefined; void refresh().then(schedule); }, POLL_MS);
  };
  const changed = (view: CopilotView) => { entries.set(view.agentId, { enabled: view.copilot.enabled, drawing: view.drawing, hasTools: view.hasTools }); show(view.agentId); schedule(); };

  const api = (workspaceId: string, agentId: string): CopilotApi => ({
    read: () => client.rpc(rpc.readCopilot, { workspaceId, agentId }),
    set: patch => client.rpc(rpc.setCopilot, { workspaceId, agentId, patch, ...(agents.get(agentId)?.title ? { title: `Lienzo · ${agents.get(agentId)!.title!.slice(0, 280)}` } : {}) }),
    documents: async () => (await client.rpc(rpc.listDocuments, { workspaceId })).documents,
    goToLatest: view => {
      if (view.latest) requestCanvasIntent({ workspaceId, agentId, kind: 'latest', documentId: view.latest.documentId, ids: view.latest.ids, transactionId: view.latest.transactionId });
      client.openPanel(PANEL_ID, { workspaceId });
    },
    open: view => {
      if (view.copilot.documentId) requestCanvasIntent({ workspaceId, agentId, kind: 'open', documentId: view.copilot.documentId, ids: [] });
      client.openPanel(PANEL_ID, { workspaceId });
    },
    newAgent: async () => {
      // Same provider and model; the creation hook gives it the Lienzo tools, then the copilot is turned on for it.
      const source = await client.paseo.agents.ref(agentId).refresh();
      if (!source) throw new Error('UNAVAILABLE');
      const title = source.agent.title ? `${source.agent.title} · Lienzo` : 'New agent with Lienzo';
      const created = await client.paseo.workspaces.ref(workspaceId).agents.create({ config: { provider: providerModel(source.agent), ...(source.agent.currentModeId ? { modeId: source.agent.currentModeId } : {}) }, title });
      try { await client.rpc(rpc.setCopilot, { workspaceId, agentId: created.id, patch: { enabled: true }, title: `Lienzo · ${title}`.slice(0, 300) }); } catch { /* the agent exists; the copilot can be turned on from its pill */ }
      return { title };
    },
    changed,
  });

  const register = (agent: AgentSeen) => {
    if (lifetime.signal.aborted) return;
    agents.set(agent.id, { ...agents.get(agent.id), ...agent });
    if (agent.archivedAt || !agent.workspaceId) return unregister(agent.id);
    const existing = pills.get(agent.id);
    // Status changes arrive as upserts; re-registering would close an open popover, so only a move re-registers.
    if (existing?.workspaceId === agent.workspaceId) { schedule(); return; }
    existing?.registration.remove();
    const workspaceId = agent.workspaceId, agentId = agent.id, bound = api(workspaceId, agentId);
    const Content = (props: PluginButtonContentProps) => <CopilotPopover {...props} api={bound} />;
    const status = pillStatus(entries.get(agentId));
    pills.set(agentId, { workspaceId, status, registration: client.addComposerPill({ id: 'lienzo-copilot', workspaceId, agentId, button: { title: PILL_TITLE, label: PILL_LABEL, icon: icons[status], behavior: { kind: 'popover', Content } } }) });
  };
  const unregister = (agentId: string) => { pills.get(agentId)?.registration.remove(); pills.delete(agentId); };
  const removeAll = () => { for (const pill of pills.values()) pill.registration.remove(); pills.clear(); };

  void client.paseo.agents.list({ subscribe: {}, signal: lifetime.signal }).then(({ subscription }) => {
    subscription.subscribe({
      snapshot: ({ entries: list }) => {
        const seen = new Set(list.map(entry => entry.agent.id));
        for (const id of [...pills.keys()]) if (!seen.has(id)) unregister(id);
        for (const { agent } of list) register(agent);
        void refresh().then(schedule);
      },
      update: message => {
        if (message.type !== 'agent_update') return;
        const update = message.payload;
        if (update.kind === 'upsert') { register(update.agent); return; }
        unregister(update.agentId); agents.delete(update.agentId); entries.delete(update.agentId);
      },
    });
  }).catch(error => { if (!lifetime.signal.aborted) console.error('Lienzo copilot pills could not observe agents', error); });

  return () => { lifetime.abort(); clearTimeout(timer); removeAll(); };
}
