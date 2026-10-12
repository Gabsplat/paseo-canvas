import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Modal, Txt, useUI } from './ui';
import { tokens } from './tokens';
import { captureKeys } from './web';
import { eventCombo, SHORTCUT_GROUPS, type ResolvedShortcut } from './shortcuts';
import { KeyChips } from './CommandPalette';

/**
 * Every shortcut, ours and extensions', by group. A row can be reassigned by pressing the new keys; an override
 * shows Reset. A shortcut whose keys another one took is listed as unassigned and says by whom.
 */
export function ShortcutList({ list, chips, onAssign, onReset, editable = true }: { list: readonly ResolvedShortcut[]; chips(combo: string): string[]; onAssign(id: string, combo: string): void; onReset(id: string): void; editable?: boolean }) {
  const u = useUI(), [recording, setRecording] = useState<string | null>(null);
  useEffect(() => {
    if (!recording) return;
    return captureKeys(e => { if (e.key === 'Escape') { setRecording(null); return true; } const combo = eventCombo(e); if (!combo) return false; onAssign(recording, combo); setRecording(null); return true; });
  }, [recording]);
  const label = (id: string) => list.find(s => s.id === id)?.label ?? id;
  return <View nativeID="lienzo-shortcuts" style={{ gap: 16 }}>
    {SHORTCUT_GROUPS.map(group => { const rows = list.filter(s => s.group === group); if (!rows.length) return null;
      return <View key={group} style={{ gap: 2 }}>
        <Txt kind="label" muted style={{ paddingVertical: 4 }}>{group}</Txt>
        {rows.map(s => <View key={s.id} nativeID={`lienzo-shortcut-${s.id}`} style={{ minHeight: tokens.face.sheet.row, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderColor: u.c.border, paddingVertical: 4 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt numberOfLines={1}>{s.label}{s.later ? <Txt kind="small" muted>  · coming with Hojas</Txt> : null}</Txt>
            {s.id === 'hoja.previous' && <Txt kind="small" muted numberOfLines={2}>A Hoja is a chapter the agent adds while explaining (Spanish for sheet).</Txt>}
            {s.unassigned && <Txt kind="small" muted numberOfLines={1}>{s.conflictWith ? `Unassigned · its keys belong to ${label(s.conflictWith)}` : 'Unassigned'}</Txt>}
          </View>
          {recording === s.id ? <Txt kind="small" style={{ color: u.c.accent, fontWeight: '600' }}>Press the new keys… Esc cancels</Txt> : s.assigned.length ? <View style={{ flexDirection: 'row', gap: 6 }}>{s.assigned.slice(0, 2).map(combo => <KeyChips key={combo} parts={chips(combo)} />)}</View> : <Txt kind="small" muted>—</Txt>}
          {editable && !s.fixed && <>
            {recording !== s.id && <Button label="Change" small variant="ghost" onPress={() => setRecording(s.id)} />}
            {s.overridden && recording !== s.id && <Button label="Reset" small variant="ghost" onPress={() => onReset(s.id)} />}
          </>}
        </View>)}
      </View>; })}
  </View>;
}
/** The `?` sheet. It is also where shortcuts are reassigned; Settings → Shortcuts shows the same list. */
export function ShortcutSheet({ open, onClose, title = 'Keyboard shortcuts', intro, ...list }: React.ComponentProps<typeof ShortcutList> & { open: boolean; onClose(): void; title?: string; intro?: string }) {
  return <Modal title={title} open={open} onOpenChange={value => { if (!value) onClose(); }}><Modal.Content>
    <View style={{ gap: 12, minWidth: 0 }}>
      <Txt kind="small" muted>{intro ?? 'Press Change and then the new keys. Your choices are saved for this Paseo host; Reset brings back the default.'}</Txt>
      <ShortcutList {...list} />
    </View>
  </Modal.Content></Modal>;
}
