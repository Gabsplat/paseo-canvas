import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { AgentSheetProps } from '../../../../plugin/client/host/contract';
import { Button, Input, Modal, Segments, Txt, useUI } from '../../../../plugin/client/ui';
import { RECENT_MS } from '../shared/rpc';
import { copyText, refreshStatus, useDesktopStatus, useToast } from './host';

type Client = 'claude' | 'codex' | 'cursor';
const clients: readonly { value: Client; label: string }[] = [{ value: 'claude', label: 'Claude Code' }, { value: 'codex', label: 'Codex' }, { value: 'cursor', label: 'Cursor' }];
function setup(client: Client, url: string) {
  if (client === 'claude') return { where: 'Run this once in a terminal:', text: `claude mcp add lienzo --transport http ${url}` };
  if (client === 'codex') return { where: 'Add this to ~/.codex/config.toml:', text: `[mcp_servers.lienzo]\nurl = "${url}"` };
  return { where: 'Add this to ~/.cursor/mcp.json (or .cursor/mcp.json in a project):', text: JSON.stringify({ mcpServers: { lienzo: { url } } }, null, 2) };
}
function ago(iso: string, now: number) {
  const minutes = Math.round((now - Date.parse(iso)) / 60000);
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : minutes < 60 * 24 ? `${Math.round(minutes / 60)} h ago` : new Date(iso).toLocaleDateString();
}

/**
 * Replaces Paseo's agent dialog in the desktop app. The app runs no agents: an agent connects to Lienzo's MCP server
 * from its own app. This gives the command and shows which agents have actually called in.
 */
export function ConnectAgentSheet({ open, close, connectedAgentId }: AgentSheetProps) {
  const u = useUI(), toast = useToast(), status = useDesktopStatus(), [client, setClient] = useState<Client>('claude'), [now, setNow] = useState(Date.now());
  useEffect(() => { if (!open) return; void refreshStatus(); setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(timer); }, [open]);
  const mcp = status?.mcp, snippet = mcp ? setup(client, mcp.url) : null;
  const recent = (mcp?.clients ?? []).filter(entry => now - Date.parse(entry.lastSeenAt) < RECENT_MS), earlier = (mcp?.clients ?? []).filter(entry => !recent.includes(entry));
  const receiver = connectedAgentId ? mcp?.clients.find(entry => entry.agentId === connectedAgentId)?.name ?? connectedAgentId.replace(/^mcp:/, '') : null;
  const copy = (text: string) => { void copyText(text).then(() => toast.show('Copied', { variant: 'success' })).catch(() => toast.error('Could not copy. Select the text and copy it by hand.')); };
  return <Modal title="Connect an agent" open={open} onOpenChange={value => { if (!value) close(); }}><Modal.Content>
    <Txt>Agents use this Lienzo through MCP. Add it once to the agent you work with; it can then read, draw and edit here.</Txt>
    {!status && <Txt kind="small" muted>Checking the MCP server…</Txt>}
    {mcp && !mcp.listening && <View style={{ backgroundColor: u.wash('riesgo'), borderRadius: 8, padding: 12, gap: 4 }}><Txt kind="bodyStrong">Agents cannot connect right now</Txt><Txt kind="small">{mcp.error ?? 'The MCP server is not running.'}</Txt></View>}
    {mcp && snippet && <View style={{ gap: 10 }}>
      <Segments value={client} options={clients} onChange={setClient} />
      <Txt kind="small" muted>{snippet.where}</Txt>
      <Input value={snippet.text} readOnly multiline={client !== 'claude'} mono />
      <Button label="Copy" icon="Copy" small onPress={() => copy(snippet.text)} style={{ alignSelf: 'flex-start' }} />
      <Txt kind="small" muted>Server: {mcp.url}. Only programs on this computer can reach it.</Txt>
    </View>}
    <View style={{ gap: 8 }}>
      <Txt kind="label" muted>Agents seen</Txt>
      {mcp && !mcp.clients.length && <Txt kind="small" muted>No agent has connected since Lienzo started. After adding it, start a new session of the agent.</Txt>}
      {[...recent, ...earlier].map(entry => <View key={entry.agentId} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: recent.includes(entry) ? u.c.statusSuccess : u.c.foregroundMuted }} />
        <Txt style={{ flexShrink: 1 }} numberOfLines={1}>{entry.name}{entry.version ? ` ${entry.version}` : ''}</Txt>
        <Txt kind="small" muted>{recent.includes(entry) ? 'connected' : 'last seen'} {ago(entry.lastSeenAt, now)}{entry.toolCalls ? ` · ${entry.toolCalls} tool ${entry.toolCalls === 1 ? 'call' : 'calls'}` : ''}</Txt>
      </View>)}
      {receiver && <Txt kind="small" muted>{receiver} last worked on this Lienzo.</Txt>}
    </View>
    <View style={{ gap: 4, borderTopWidth: 1, borderColor: u.c.border, paddingTop: 14 }}>
      <Txt kind="bodyStrong">Talk to the agent in its own app</Txt>
      <Txt kind="small" muted>The canvas never messages the agent. Select something here and say “look at what I selected” in your conversation: the agent reads the selection with its tools. Agents seen are the ones that called in; Lienzo cannot tell whether they are working.</Txt>
    </View>
  </Modal.Content></Modal>;
}
