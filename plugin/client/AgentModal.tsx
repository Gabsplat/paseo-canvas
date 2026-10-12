import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useAgent, usePaseo, useRpc } from '@getpaseo/plugin/client';
import { copyText, useToast } from '@getpaseo/plugin/client/react-native';
import { configureInjection, configureSharing, readInjection, readSharing } from '../shared/rpc';
import type { SharingMode } from '../shared/model';
import type { CanvasController } from './useCanvas';
import { Modal, Button, CheckRow, Input, OptionRow, Segments, Txt, friendlyError, useUI } from './ui';
const statusLabels = { idle: 'idle', running: 'working', error: 'with an error', closed: 'closed', initializing: 'starting' } as const;
function ConnectionDetails({ id }: { id: string }) {
  const agent = useAgent(id, a => ({ title: a.title, provider: a.provider }));
  return <View style={{ gap: 4 }}><Txt kind="small" muted>Gets the actions from this Lienzo</Txt><Txt kind="bodyStrong">{agent?.title || 'Untitled agent'}</Txt>{agent && <Txt kind="label" muted>{agent.provider}</Txt>}</View>;
}
function AgentOption({ id, connect, disabled, selected }: { id: string; connect: (id: string, provider: string) => void; disabled: boolean; selected: boolean }) {
  const u = useUI(), agent = useAgent(id, a => ({ title: a.title, provider: a.provider, status: a.status }));
  if (!agent) return null;
  const label = statusLabels[agent.status], dot = agent.status === 'error' ? u.c.statusDanger : agent.status === 'running' ? u.c.statusSuccess : agent.status === 'initializing' ? u.c.statusWarning : u.c.foregroundMuted;
  return <OptionRow label={`${agent.title || 'Untitled agent'} · ${label}`} selected={selected} tone="acento" disabled={disabled || agent.status === 'closed'} onPress={() => connect(id, agent.provider)}><View style={{ gap: 6 }}><Txt kind="bodyStrong">{agent.title || 'Untitled agent'}</Txt><View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}><Txt kind="label" muted>{agent.provider}</Txt><View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dot }} /><Txt kind="small" muted>{label}</Txt></View></View></View></OptionRow>;
}
export function AgentModal({ controller: c, open, close, onReload }: { controller: CanvasController; open: boolean; close: () => void; onReload: () => void }) {
  const u = useUI(), toast = useToast(), paseo = usePaseo(), read = useRpc(readInjection), configure = useRpc(configureInjection), readMode = useRpc(readSharing), configureMode = useRpc(configureSharing), [sharing, setSharing] = useState<SharingMode | null>(null), [agents, setAgents] = useState<{ id: string; provider: string }[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(false), [injection, setInjection] = useState<{ revision: number; workspaceIds: string[] } | null>(null), [setup, setSetup] = useState<Awaited<ReturnType<typeof c.api.setup>> | null>(null), [selected, setSelected] = useState<{ id: string; provider: string } | null>(null);
  useEffect(() => {
    if (!open) return; let live = true; setLoading(true); setError('');
    const load = async () => { try { const [result, settings, mode] = await Promise.all([paseo.agents.list(), read({}), readMode({ workspaceId: c.workspaceId })]); if (!live) return; setSharing(mode.mode); setAgents(result.entries.filter(e => e.agent.workspaceId === c.workspaceId).map(e => ({ id: e.agent.id, provider: e.agent.provider }))); setInjection(settings); } catch (e) { if (live) setError(friendlyError(e)); } finally { if (live) setLoading(false); } };
    void load(); const unsub = paseo.agents.subscribe(() => { void load(); }); return () => { live = false; unsub(); };
  }, [open, c.workspaceId, paseo]);
  function toggleInjection(workspaceId: string) {
    return c.task(async () => { if (!injection) return; const next = await configure({ workspaceId, expectedRevision: injection.revision, enabled: !injection.workspaceIds.includes(workspaceId) }); setInjection(next); });
  }
  function changeSharing(mode: SharingMode) {
    return c.task(async () => { setSharing((await configureMode({ workspaceId: c.workspaceId, mode })).mode); });
  }
  async function connect(id: string | null, provider = '') {
    let v = c.current.current;
    // A connection belongs to a document. In a workspace with none yet, connecting creates an empty one first.
    if (!v) { if (!id) return; const created = await c.create({ title: 'Untitled Lienzo', description: '', example: false, blocks: [], groups: [], links: [], selectedIds: [], communication: { instructions: '', intent: '', audience: '' } }); if (!created) return; v = created; }
    const target = v;
    await c.task(async () => { const result = await c.api.connect({ workspaceId: c.workspaceId, documentId: target.document.id, expectedRevision: target.document.revision, connection: id ? { agentId: id, workspaceId: c.workspaceId } : null }); if (c.current.current?.document.id !== target.document.id) return; c.accept(result.view); if (result.requiresReload) onReload(); setSelected(id ? { id, provider } : null); });
  }
  return <Modal title="Agent" open={open} onOpenChange={v => { if (!v) close(); }}><Modal.Content>{c.view?.connection ? <ConnectionDetails id={c.view.connection.agentId} /> : <Txt>{c.view ? 'No agent gets the actions from this Lienzo.' : 'This workspace has no Lienzo yet. Choosing an agent creates an empty one, already connected.'}</Txt>}<Txt kind="small" muted>It connects by itself: the agent that uses this Lienzo gets your actions. Choose one here only to keep it fixed.</Txt>{sharing && <View style={{ gap: 8 }}><Txt kind="label" muted>Lienzos in this workspace</Txt><Segments value={sharing} options={[{ value: 'shared', label: 'Shared' }, { value: 'agent', label: 'One per agent' }]} onChange={mode => { void changeSharing(mode); }} /><Txt kind="small" muted>{sharing === 'shared' ? 'Every agent in this workspace sees and edits the same Lienzos.' : 'Each agent sees only the Lienzos it created or was given. You still see them all.'}</Txt></View>}<Txt kind="label" muted>Agents in this workspace</Txt>{loading && <Txt kind="small" muted>Loading agents…</Txt>}{error && <Txt kind="small" style={{ color: u.c.statusDanger }}>{error}</Txt>}{!loading && !agents.length && <Txt kind="small" muted>No agents in this workspace yet. Create one in Paseo and connect again.</Txt>}{agents.map(agent => <AgentOption key={agent.id} id={agent.id} selected={c.view?.connection?.agentId === agent.id} disabled={c.busy || c.loading || c.offline} connect={(id, provider) => { void connect(id, provider); }} />)}{c.view?.connection && <Button label="Disconnect" variant="danger" small disabled={c.busy || c.offline} onPress={() => { void connect(null); }} style={{ alignSelf: 'flex-start', borderColor: 'transparent' }} />}
    <Txt kind="small" muted>Every agent you create gets the Lienzo tools, with the copilot off until you turn it on from the Lienzo chip in its conversation. An agent created before that does not; create a new one.</Txt>
    {!c.view?.connection && <Txt kind="small" muted>To set up an agent that already existed, connect it above first.</Txt>}<Button label="Set up an existing agent" icon="Wrench" disabled={c.busy || !c.view?.connection} onPress={() => { const id = c.view!.connection!.agentId, provider = selected?.id === id ? selected.provider : agents.find(a => a.id === id)?.provider; if (!['codex', 'claude', 'opencode'].includes(provider ?? '')) { setError('Automatic setup supports Codex, Claude and OpenCode.'); return; } void c.task(async () => { const result = await c.api.setup({ workspaceId: c.workspaceId, agentId: id, provider: provider as 'codex' | 'claude' | 'opencode' }); setSetup(result); }); }} />
    {setup && <View style={{ gap: 12 }}><Txt>Add this to the agent’s configuration in its provider or project. Then reload the agent while it is idle.</Txt><Input value={setup.configuration} readOnly multiline mono /><Button label="Copy configuration" icon="Copy" onPress={() => { void copyText(setup.configuration).then(() => toast.show('Configuration copied')).catch(() => toast.error('Select the configuration and copy it by hand.')); }} />{setup.requiresReload && <Txt kind="small" muted>Connection saved. Reload the agent so it gets the Lienzo tools.</Txt>}</View>}
  </Modal.Content></Modal>;
}
