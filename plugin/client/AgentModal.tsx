import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useAgent, usePaseo, useRpc } from '@getpaseo/plugin/client';
import { copyText, useToast } from '@getpaseo/plugin/client/react-native';
import { configureInjection, readInjection } from '../shared/rpc';
import type { CanvasController } from './useCanvas';
import { Modal, Button, CheckRow, Input, OptionRow, Txt, useUI } from './ui';
const statusLabels = { idle: 'inactivo', running: 'trabajando', error: 'con error', closed: 'cerrado', initializing: 'iniciando' } as const;
function ConnectionDetails({ id }: { id: string }) {
  const agent = useAgent(id, a => ({ title: a.title, provider: a.provider }));
  return <View style={{ gap: 4 }}><Txt kind="small" muted>Recibe las acciones de este lienzo</Txt><Txt kind="bodyStrong">{agent?.title || 'Agente sin título'}</Txt>{agent && <Txt kind="label" muted>{agent.provider}</Txt>}<Txt kind="code" muted selectable>{id}</Txt></View>;
}
function AgentOption({ id, connect, disabled, selected }: { id: string; connect: (id: string, provider: string) => void; disabled: boolean; selected: boolean }) {
  const u = useUI(), agent = useAgent(id, a => ({ title: a.title, provider: a.provider, status: a.status }));
  if (!agent) return null;
  const label = statusLabels[agent.status], dot = agent.status === 'error' ? u.c.statusDanger : agent.status === 'running' ? u.c.statusSuccess : agent.status === 'initializing' ? u.c.statusWarning : u.c.foregroundMuted;
  return <OptionRow label={`${agent.title || 'Agente sin título'} · ${label}`} selected={selected} tone="acento" disabled={disabled || agent.status === 'closed'} onPress={() => connect(id, agent.provider)}><View style={{ gap: 6 }}><Txt kind="bodyStrong">{agent.title || 'Agente sin título'}</Txt><View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}><Txt kind="label" muted>{agent.provider}</Txt><View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dot }} /><Txt kind="small" muted>{label}</Txt></View></View></View></OptionRow>;
}
export function AgentModal({ controller: c, open, close, onReload }: { controller: CanvasController; open: boolean; close: () => void; onReload: () => void }) {
  const u = useUI(), toast = useToast(), paseo = usePaseo(), read = useRpc(readInjection), configure = useRpc(configureInjection), [agents, setAgents] = useState<{ id: string; provider: string }[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(false), [injection, setInjection] = useState<{ revision: number; workspaceIds: string[] } | null>(null), [setup, setSetup] = useState<Awaited<ReturnType<typeof c.api.setup>> | null>(null), [selected, setSelected] = useState<{ id: string; provider: string } | null>(null);
  useEffect(() => {
    if (!open) return; let live = true; setLoading(true); setError('');
    const load = async () => { try { const [result, settings] = await Promise.all([paseo.agents.list(), read({})]); if (!live) return; setAgents(result.entries.filter(e => e.agent.workspaceId === c.workspaceId).map(e => ({ id: e.agent.id, provider: e.agent.provider }))); setInjection(settings); } catch (e) { if (live) setError(String(e)); } finally { if (live) setLoading(false); } };
    void load(); const unsub = paseo.agents.subscribe(() => { void load(); }); return () => { live = false; unsub(); };
  }, [open, c.workspaceId, paseo]);
  async function connect(id: string | null, provider = '') {
    const v = c.current.current; if (!v) return;
    await c.task(async () => { const result = await c.api.connect({ workspaceId: c.workspaceId, documentId: v.document.id, expectedRevision: v.document.revision, connection: id ? { agentId: id, workspaceId: c.workspaceId } : null }); if (c.current.current?.document.id !== v.document.id) return; c.accept(result.view); if (result.requiresReload) onReload(); setSelected(id ? { id, provider } : null); });
  }
  return <Modal title="Agente conectado" open={open} onOpenChange={v => { if (!v) close(); }}><Modal.Content>{c.view?.connection ? <ConnectionDetails id={c.view.connection.agentId} /> : <Txt>Ningún agente recibe las acciones de este lienzo.</Txt>}<Txt kind="label" muted>Agentes de este espacio</Txt>{loading && <Txt kind="small" muted>Cargando agentes…</Txt>}{error && <Txt kind="code" selectable style={{ color: u.c.statusDanger }}>{error}</Txt>}{!loading && !agents.length && <Txt kind="small" muted>No hay agentes disponibles en este espacio. Crea uno desde Paseo y vuelve a conectar.</Txt>}{agents.map(agent => <AgentOption key={agent.id} id={agent.id} selected={c.view?.connection?.agentId === agent.id} disabled={c.busy || !c.view || c.offline} connect={(id, provider) => { void connect(id, provider); }} />)}{c.view?.connection && <Button label="Desconectar" variant="danger" small disabled={c.busy || c.offline} onPress={() => { void connect(null); }} style={{ alignSelf: 'flex-start', borderColor: 'transparent' }} />}
    {injection && <><CheckRow label="Dar las herramientas de Lienzo a los agentes nuevos de este espacio" checked={injection.workspaceIds.includes(c.workspaceId)} disabled={c.busy || c.offline} onPress={() => { void c.task(async () => { const next = await configure({ workspaceId: c.workspaceId, expectedRevision: injection.revision, enabled: !injection.workspaceIds.includes(c.workspaceId) }); setInjection(next); }); }} /><Txt kind="small" muted>Autoriza herramientas para los documentos de este espacio. Conectar elige quién recibe tus acciones.</Txt></>}
    <Button label="Configurar un agente existente" icon="Wrench" disabled={c.busy || !c.view?.connection} onPress={() => { const id = c.view!.connection!.agentId, provider = selected?.id === id ? selected.provider : agents.find(a => a.id === id)?.provider; if (!['codex', 'claude', 'opencode'].includes(provider ?? '')) { setError('La configuración automática admite Codex, Claude y OpenCode.'); return; } void c.task(async () => { const result = await c.api.setup({ workspaceId: c.workspaceId, agentId: id, provider: provider as 'codex' | 'claude' | 'opencode' }); setSetup(result); }); }} />
    {setup && <View style={{ gap: 12 }}><Txt>{setup.instructions}</Txt><Input value={setup.configuration} readOnly multiline mono /><Button label="Copiar configuración" icon="Copy" onPress={() => { void copyText(setup.configuration).then(() => toast.show('Configuración copiada')).catch(() => toast.error('Selecciona la configuración y cópiala a mano.')); }} />{setup.requiresReload && <Txt kind="small" muted>Conexión guardada. Recarga el agente para que reciba las herramientas de Lienzo.</Txt>}</View>}
  </Modal.Content></Modal>;
}
