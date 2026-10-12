import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon, ScrollView } from '@getpaseo/plugin/client/react-native';
import type { PluginButtonContentProps, PluginHostProps } from '@getpaseo/plugin/client';
import type { z } from 'zod';
import type { CopilotCadence } from '../../shared/model';
import type { copilotViewSchema } from '../../shared/rpc';
import { Button, Input, MenuRow, Segments, Txt, UIProvider, friendlyError, CheckRow } from '../ui';
import { CADENCE_OPTIONS, POPOVER_SIZE, cadenceHint, latestPreview, pillStatus, recentLienzos, remindApplies, statusText, type DocumentSummary } from './model';

export type CopilotView = z.output<typeof copilotViewSchema>;
export type CopilotPatch = Partial<Pick<CopilotView['copilot'], 'enabled' | 'cadence' | 'rule' | 'remind' | 'documentId'>>;
/** Everything the popover does, bound to one agent by the pill registry. */
export type CopilotApi = {
  read(): Promise<CopilotView>;
  set(patch: CopilotPatch): Promise<CopilotView>;
  documents(): Promise<DocumentSummary[]>;
  goToLatest(view: CopilotView): void;
  open(view: CopilotView): void;
  newAgent(): Promise<{ title: string }>;
  changed(view: CopilotView): void;
};

type Colors = PluginHostProps['theme']['colors'];
export type CopilotPanelProps = {
  colors: Colors; view: CopilotView | null; documents: DocumentSummary[]; now: number;
  loading: boolean; busy: boolean; error: string; created: string;
  onToggle(enabled: boolean): void; onCadence(cadence: CopilotCadence): void; onRule(rule: string): void; onRemind(remind: boolean): void;
  onLatest(): void; onOpen(): void; onAttach(documentId: string): void; onNewAgent(): void;
};

function Toggle({ value, onChange, disabled, colors, label }: { value: boolean; onChange(next: boolean): void; disabled?: boolean; colors: Colors; label: string }) {
  return <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value, disabled: !!disabled }} disabled={disabled} onPress={() => onChange(!value)}
    style={{ width: 36, height: 20, borderRadius: 10, padding: 2, justifyContent: 'center', backgroundColor: value ? colors.accent : colors.surface2, borderWidth: 1, borderColor: value ? colors.accent : colors.border, opacity: disabled ? .45 : 1 }}>
    <View style={{ width: 14, height: 14, borderRadius: 7, alignSelf: value ? 'flex-end' : 'flex-start', backgroundColor: value ? colors.accentForeground : colors.foregroundMuted }} />
  </Pressable>;
}
export function StatusDot({ status, colors, size = 8 }: { status: ReturnType<typeof pillStatus>; colors: Colors; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: status === 'drawing' ? colors.statusSuccess : status === 'on' ? colors.accent : 'transparent', borderWidth: status === 'off' ? 1.5 : 0, borderColor: colors.foregroundMuted }} />;
}

