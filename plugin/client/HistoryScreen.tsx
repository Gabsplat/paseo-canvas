/**
 * History (docs/redesign-2026-10.md, "History (Activity)"): the stored transactions of the open Lienzo as a timeline
 * grouped by day. Each entry says who did what and when; its chips fly the camera to what changed.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon, useAgent } from './host';
import type { CanvasController } from './useCanvas';
import { withAlpha, type Tone } from './color';
import { Button, Txt, useUI } from './ui';
import { ScreenBody, ScreenEmpty, ScreenHeader, SectionLabel, Stagger } from './Screen';
import { entryTargets, historyByDay, timeOf, type HistoryEntry } from './screens';

const AGENT_TONES: readonly Tone[] = ['violeta', 'turquesa', 'exito', 'aviso', 'acento'];
export const agentTone = (id: string): Tone => AGENT_TONES[[...id].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) >>> 0, 7) % AGENT_TONES.length];

function Actor({ entry }: { entry: HistoryEntry }) {
  const u = useUI(), agent = useAgent(entry.agentId ?? '', a => ({ title: a.title }));
  if (entry.actor === 'user') return <Txt kind="bodyStrong">You</Txt>;
  if (entry.actor === 'system') return <Txt kind="bodyStrong">Lienzo</Txt>;
  const name = agent?.title || (entry.agentId?.startsWith('mcp:') ? entry.agentId.slice(4) : 'The agent');
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}><View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: u.tone(agentTone(entry.agentId ?? 'agent')) }} /><Txt kind="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>{name}</Txt></View>;
}

export function HistoryScreen({ c, open, onFly, onUndo, onRedo }: { c: CanvasController; open: boolean; onFly(ids: string[]): void; onUndo(): void; onRedo(): void }) {
  const u = useUI(), doc = c.view?.document, [entries, setEntries] = useState<HistoryEntry[] | null>(null), [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open || !doc) return; let live = true; setFailed(false);
    void c.api.history({ workspaceId: c.workspaceId, documentId: doc.id }).then(result => { if (live) setEntries(result.transactions as HistoryEntry[]); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [open, doc?.id, doc?.revision, attempt]);
  const days = entries ? historyByDay(entries) : [], disabled = c.busy || c.offline;
  let index = 0;
  return <View nativeID="lienzo-history" style={{ flex: 1, minHeight: 0 }}>
    <ScreenHeader title="History" subtitle={doc ? `Every change to “${doc.title}”, yours and your agents’. Press a chip to go there.` : 'Open a Lienzo to see its changes.'}
      actions={doc ? <>
        <Button label="Undo" icon="Undo2" disabled={disabled || !c.view?.canUndo} onPress={onUndo} />
        <Button label="Redo" icon="Redo2" disabled={disabled || !c.view?.canRedo} onPress={onRedo} />
      </> : undefined} />
    <ScreenBody gap={24}>
      {failed && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Txt muted style={{ flex: 1 }}>The history could not be loaded.</Txt><Button label="Retry" small onPress={() => setAttempt(n => n + 1)} /></View>}
      {!entries && !failed && <Txt muted>Loading the history…</Txt>}
      {entries && !entries.length && <ScreenEmpty title="Nothing yet." detail="Changes appear here as you and your agent draw." />}
      {days.map(day => <View key={day.key} style={{ gap: 4 }}>
        <SectionLabel style={{ paddingBottom: 6 }}>{day.label}</SectionLabel>
        {day.entries.map((entry, i) => { const targets = doc ? entryTargets(entry, doc) : [], last = i === day.entries.length - 1;
          return <Stagger key={entry.id} index={index++}><View nativeID={`lienzo-history-${entry.id}`} style={{ flexDirection: 'row', gap: 14 }}>
            <View style={{ width: 28, alignItems: 'center' }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: entry.actor === 'agent' ? withAlpha(u.tone(agentTone(entry.agentId ?? 'agent')), .16) : u.c.surface2 }}>
                <Icon name={entry.kind === 'undo' ? 'Undo2' : entry.kind === 'redo' ? 'Redo2' : entry.actor === 'agent' ? 'Sparkles' : entry.actor === 'system' ? 'Cog' : 'User'} size={14} color={entry.actor === 'agent' ? u.tone(agentTone(entry.agentId ?? 'agent')) : u.c.foregroundMuted} />
              </View>
              {!last && <View style={{ flex: 1, width: 1, minHeight: 12, backgroundColor: u.c.border, marginVertical: 2 }} />}
            </View>
            <View style={{ flex: 1, minWidth: 0, paddingBottom: last ? 0 : 16, gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                <View style={{ flexShrink: 1, minWidth: 0 }}><Actor entry={entry} /></View>
                <Txt muted numberOfLines={2} style={{ flex: 1 }}>{entry.label}</Txt>
                <Txt kind="small" muted style={{ fontVariant: ['tabular-nums'] }}>{timeOf(entry.at)}</Txt>
              </View>
              {!!targets.length && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {targets.slice(0, 6).map(t => <Pressable key={t.id} accessibilityRole="button" accessibilityLabel={`Go to ${t.title}`} onPress={() => onFly([t.id])}
                  style={({ pressed, ...state }) => ({ minHeight: 24, paddingHorizontal: 8, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 220, borderWidth: 1, borderColor: (state as { hovered?: boolean }).hovered ? withAlpha(u.c.foreground, .3) : u.c.border, backgroundColor: pressed ? withAlpha(u.c.foreground, .08) : u.c.surface0 })}>
                  <Icon name="Crosshair" size={11} color={u.c.foregroundMuted} /><Txt kind="small" numberOfLines={1} style={{ flexShrink: 1 }}>{t.title}</Txt></Pressable>)}
                {targets.length > 6 && <Txt kind="small" muted style={{ alignSelf: 'center' }}>+{targets.length - 6} more</Txt>}
              </View>}
            </View>
          </View></Stagger>; })}
      </View>)}
    </ScreenBody>
  </View>;
}
