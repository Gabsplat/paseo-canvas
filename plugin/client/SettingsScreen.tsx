/**
 * Settings (docs/redesign-2026-10.md, "Settings"): two columns, only sections that really exist. Shortcuts record new
 * keys in place, the toolbar's pinned tools reorder, Extensions is the Extensions screen embedded, About says where the
 * data lives. Copilot appears in Paseo, Agents in the desktop app.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, View } from 'react-native';
import { AgentSettings, Icon, capabilities, copyText, openExternalUrl, useToast } from './host';
import type { CanvasController } from './useCanvas';
import { withAlpha } from './color';
import { NATIVE, reducedMotion } from './motion';
import { Button, IconButton, Txt, useUI } from './ui';
import { captureKeys } from './web';
import { Card, ScreenBody, ScreenHeader, SearchField, SectionLabel, Stagger, type RailItem } from './Screen';
import { eventCombo, SHORTCUT_GROUPS, type ResolvedShortcut, type ShortcutDef } from './shortcuts';
import { moveItem, recordShortcut, resetShortcut } from './screens';
import { ExtensionsContent } from './ExtensionsScreen';
import { tokens } from './tokens';

export type SettingsSection = 'shortcuts' | 'toolbar' | 'copilot' | 'agents' | 'extensions' | 'about';
export const settingsRail = (): RailItem[] => [
  { id: 'shortcuts', label: 'Shortcuts', icon: 'Keyboard' },
  { id: 'toolbar', label: 'Toolbar', icon: 'PanelBottom' },
  ...(capabilities.runsAgents ? [{ id: 'copilot', label: 'Copilot', icon: 'Sparkles' }] : [{ id: 'agents', label: 'Agents', icon: 'Plug' }]),
  { id: 'extensions', label: 'Extensions', icon: 'Puzzle' },
  { id: 'about', label: 'About', icon: 'Info' },
];
const DOCS = 'https://github.com/Gabsplat/paseo-canvas/blob/master/docs/';
const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** A key chip that records new keys in place: it pulses "Press keys…" until a combination arrives; Escape cancels. */
function KeyChip({ parts, recording, onPress, label }: { parts: string[] | null; recording: boolean; onPress(): void; label: string }) {
  const u = useUI(), pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!recording || reducedMotion.current) { pulse.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([Animated.timing(pulse, { toValue: .45, duration: 520, useNativeDriver: NATIVE }), Animated.timing(pulse, { toValue: 1, duration: 520, useNativeDriver: NATIVE })])); loop.start(); return () => loop.stop();
  }, [recording]);
  return <Pressable accessibilityRole="button" accessibilityLabel={recording ? `Recording keys for ${label}. Press keys, or Escape to cancel` : `Change keys for ${label}`} onPress={onPress}
    style={({ pressed, ...state }) => ({ minHeight: 26, minWidth: 34, paddingHorizontal: recording ? 10 : 4, borderRadius: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, borderWidth: 1,
      borderColor: recording ? u.c.accent : (state as { hovered?: boolean }).hovered ? withAlpha(u.c.foreground, .3) : 'transparent', backgroundColor: recording ? withAlpha(u.c.accent, .12) : pressed ? withAlpha(u.c.foreground, .08) : 'transparent' })}>
    {recording ? <Animated.View style={{ opacity: pulse }}><Txt kind="small" style={{ color: u.c.accent, fontWeight: '600' }}>Press keys…</Txt></Animated.View>
      : parts ? parts.map((p, i) => <View key={i} style={{ minWidth: 22, height: tokens.face.sheet.keyChip, paddingHorizontal: 6, borderRadius: 5, borderWidth: 1, borderBottomWidth: 2, borderColor: u.c.border, backgroundColor: u.c.surface1, alignItems: 'center', justifyContent: 'center' }}><Txt kind="keys" muted>{p}</Txt></View>)
      : <Txt kind="small" muted>Add keys</Txt>}
  </Pressable>;
}