/** The compact popover body (at most 320 × 360). Presentational: state and calls come from CopilotPopover. */
export function CopilotPanel(p: CopilotPanelProps) {
  const { colors: c, view } = p;
  const status = pillStatus(view ? { enabled: view.copilot.enabled, drawing: view.drawing, hasTools: view.hasTools } : undefined);
  const header = <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
    <Icon name="Frame" size={16} color={c.foreground} />
    <View style={{ flex: 1 }}>
      <Txt kind="bodyStrong">Lienzo copilot</Txt>
      <Txt kind="small" muted numberOfLines={1}>{view?.copilot.enabled ? statusText[status] : 'Lienzo (Spanish for canvas): the agent draws as it explains'}</Txt>
    </View>
    {view?.hasTools && <Toggle label="Copilot on" value={!!view.copilot.enabled} disabled={p.busy} colors={c} onChange={p.onToggle} />}
  </View>;
  let body: React.ReactNode;
  if (p.loading && !view) body = <Txt kind="small" muted>Loading…</Txt>;
  else if (!view) body = <Txt kind="small" muted>The copilot is unavailable right now.</Txt>;
  else if (!view.hasTools) body = <View style={{ gap: 8 }}>
    <Txt kind="small">This agent was created before it had Lienzo tools, so it cannot draw. A new agent gets them, with the copilot on.</Txt>
    <Button label={p.busy ? 'Creating…' : 'New agent with Lienzo'} icon="Plus" variant="primary" disabled={p.busy} onPress={p.onNewAgent} />
    {!!p.created && <Txt kind="small" muted>Listo. “{p.created}” is in the sidebar.</Txt>}
  </View>;
  else {
    const preview = latestPreview(view.latest, p.now), recent = recentLienzos(p.documents, view.copilot.documentId);
    body = <View style={{ gap: 10 }}>
      {view.copilot.enabled ? <>
        <View style={{ gap: 6 }}>
          <Segments value={view.copilot.cadence} disabled={p.busy} options={CADENCE_OPTIONS} onChange={p.onCadence} />
          {view.copilot.cadence === 'custom'
            ? <RuleField rule={view.copilot.rule} onSave={p.onRule} />
            : <Txt kind="small" muted>{cadenceHint(view.copilot.cadence)}</Txt>}
          {remindApplies(view.copilot.cadence) && <CheckRow label="Remind the agent when it forgets" checked={view.copilot.remind} disabled={p.busy} onPress={() => p.onRemind(!view.copilot.remind)} />}
        </View>
      </> : <Txt kind="small" muted>Off. Turn it on and the agent draws what it explains in this conversation's Lienzo, one Hoja (a chapter of the canvas) per explanation.</Txt>}
      {preview && <View style={{ gap: 4, padding: 8, borderRadius: 6, backgroundColor: c.surface2 }}>
        <Txt kind="small" muted numberOfLines={1}>Latest from the agent · {preview.title}</Txt>
        <Txt kind="small" numberOfLines={2}>{preview.detail}</Txt>
        <Button label="Go to latest" icon="LocateFixed" small onPress={p.onLatest} />
      </View>}
      {recent.length > 0 && <View>
        <Txt kind="label" muted>Attach a recent Lienzo</Txt>
        {recent.map(document => <MenuRow key={document.id} icon="Frame" label={document.title} hint={document.example ? 'Example' : undefined} disabled={p.busy} onPress={() => p.onAttach(document.id)} />)}
      </View>}
      <Button label={view.document ? `Open ${view.document.title}` : 'Open Lienzo'} icon="PanelRight" onPress={p.onOpen} />
    </View>;
  }
  return <View style={{ width: POPOVER_SIZE.width, maxWidth: '100%', maxHeight: POPOVER_SIZE.maxHeight, padding: 12, gap: 10 }}>
    {header}
    <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 10 }}>{body}</ScrollView>
    {!!p.error && <Txt kind="small" style={{ color: c.statusDanger }}>{p.error}</Txt>}
  </View>;
}

function RuleField({ rule, onSave }: { rule: string; onSave(rule: string): void }) {
  const [draft, setDraft] = useState(rule);
  useEffect(() => { setDraft(rule); }, [rule]);
  return <Input label="When should the agent draw?" placeholder="e.g. whenever an architecture decision changes" value={draft} onChange={value => setDraft(value.slice(0, 500))} onBlur={() => { if (draft.trim() && draft !== rule) onSave(draft.trim()); }} />;
}

/** Popover content for one agent's pill: loads the copilot, applies changes, reports them to the pill. */
export function CopilotPopover({ api, ...props }: PluginButtonContentProps & { api: CopilotApi }) {
  const [view, setView] = useState<CopilotView | null>(null), [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [created, setCreated] = useState('');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let live = true;
    void Promise.all([api.read(), api.documents().catch(() => [])]).then(([next, docs]) => { if (!live) return; setView(next); setDocuments(docs); setNow(Date.now()); })
      .catch(e => { if (live) setError(friendlyError(e)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [api]);
  const run = useCallback(async (work: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await work(); } catch (e) { setError(e instanceof Error && /custom cadence needs a rule/.test(e.message) ? 'Write a rule first: when should the agent draw?' : friendlyError(e)); } finally { setBusy(false); }
  }, []);
  const apply = (patch: CopilotPatch) => run(async () => { const next = await api.set(patch); setView(next); api.changed(next); });
  return <UIProvider theme={props.theme} layout={props.layout} host={props.host}>
    <CopilotPanel colors={props.theme.colors} view={view} documents={documents} now={now} loading={loading} busy={busy} error={error} created={created}
      onToggle={enabled => { void apply(view?.copilot.cadence === 'custom' && !view.copilot.rule.trim() && enabled ? { enabled, cadence: 'step' } : { enabled }); }}
      onCadence={cadence => { void (cadence === 'custom' && !view?.copilot.rule.trim() ? (setView(current => current && { ...current, copilot: { ...current.copilot, cadence } }), Promise.resolve()) : apply({ cadence })); }}
      onRule={rule => { void apply({ cadence: 'custom', rule }); }}
      onRemind={remind => { void apply({ remind }); }}
      onLatest={() => { if (view) { api.goToLatest(view); props.close(); } }}
      onOpen={() => { if (view) api.open(view); props.close(); }}
      onAttach={documentId => { void apply({ documentId }); }}
      onNewAgent={() => { void run(async () => { const agent = await api.newAgent(); setCreated(agent.title); }); }}
    />
  </UIProvider>;
}
