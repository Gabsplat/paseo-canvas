import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { AgentSheetProps } from '../../../../plugin/client/host/contract';
import { tokens } from '../../../../plugin/client/tokens';
import { Button, Chip, Input, Modal, Segments, Txt, useUI } from '../../../../plugin/client/ui';
import { RECENT_MS, remoteRegenerate, remoteSet, remoteStatus, type RemoteStatus } from '../shared/rpc';
import { call, copyText, refreshStatus, useDesktopStatus, useToast } from './host';
import { Switch } from './Updates';

type Client = 'claude' | 'codex' | 'cursor';
const clients: readonly { value: Client; label: string }[] = [{ value: 'claude', label: 'Claude Code' }, { value: 'codex', label: 'Codex' }, { value: 'cursor', label: 'Cursor' }];
/** The set-up for one agent; with a token, for an agent on another computer (it sends the token as a bearer header). */
export function setup(client: Client, url: string, token?: string) {
  if (client === 'claude') return { where: 'Run this once in a terminal:', text: `claude mcp add lienzo --transport http ${url}${token ? ` --header "Authorization: Bearer ${token}"` : ''}` };
  if (client === 'codex') return { where: 'Add this to ~/.codex/config.toml:', text: `[mcp_servers.lienzo]\nurl = "${url}"${token ? `\nhttp_headers = { Authorization = "Bearer ${token}" }` : ''}` };
  return { where: 'Add this to ~/.cursor/mcp.json (or .cursor/mcp.json in a project):', text: JSON.stringify({ mcpServers: { lienzo: token ? { url, headers: { Authorization: `Bearer ${token}` } } : { url } } }, null, 2) };
}
/** `lz_AbCd••••••••••••wxyz`: recognisable, never usable. The real token is only ever copied. */
export const maskToken = (token: string) => `${token.slice(0, 7)}${tokens.sharing.tokenMask.repeat(12)}${token.slice(-4)}`;
const addressKind: Record<RemoteStatus['addresses'][number]['kind'], string> = { serve: 'tailscale serve, https', magicdns: 'Tailscale name', tailscale: 'Tailscale address', lan: 'local network' };
function ago(iso: string, now: number) {
  const minutes = Math.round((now - Date.parse(iso)) / 60000);
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : minutes < 60 * 24 ? `${Math.round(minutes / 60)} h ago` : new Date(iso).toLocaleDateString();
}

/** The dot on the Menu button and the Agent row while agents on other computers may connect. */
export function SharingBadge() {
  const u = useUI(), status = useDesktopStatus();
  if (!status?.mcp.sharing) return null;
  const { dot, ring } = tokens.sharing;
  return <View accessibilityLabel="Shared with other computers" style={{ width: dot + ring * 2, height: dot + ring * 2, borderRadius: dot, borderWidth: ring, borderColor: u.c.surface1, backgroundColor: u.tone(tokens.sharing.tone) }} />;
}

/**
 * Replaces Paseo's agent dialog in the desktop app. The app runs no agents: an agent connects to Lienzo's MCP server
 * from its own app. This gives the command and shows which agents have actually called in.
 */