function ShortcutRow({ s, chips, recording, onRecord, onReset, ownerLabel, width }: { s: ResolvedShortcut; chips(combo: string): string[]; recording: boolean; onRecord(): void; onReset(): void; ownerLabel?: string; width: number | `${number}%` }) {
  const u = useUI();
  return <View nativeID={`lienzo-shortcut-${s.id}`} style={{ width, minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 8, backgroundColor: recording ? withAlpha(u.c.accent, .06) : 'transparent' }}>
    <View style={{ flex: 1, minWidth: 0 }}>
      <Txt numberOfLines={1}>{s.label}</Txt>
      {s.unassigned && !recording && !s.fixed && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, height: 18, borderRadius: 9, backgroundColor: u.wash('aviso') }}><Icon name="TriangleAlert" size={10} color={u.c.statusWarning} /><Txt kind="label" style={{ color: u.c.statusWarning, fontWeight: '600' }} numberOfLines={1}>{ownerLabel ? `Keys taken by ${ownerLabel}` : 'No keys'}</Txt></View>
      </View>}
    </View>
    {s.fixed ? <View style={{ flexDirection: 'row', gap: 3 }}>{(s.assigned[0] ? chips(s.assigned[0]) : []).map((p, i) => <View key={i} style={{ minWidth: 22, height: tokens.face.sheet.keyChip, paddingHorizontal: 6, borderRadius: 5, borderWidth: 1, borderColor: u.c.border, alignItems: 'center', justifyContent: 'center' }}><Txt kind="keys" muted>{p}</Txt></View>)}</View>
      : <KeyChip label={s.label} parts={s.assigned[0] ? chips(s.assigned[0]) : null} recording={recording} onPress={onRecord} />}
    <View style={{ width: 28, alignItems: 'center' }}>{s.overridden && !recording && <IconButton icon="RotateCcw" label={`Reset ${s.label}`} detail="Back to the default keys" onPress={onReset} />}</View>
  </View>;
}

function ShortcutsSection({ list, defs, overrides, chips, save, width }: { list: readonly ResolvedShortcut[]; defs: readonly ShortcutDef[]; overrides: Record<string, string>; chips(combo: string): string[]; save(next: Record<string, string>): void; width: number }) {
  const u = useUI(), [query, setQuery] = useState(''), [recording, setRecording] = useState<string | null>(null), latest = useRef({ overrides, save, defs }); latest.current = { overrides, save, defs };
  useEffect(() => {
    if (!recording) return;
    return captureKeys(e => {
      if (e.key === 'Escape') { setRecording(null); return true; }
      const combo = eventCombo(e); if (!combo) return false;
      const result = recordShortcut(latest.current.defs, latest.current.overrides, recording, combo);
      if (result) latest.current.save(result.overrides);
      setRecording(null); return true;
    });
  }, [recording]);
  const q = fold(query.trim()), label = (id?: string) => id ? list.find(s => s.id === id)?.label : undefined;
  const two = width >= 600, rowWidth = two ? '50%' : '100%';
  const visible = list.filter(s => !q || fold(`${s.label} ${s.group} ${s.assigned.join(' ')}`).includes(q));
  return <View nativeID="lienzo-settings-shortcuts" style={{ gap: 22 }}>
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
      <SearchField nativeID="lienzo-shortcut-search" value={query} onChange={setQuery} placeholder="Search shortcuts" />
      <Button label="Reset all" icon="RotateCcw" variant="ghost" disabled={!Object.keys(overrides).length} onPress={() => save({})} />
    </View>
    <Txt kind="small" muted>Press a key chip, then the new keys. Escape cancels. Keys another shortcut had move here, and that one shows a warning. Saved {capabilities.keptFor}.</Txt>
    {!visible.length && <Txt muted>No shortcut matches “{query.trim()}”.</Txt>}
    {SHORTCUT_GROUPS.map(group => { const rows = visible.filter(s => s.group === group); if (!rows.length) return null;
      return <View key={group} style={{ gap: 6 }}>
        <SectionLabel style={{ paddingHorizontal: 10 }}>{group}</SectionLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -2 }}>
          {rows.map(s => <ShortcutRow key={s.id} s={s} chips={chips} width={rowWidth} recording={recording === s.id} ownerLabel={label(s.conflictWith)} onRecord={() => setRecording(r => r === s.id ? null : s.id)} onReset={() => save(resetShortcut(overrides, s.id))} />)}
        </View>
      </View>; })}
  </View>;
}

