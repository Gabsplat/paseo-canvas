// App updates in the desktop shell: the "Update ready · Restart" pill over the canvas and the Updates card in
// Settings → About (the host's AboutUpdates slot). The main process owns the state; this polls it.
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Pressable, View } from 'react-native';
import { Button, Txt, useUI } from '../../../../plugin/client/ui';
import { withAlpha } from '../../../../plugin/client/color';
import { islandStyle } from '../../../../plugin/client/whiteboard-visuals';
import { tokens } from '../../../../plugin/client/tokens';
import { checkForUpdates, restartToUpdate, updateSettings, updateStatus, type UpdateState } from '../shared/rpc';
import { updateWords } from '../shared/update-words';
import { call, Icon, useSettings, useToast } from './host';

type Status = { version: string; state: UpdateState };
let status: Status | null = null, timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const busy = (state?: UpdateState) => state?.kind === 'checking' || state?.kind === 'downloading';
function publish(next: Status | null) { status = next; listeners.forEach(listener => listener()); }
/** Every second while checking or downloading, every 20 s otherwise (a background download may finish). */
async function poll() {
  clearTimeout(timer);
  try { publish(await call(updateStatus, {})); } catch { /* keep the last known */ }
  if (listeners.size) timer = setTimeout(() => { void poll(); }, busy(status?.state) ? 1000 : 20_000);
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) void poll();
  return () => { listeners.delete(listener); if (!listeners.size) clearTimeout(timer); };
}
export function useUpdateStatus() { return useSyncExternalStore(subscribe, () => status); }

async function restart(toast: ReturnType<typeof useToast>) {
  try {
    const result = await call(restartToUpdate, {});
    publish(status ? { ...status, state: result.state } : status);
    if (!result.restarting) toast.error(result.state.kind === 'error' ? result.state.message : 'The update could not be installed.');
  } catch { toast.error('The update could not be installed.'); }
}

/** A small switch, as in the copilot popover. */
export function Switch({ value, onChange, disabled, label, id = 'lienzo-updates-auto' }: { value: boolean; onChange(next: boolean): void; disabled?: boolean; label: string; id?: string }) {
  const u = useUI();
  return <Pressable nativeID={id} accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value, disabled: !!disabled }} aria-checked={value} disabled={disabled} onPress={() => onChange(!value)}
    style={{ width: 36, height: 20, borderRadius: 10, padding: 2, justifyContent: 'center', backgroundColor: value ? u.c.accent : u.c.surface2, borderWidth: 1, borderColor: value ? u.c.accent : u.c.border, opacity: disabled ? .45 : 1 }}>
    <View style={{ width: 14, height: 14, borderRadius: 7, alignSelf: value ? 'flex-end' : 'flex-start', backgroundColor: value ? u.c.accentForeground : u.c.foregroundMuted }} />
  </Pressable>;
}