export function ConnectAgentSheet({ open, close, connectedAgentId }: AgentSheetProps) {
  return <Modal title="Connect an agent" open={open} onOpenChange={value => { if (!value) close(); }}><Modal.Content>
    {open && <ConnectAgentBody connectedAgentId={connectedAgentId} />}
  </Modal.Content></Modal>;
}
/** The sheet's content; Settings → Agents shows it inline. */
export function ConnectAgentBody({ connectedAgentId }: { connectedAgentId: string | null }) {
  const u = useUI(), toast = useToast(), status = useDesktopStatus(), [client, setClient] = useState<Client>('claude'), [now, setNow] = useState(Date.now());
  useEffect(() => { void refreshStatus(); setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(timer); }, []);
  const mcp = status?.mcp, snippet = mcp ? setup(client, mcp.url) : null;
  const recent = (mcp?.clients ?? []).filter(entry => now - Date.parse(entry.lastSeenAt) < RECENT_MS), earlier = (mcp?.clients ?? []).filter(entry => !recent.includes(entry));
  const receiver = connectedAgentId ? mcp?.clients.find(entry => entry.agentId === connectedAgentId)?.name ?? connectedAgentId.replace(/^mcp:/, '') : null;
  const copy = (text: string, what = 'Copied') => { void copyText(text).then(() => toast.show(what, { variant: 'success' })).catch(() => toast.error('Could not copy. Select the text and copy it by hand.')); };
  return <View style={{ gap: 16 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <Txt style={{ flexShrink: 1 }}>Agents use this Lienzo through MCP. Add it once to the agent you work with; it can then read, draw and edit here.</Txt>
      {mcp?.sharing && <Chip label="Shared on your network" tone={tokens.sharing.tone} icon="RadioTower" />}
    </View>
    {!status && <Txt kind="small" muted>Checking the MCP server…</Txt>}
    {mcp && !mcp.listening && <View style={{ backgroundColor: u.wash('riesgo'), borderRadius: 8, padding: 12, gap: 4 }}><Txt kind="bodyStrong">Agents cannot connect right now</Txt><Txt kind="small">{mcp.error ?? 'The MCP server is not running.'}</Txt></View>}
    {mcp && snippet && <View style={{ gap: 10 }}>
      <Segments value={client} options={clients} onChange={setClient} />
      <Txt kind="small" muted>{snippet.where}</Txt>
      <Input value={snippet.text} readOnly multiline={client !== 'claude'} mono />
      <Button label="Copy" icon="Copy" small onPress={() => copy(snippet.text)} style={{ alignSelf: 'flex-start' }} />
      <Txt kind="small" muted>Server: {mcp.url}. {mcp.sharing ? 'Programs on this computer need no token.' : 'Only programs on this computer can reach it.'}</Txt>
    </View>}
    {mcp?.listening && <OtherComputers client={client} copy={copy} />}
    <View style={{ gap: 8 }}>
      <Txt kind="label" muted>Agents seen</Txt>
      {mcp && !mcp.clients.length && <Txt kind="small" muted>No agent has connected since Lienzo started. After adding it, start a new session of the agent.</Txt>}
      {[...recent, ...earlier].map(entry => <View key={entry.agentId} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: recent.includes(entry) ? u.c.statusSuccess : u.c.foregroundMuted }} />
        <Txt style={{ flexShrink: 1 }} numberOfLines={1}>{entry.name}{entry.version ? ` ${entry.version}` : ''}</Txt>
        <Txt kind="small" muted numberOfLines={1} style={{ flexShrink: 1 }}>{entry.from ? `from ${entry.from} · ` : ''}{recent.includes(entry) ? 'connected' : 'last seen'} {ago(entry.lastSeenAt, now)}{entry.toolCalls ? ` · ${entry.toolCalls} tool ${entry.toolCalls === 1 ? 'call' : 'calls'}` : ''}</Txt>
      </View>)}
      {receiver && <Txt kind="small" muted>{receiver} last worked on this Lienzo.</Txt>}
    </View>
    <View style={{ gap: 4, borderTopWidth: 1, borderColor: u.c.border, paddingTop: 14 }}>
      <Txt kind="bodyStrong">Talk to the agent in its own app</Txt>
      <Txt kind="small" muted>The canvas never messages the agent. Select something here and say “look at what I selected” in your conversation: the agent reads the selection with its tools. Agents seen are the ones that called in; Lienzo cannot tell whether they are working.</Txt>
    </View>
  </View>;
}