export type PinnedRow = { id: string; name: string; icon: string; description?: string };
function ToolbarSection({ pinned, save }: { pinned: readonly PinnedRow[]; save(ids: string[]): void }) {
  const u = useUI(), ids = pinned.map(p => p.id);
  return <View nativeID="lienzo-settings-toolbar" style={{ gap: 16 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Txt muted style={{ flex: 1 }}>Tools you pin from the + catalog sit at the end of the toolbar, in this order, with keys 1–9.</Txt>
      <Button label="Reset toolbar" icon="RotateCcw" variant="ghost" disabled={!pinned.length} onPress={() => save([])} />
    </View>
    {!pinned.length && <Card style={{ alignItems: 'center', paddingVertical: 28, gap: 8 }}><Icon name="Pin" size={20} color={u.c.foregroundMuted} /><Txt kind="title">Nothing pinned</Txt><Txt muted style={{ textAlign: 'center' }}>In the + catalog, point at a tool and press its pin.</Txt></Card>}
    {!!pinned.length && <Card padding={6} style={{ gap: 2 }}>{pinned.map((p, i) => <Stagger key={p.id} index={i}><View nativeID={`lienzo-pinned-${p.id}`} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 10, borderRadius: 8, borderBottomWidth: i === pinned.length - 1 ? 0 : 1, borderColor: u.c.border }}>
      <View style={{ width: 22, height: 22, borderRadius: 5, borderWidth: 1, borderBottomWidth: 2, borderColor: u.c.border, alignItems: 'center', justifyContent: 'center' }}><Txt kind="keys" muted>{i + 1}</Txt></View>
      <View style={{ width: 30, height: 30, borderRadius: 7, backgroundColor: u.c.surface2, alignItems: 'center', justifyContent: 'center' }}><Icon name={p.icon} size={16} color={u.c.foreground} /></View>
      <View style={{ flex: 1, minWidth: 0 }}><Txt kind="bodyStrong" numberOfLines={1}>{p.name}</Txt>{!!p.description && <Txt kind="small" muted numberOfLines={1}>{p.description}</Txt>}</View>
      <IconButton icon="ArrowUp" label={`Move ${p.name} earlier`} disabled={i === 0} onPress={() => save(moveItem(ids, i, -1))} />
      <IconButton icon="ArrowDown" label={`Move ${p.name} later`} disabled={i === pinned.length - 1} onPress={() => save(moveItem(ids, i, 1))} />
      <IconButton icon="PinOff" label={`Unpin ${p.name}`} onPress={() => save(ids.filter(id => id !== p.id))} />
    </View></Stagger>)}</Card>}
  </View>;
}

function CopilotSection({ onGuide }: { onGuide(): void }) {
  const u = useUI();
  return <View nativeID="lienzo-settings-copilot" style={{ gap: 16 }}>
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 28, borderRadius: 14, borderWidth: 1, borderColor: u.c.border, backgroundColor: u.c.surface1 }}><View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: u.c.accent }} /><Txt kind="small" style={{ fontWeight: '600' }}>Lienzo</Txt></View>
        <Txt kind="bodyStrong">The chip in each conversation’s composer</Txt>
      </View>
      <Txt muted>The copilot is set per conversation, not here. Press the Lienzo chip under the message box to turn it on, choose when the agent draws (as it thinks, after each step, once per task, or your own rule) and whether Lienzo reminds it. Every new conversation starts with it off.</Txt>
      <Txt muted>The dot says what it is doing: off, on, or drawing right now.</Txt>
      <View style={{ gap: 2, marginTop: 4 }}>{([['As it thinks', 'After reasoning or each tool it uses'], ['After each step', 'The default: whenever a step is worth showing'], ['Once per task', 'One drawing at the end'], ['Your rule', 'In your words, for example “only for architecture”']] as const).map(([name, detail]) =>
        <View key={name} style={{ flexDirection: 'row', gap: 12, paddingVertical: 8, borderTopWidth: 1, borderColor: u.c.border }}><Txt kind="bodyStrong" style={{ width: 140 }}>{name}</Txt><Txt muted style={{ flex: 1 }}>{detail}</Txt></View>)}</View>
      <Button label="See it in the guide" icon="BookOpen" style={{ alignSelf: 'flex-start' }} onPress={onGuide} />
    </Card>
  </View>;
}