/** Settings → About: the state in words, "Check for updates" (or "Restart"), and the automatic-check switch. */
export function AboutUpdatesCard() {
  const u = useUI(), toast = useToast(), current = useUpdateStatus(), settings = useSettings(updateSettings), [now, setNow] = useState(Date.now());
  useEffect(() => { void poll(); const tick = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(tick); }, []);
  const state = current?.state, words = state ? updateWords(state, now) : null;
  const color = { muted: u.c.foregroundMuted, normal: u.c.accent, good: u.c.statusSuccess, warning: u.c.statusWarning, danger: u.c.statusDanger }[words?.tone ?? 'normal'];
  const unavailable = !state || state.kind === 'off' || state.kind === 'blocked';
  const auto = settings.status === 'ready' ? settings.values.autoCheck : true;
  const check = async () => {
    try { const result = await call(checkForUpdates, {}); publish(result); void poll(); }
    catch { toast.error('Could not check for updates.'); }
  };
  return <View nativeID="lienzo-settings-updates" style={{ gap: 10 }}>
    <View style={{ borderRadius: 12, borderWidth: 1, borderColor: u.c.border, backgroundColor: u.c.surface0, paddingHorizontal: 16 }}>
      <View style={{ flexDirection: 'row', gap: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: u.c.border, alignItems: 'center' }}>
        <Txt muted style={{ width: 120 }}>Updates</Txt>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }} accessibilityLiveRegion="polite">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {state && state.kind !== 'off' && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />}
            <Txt nativeID="lienzo-updates-state" style={{ color: words?.tone === 'danger' || words?.tone === 'warning' ? color : u.c.foreground }}>{words?.title ?? '…'}</Txt>
          </View>
          {state?.kind === 'downloading' && <View style={{ height: 3, borderRadius: 2, backgroundColor: u.c.surface2, overflow: 'hidden', marginVertical: 4, maxWidth: 260 }}><View style={{ height: 3, width: `${Math.max(2, Math.min(100, state.percent))}%`, backgroundColor: u.c.accent }} /></View>}
          {!!words?.detail && <Txt kind="small" muted>{words.detail}</Txt>}
        </View>
        {state?.kind === 'ready'
          ? <Button label="Restart" icon="RotateCw" variant="primary" onPress={() => { void restart(toast); }} />
          : <Button label="Check for updates" icon="RefreshCw" disabled={unavailable || busy(state)} onPress={() => { void check(); }} />}
      </View>
      <View style={{ flexDirection: 'row', gap: 16, paddingVertical: 12, alignItems: 'center' }}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Txt>Automatically check for updates</Txt>
          <Txt kind="small" muted>{settings.saveError ?? 'Soon after Lienzo opens and every 6 hours. Updates download in the background and install when you restart.'}</Txt>
        </View>
        <Switch label="Automatically check for updates" value={auto} disabled={settings.status !== 'ready' || settings.saving || state?.kind === 'off'}
          onChange={next => { if (settings.status === 'ready') void settings.save({ ...settings.values, autoCheck: next }, settings.revision); }} />
      </View>
    </View>
  </View>;
}

/** "Update ready · Restart": a quiet pill in the bottom-left corner once an update is downloaded (above the toolbar on compact). */
export function UpdatePill() {
  const u = useUI(), toast = useToast(), current = useUpdateStatus(), [hidden, setHidden] = useState<string | null>(null), [hover, setHover] = useState(false);
  const state = current?.state;
  if (state?.kind !== 'ready' || hidden === state.version) return null;
  const inset = u.compact ? tokens.island.insetCompact : tokens.island.inset;
  return <View pointerEvents="box-none" style={u.compact ? { position: 'absolute', bottom: inset + 64, left: 0, right: 0, alignItems: 'center' } : { position: 'absolute', left: inset, bottom: inset }}>
    <View nativeID="lienzo-update-pill" style={[islandStyle(u), { flexDirection: 'row', alignItems: 'center', height: 40, paddingLeft: 12, paddingRight: 4, gap: 6, borderRadius: 20 }]}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: u.c.accent }} />
      <Txt kind="small" style={{ fontWeight: '600' }}>Update ready</Txt>
      <Txt kind="small" muted>·</Txt>
      <Pressable accessibilityRole="button" accessibilityLabel={`Restart to update to version ${state.version}`} onPress={() => { void restart(toast); }} onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
        style={({ pressed }) => ({ height: 30, paddingHorizontal: 10, borderRadius: 15, justifyContent: 'center', backgroundColor: pressed ? withAlpha(u.c.accent, .2) : hover ? withAlpha(u.c.accent, .12) : 'transparent' })}>
        <Txt kind="small" style={{ color: u.c.accent, fontWeight: '600' }}>Restart</Txt>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Later" onPress={() => setHidden(state.version)}
        style={({ pressed, ...rest }) => ({ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? withAlpha(u.c.foreground, .1) : (rest as { hovered?: boolean }).hovered ? withAlpha(u.c.foreground, .06) : 'transparent' })}>
        <Icon name="X" size={14} color={u.c.foregroundMuted} />
      </Pressable>
    </View>
  </View>;
}