/** "Let agents on other computers connect": the switch, the token, the best address and the command with the token. */
function OtherComputers({ client, copy }: { client: Client; copy(text: string, what?: string): void }) {
  const u = useUI(), toast = useToast(), [remote, setRemote] = useState<RemoteStatus | null>(null), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false);
  useEffect(() => {
    let live = true;
    const load = (refresh: boolean) => call(remoteStatus, { refresh }).then(next => { if (live) setRemote(next); }).catch(() => {});
    void load(true); const timer = setInterval(() => { void load(false); }, 5000);
    return () => { live = false; clearInterval(timer); };
  }, []);
  const change = async (run: () => Promise<RemoteStatus>, done?: string) => {
    setBusy(true);
    try { setRemote(await run()); void refreshStatus(); if (done) toast.show(done, { variant: 'success' }); }
    catch { toast.error('Lienzo could not change sharing. Check the app log.'); }
    finally { setBusy(false); setConfirm(false); }
  };
  const on = !!remote?.enabled, best = remote?.addresses[0], token = remote?.token ?? null;
  const shown = best && token ? setup(client, best.url, maskToken(token)) : null, real = best && token ? setup(client, best.url, token) : null;
  const errors = (remote?.listeners ?? []).filter(entry => entry.error);
  const row = { flexDirection: 'row', alignItems: 'center', gap: 16 } as const;
  return <View nativeID="lienzo-remote" style={{ gap: 12, borderTopWidth: 1, borderColor: u.c.border, paddingTop: 14 }}>
    <View style={row}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt kind="bodyStrong">Let agents on other computers connect</Txt>
        <Txt kind="small" muted>Over Tailscale, with an access token. Agents on this computer keep working as they are.</Txt>
      </View>
      <Switch id="lienzo-remote-switch" label="Let agents on other computers connect" value={on} disabled={!remote || busy} onChange={next => { void change(() => call(remoteSet, { enabled: next }), next ? 'Sharing is on' : 'Sharing is off; other computers were disconnected'); }} />
    </View>
    {on && token && <>
      <View style={{ gap: 6 }}>
        <Txt kind="label" muted>Access token</Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Txt nativeID="lienzo-remote-token" selectable={false} style={[u.font('code'), { flexShrink: 1 }]}>{maskToken(token)}</Txt>
          <Button label="Copy" icon="Copy" small onPress={() => copy(token, 'Token copied')} />
          {confirm
            ? <><Button label="Regenerate" icon="RefreshCw" small variant="danger" disabled={busy} onPress={() => { void change(() => call(remoteRegenerate, {}), 'New token; agents with the old one were disconnected'); }} /><Button label="Cancel" small onPress={() => setConfirm(false)} /></>
            : <Button label="Regenerate…" icon="RefreshCw" small disabled={busy} onPress={() => setConfirm(true)} />}
        </View>
        {confirm && <Txt kind="small" style={{ color: u.c.statusDanger }}>Agents using the current token stop working until you give them the new one.</Txt>}
      </View>
      {best && shown && real ? <View style={{ gap: 8 }}>
        <Txt kind="label" muted>On the other computer</Txt>
        <Txt kind="small" muted>{shown.where}</Txt>
        <Input value={shown.text} readOnly multiline mono label={`Set-up for ${clients.find(entry => entry.value === client)?.label} on another computer`} />
        <Button label="Copy with token" icon="Copy" small onPress={() => copy(real.text)} style={{ alignSelf: 'flex-start' }} />
        <Txt kind="small" muted>Address: {best.url} ({addressKind[best.kind]}).{remote!.addresses.length > 1 ? ` Also: ${remote!.addresses.slice(1).map(entry => `${entry.url} (${addressKind[entry.kind]})`).join(', ')}.` : ''}</Txt>
        <Txt kind="small" muted>The other computer needs Tailscale signed in to the same tailnet. If it belongs to someone else's tailnet, share this computer with them in Tailscale (Machines → this computer → Share).</Txt>
      </View> : <View style={{ backgroundColor: u.wash('aviso'), borderRadius: 8, padding: 12, gap: 4 }}>
        <Txt kind="bodyStrong">No address for other computers yet</Txt>
        <Txt kind="small">{remote!.tailscale.found ? 'Tailscale is installed but this computer has no Tailscale address. Open Tailscale and sign in.' : 'Install Tailscale on this computer and the other one, and sign in to the same account.'} Lienzo starts listening as soon as the address appears. Or run “tailscale serve --bg {remote!.port}” here for an https address.</Txt>
      </View>}
      {errors.map(entry => <Txt key={entry.address} kind="small" style={{ color: u.c.statusWarning }}>{entry.error}</Txt>)}
      <View style={row}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Txt>Also allow my local network (Wi-Fi/LAN)</Txt>
          <Txt kind="small" muted>For computers on the same Wi-Fi without Tailscale.</Txt>
        </View>
        <Switch id="lienzo-remote-lan" label="Also allow my local network" value={remote!.lan} disabled={busy} onChange={next => { void change(() => call(remoteSet, { lan: next })); }} />
      </View>
      {remote!.lan && <View style={{ backgroundColor: u.wash('riesgo'), borderRadius: 8, padding: 12, gap: 4 }}>
        <Txt kind="bodyStrong">Anyone on this network can try to connect</Txt>
        <Txt kind="small">They still need the token, but traffic on the local network is not encrypted: someone on the same Wi-Fi could read it, token included. Use it only on a network you trust, and prefer Tailscale.</Txt>
      </View>}
    </>}
  </View>;
}