function AboutSection({ c }: { c: CanvasController }) {
  const u = useUI(), toast = useToast(), [about, setAbout] = useState<{ version: string; dataFile: string; host: string } | null>(null), [failed, setFailed] = useState(false);
  useEffect(() => { let live = true; void c.api.about({}).then(a => { if (live) setAbout(a); }).catch(() => { if (live) setFailed(true); }); return () => { live = false; }; }, []);
  const row = (label: string, value: React.ReactNode) => <View style={{ flexDirection: 'row', gap: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: u.c.border, alignItems: 'center' }}><Txt muted style={{ width: 120 }}>{label}</Txt><View style={{ flex: 1, minWidth: 0 }}>{value}</View></View>;
  return <View nativeID="lienzo-settings-about" style={{ gap: 20 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
      <View style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: u.wash('acento'), alignItems: 'center', justifyContent: 'center' }}><Icon name="Frame" size={26} color={u.c.accent} /></View>
      <View style={{ gap: 2 }}><Txt kind="display">Lienzo</Txt><Txt muted>A canvas your agent draws on while it explains. Lienzo is Spanish for canvas.</Txt></View>
    </View>
    <Card padding={0} style={{ paddingHorizontal: 16 }}>
      {row('Version', <Txt>{about ? about.version : failed ? 'Unknown' : '…'}</Txt>)}
      {row('Running in', <Txt>{capabilities.kind === 'paseo' ? 'Paseo, as a plugin' : 'The desktop app'}</Txt>)}
      <View style={{ flexDirection: 'row', gap: 16, paddingVertical: 12, alignItems: 'center' }}><Txt muted style={{ width: 120 }}>Your Lienzos</Txt>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}><Txt kind="code" selectable numberOfLines={2}>{about?.dataFile ?? (failed ? 'Not available' : '…')}</Txt><Txt kind="small" muted>Every Lienzo, its history and your extensions live in this one file.</Txt></View>
        {!!about && <IconButton icon="Copy" label="Copy the path" onPress={() => { void copyText(about.dataFile).then(() => toast.show('Copied', { variant: 'success' })).catch(() => toast.error('Could not copy.')); }} />}
      </View>
    </Card>
    <SectionLabel>Read more</SectionLabel>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {([['Writing extensions', 'extensions.md', 'Puzzle'], ['Tools for agents (MCP)', 'mcp.md', 'Plug'], ['The desktop app', 'desktop.md', 'Monitor'], ['Design', 'design.md', 'Palette']] as const).map(([label, file, icon]) =>
        <Button key={file} label={label} icon={icon} onPress={() => { void openExternalUrl(DOCS + file); }} />)}
    </View>
  </View>;
}

export function SettingsContent({ section, c, width, list, defs, overrides, chips, saveShortcuts, pinned, savePinned, onGuide }: {
  section: SettingsSection; c: CanvasController; width: number; list: readonly ResolvedShortcut[]; defs: readonly ShortcutDef[]; overrides: Record<string, string>; chips(combo: string): string[];
  saveShortcuts(next: Record<string, string>): void; pinned: readonly PinnedRow[]; savePinned(ids: string[]): void; onGuide(): void;
}) {
  const u = useUI(), inner = width - (u.compact ? 32 : 64);
  const head = { shortcuts: ['Shortcuts', 'Every key Lienzo answers to, yours and your extensions’.'], toolbar: ['Toolbar', 'What sits at the end of the bottom toolbar.'], copilot: ['Copilot', 'How your agent draws while it works.'],
    agents: ['Agents', 'Connect the agents you work with over MCP.'], extensions: ['Extensions', 'Small tools for the + catalog and the Properties panel.'], about: ['About', 'Version, and where your Lienzos are kept.'] }[section];
  return <View nativeID={`lienzo-settings-${section}-screen`} style={{ flex: 1, minHeight: 0 }}>
    <ScreenHeader title={head[0]} subtitle={head[1]} />
    <ScreenBody>
      {section === 'shortcuts' && <ShortcutsSection list={list} defs={defs} overrides={overrides} chips={chips} save={saveShortcuts} width={inner} />}
      {section === 'toolbar' && <ToolbarSection pinned={pinned} save={savePinned} />}
      {section === 'copilot' && <CopilotSection onGuide={onGuide} />}
      {section === 'agents' && (AgentSettings ? <AgentSettings connectedAgentId={c.view?.connection?.agentId ?? null} /> : <Txt muted>This app connects agents through Paseo.</Txt>)}
      {section === 'extensions' && <ExtensionsContent c={c} width={width} embedded />}
      {section === 'about' && <AboutSection c={c} />}
    </ScreenBody>
  </View>;
}
