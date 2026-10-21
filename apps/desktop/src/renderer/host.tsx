// The desktop implementation of the panel's host contract (plugin/client/host/contract.ts). The bundler swaps it in
// for plugin/client/host/index.ts, so every panel file that imports './host' gets these.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Modal as RNModal, Pressable, ScrollView as RNScrollView, Text, TextInput as RNTextInput, View, useWindowDimensions } from 'react-native';
import * as lucide from 'lucide-react';
import type { ZodType, output as ZodOutput } from 'zod';
import type { AgentSheetProps, AgentSnapshot, ClientHost, HostTheme, IconProps, ModalContentProps, ModalProps, SettingsState, ToastApi, ToastVariant, WindowInset } from '../../../../plugin/client/host/contract';
import type { RpcContract, SettingsDefinition } from '../../../../plugin/shared/contract';
import { TRAFFIC_LIGHT_INSET } from '../shared/chrome';
import { DESKTOP_WORKSPACE, desktopStatus, openExternal, settingsRpc, writeClipboard, type InvokeResult } from '../shared/rpc';

export type * from '../../../../plugin/client/host/contract';

declare global { interface Window { lienzo?: { invoke(name: string, input: unknown): Promise<InvokeResult>; trafficLights?: boolean; onFullScreen?(listener: (fullScreen: boolean) => void): () => void; saveFile?(file: { name: string; mime: string; text: string }): Promise<boolean>; onOpenFile?(listener: (file: { name: string; text: string; error?: string }) => void): () => void } } }

/** Electron IPC through the preload's one function; in the browser preview, the preview server's POST /rpc. */
export async function invoke(name: string, input: unknown): Promise<unknown> {
  const result: InvokeResult = window.lienzo
    ? await window.lienzo.invoke(name, input)
    : await fetch('/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, input }) }).then(response => response.json() as Promise<InvokeResult>);
  if (!result.ok) throw new Error(result.message);
  return result.value;
}
export async function call<C extends RpcContract>(contract: C, input: unknown): Promise<ZodOutput<C['output']>> {
  return contract.output.parse(await invoke(contract.name, contract.input.parse(input))) as ZodOutput<C['output']>;
}

// ---- Window chrome: on macOS the traffic lights sit over the top-left corner, except in full screen where they hide.
let fullScreen = false;
const chromeListeners = new Set<() => void>();
window.lienzo?.onFullScreen?.(next => { fullScreen = next; chromeListeners.forEach(listener => listener()); });
/** The corner the panel keeps clear of the window controls (`layout.inset`), or none. */
export function useWindowInset(): WindowInset | undefined {
  const full = useSyncExternalStore(listener => { chromeListeners.add(listener); return () => { chromeListeners.delete(listener); }; }, () => fullScreen);
  return window.lienzo?.trafficLights && !full ? TRAFFIC_LIGHT_INSET : undefined;
}

// ---- Theme, supplied by the shell (main.tsx) so host chrome (modals, toasts) matches the panel.
export const ThemeContext = createContext<HostTheme['colors'] | null>(null);
const useColors = () => useContext(ThemeContext) ?? { surface0: '#fff', surface1: '#fff', surface2: '#eee', border: '#ccc', foreground: '#222', foregroundMuted: '#666', accent: '#357', accentForeground: '#fff', statusSuccess: '#2F7D4F', statusWarning: '#9A6700', statusDanger: '#B3261E' };

// ---- Icons: lucide, by the same names Paseo uses. An unknown name draws a small dot rather than nothing.
const missing = new Set<string>();
export const Icon: ClientHost['Icon'] = function LucideIcon({ name, size = 16, color }: IconProps) {
  const Glyph = (lucide as unknown as Record<string, React.ComponentType<{ size?: number; color?: string; strokeWidth?: number; 'aria-hidden'?: boolean }>>)[name];
  if (!Glyph || typeof Glyph !== 'object' && typeof Glyph !== 'function') {
    if (!missing.has(name)) { missing.add(name); console.warn(`Lienzo: no icon named ${name}`); }
    return <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}><View style={{ width: size / 4, height: size / 4, borderRadius: size, backgroundColor: color }} /></View>;
  }
  return <View pointerEvents="none" style={{ width: size, height: size }}><Glyph size={size} color={color ?? 'currentColor'} strokeWidth={size <= 14 ? 2.25 : 2} aria-hidden /></View>;
};

export const ScrollView = RNScrollView as unknown as ClientHost['ScrollView'];
export const TextInput = RNTextInput as unknown as ClientHost['TextInput'];

// ---- Modal: a centred sheet over a dim backdrop. Escape and the backdrop close it.
function ModalContent({ children, style, contentContainerStyle, scrollable = true }: ModalContentProps) {
  const size = useWindowDimensions();
  if (!scrollable) return <View style={[{ flexShrink: 1, minHeight: 0 }, style]}>{children}</View>;
  return <RNScrollView style={[{ maxHeight: size.height - 120, flexShrink: 1 }, style]} contentContainerStyle={[{ padding: 24, paddingTop: 8, gap: 16 }, contentContainerStyle]}>{children}</RNScrollView>;
}
export const Modal: ClientHost['Modal'] = Object.assign(function DesktopModal({ title, icon, open, onOpenChange, children }: ModalProps) {
  const c = useColors(), size = useWindowDimensions();
  return <RNModal visible={open} transparent animationType="fade" onRequestClose={() => onOpenChange(false)}>
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16 }}>
      <Pressable accessibilityLabel="Close" onPress={() => onOpenChange(false)} style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(8,10,14,0.42)' }} />
      <View accessibilityRole={'dialog' as never} aria-label={title} style={{ width: Math.min(640, size.width - 32), maxHeight: size.height - 48, backgroundColor: c.surface1, borderRadius: 14, borderWidth: 1, borderColor: c.border, overflow: 'hidden', boxShadow: '0 18px 48px rgba(0,0,0,0.28)' } as never}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 24, paddingRight: 12, paddingVertical: 14 }}>
          {icon}
          <Text accessibilityRole="header" numberOfLines={1} style={{ flex: 1, fontSize: 17, fontWeight: '600', color: c.foreground }}>{title}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => onOpenChange(false)} style={state => ({ width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: (state as { hovered?: boolean }).hovered ? c.surface2 : 'transparent' })}>
            <Icon name="X" size={16} color={c.foregroundMuted} />
          </Pressable>
        </View>
        {children}
      </View>
    </View>
  </RNModal>;
}, { Content: ModalContent });

// ---- Toasts
type Toast = { id: number; message: string; variant: ToastVariant };
const ToastContext = createContext<ToastApi | null>(null);
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const c = useColors(), [toasts, setToasts] = useState<Toast[]>([]), next = useRef(0);
  const push = useCallback((message: string, variant: ToastVariant = 'default', durationMs = 3200) => {
    const id = ++next.current;
    setToasts(list => [...list.slice(-2), { id, message, variant }]);
    setTimeout(() => setToasts(list => list.filter(toast => toast.id !== id)), variant === 'error' ? Math.max(durationMs, 5000) : durationMs);
  }, []);
  const api = useMemo<ToastApi>(() => ({ show: (message, options) => push(message, options?.variant, options?.durationMs), error: message => push(message, 'error') }), [push]);
  const tone = (variant: ToastVariant) => variant === 'error' ? c.statusDanger : variant === 'success' ? c.statusSuccess : variant === 'warning' ? c.statusWarning : c.accent;
  return <ToastContext.Provider value={api}>{children}
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 88, alignItems: 'center', gap: 8 }}>
      {toasts.map(toast => <View key={toast.id} accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: 520, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, backgroundColor: c.surface1, borderWidth: 1, borderColor: c.border, boxShadow: '0 8px 24px rgba(0,0,0,0.18)' } as never}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tone(toast.variant) }} />
        <Text style={{ color: c.foreground, fontSize: 14, lineHeight: 20, flexShrink: 1 }}>{toast.message}</Text>
      </View>)}
    </View>
  </ToastContext.Provider>;
}
const silentToast: ToastApi = { show: message => console.info(message), error: message => console.warn(message) };
export const useToast: ClientHost['useToast'] = () => useContext(ToastContext) ?? silentToast;

export const copyText: ClientHost['copyText'] = async text => {
  try { await navigator.clipboard.writeText(text); return; } catch { /* fall back to the shell */ }
  const { written } = await call(writeClipboard, { text });
  if (!written) throw new Error('Copying is not available here.');
};
export const openExternalUrl: ClientHost['openExternalUrl'] = async url => {
  if (!/^https?:\/\//i.test(url)) throw new Error('Only web links open outside Lienzo.');
  const { opened } = await call(openExternal, { url });
  if (!opened) window.open(url, '_blank', 'noopener,noreferrer');
};

export const useRpc: ClientHost['useRpc'] = contract => useCallback((input: unknown) => call(contract, input), [contract]) as never;

// ---- Settings: one shared store per settings ID, so every component sees a save at once.
type SettingsEntry = { state: { status: 'loading' } | { status: 'error'; error: string } | { status: 'invalid'; error: string; revision: string } | { status: 'ready'; values: unknown; revision: string }; saving: boolean; saveError: string | null; listeners: Set<() => void>; loaded: boolean };
const settingsStore = new Map<string, SettingsEntry>();
function settingsEntry(id: string) {
  let entry = settingsStore.get(id);
  if (!entry) settingsStore.set(id, entry = { state: { status: 'loading' }, saving: false, saveError: null, listeners: new Set(), loaded: false });
  return entry;
}
function updateSettings(id: string, patch: Partial<Omit<SettingsEntry, 'listeners'>>) {
  const entry = settingsEntry(id); Object.assign(entry, patch);
  settingsStore.set(id, { ...entry }); entry.listeners.forEach(listener => listener());
}
async function loadSettings(definition: SettingsDefinition) {
  try {
    const result = await call(settingsRpc(definition.id).read, {});
    updateSettings(definition.id, { loaded: true, state: result.status === 'ready' ? { status: 'ready', revision: result.revision, values: definition.schema.parse(result.values) } : result });
  } catch (error) { updateSettings(definition.id, { loaded: true, state: { status: 'error', error: error instanceof Error ? error.message : String(error) } }); }
}
async function writeSettings(definition: SettingsDefinition, run: () => Promise<{ status: 'saved'; revision: string; values: unknown } | { status: 'conflict' | 'invalid'; error: string }>) {
  updateSettings(definition.id, { saving: true, saveError: null });
  try {
    const result = await run();
    if (result.status === 'saved') { updateSettings(definition.id, { saving: false, state: { status: 'ready', revision: result.revision, values: definition.schema.parse(result.values) } }); return true; }
    updateSettings(definition.id, { saving: false, saveError: result.error });
    if (result.status === 'conflict') void loadSettings(definition);
    return false;
  } catch (error) { updateSettings(definition.id, { saving: false, saveError: error instanceof Error ? error.message : String(error) }); return false; }
}
export const useSettings: ClientHost['useSettings'] = <S extends ZodType>(definition: SettingsDefinition<S>): SettingsState<S> => {
  const id = definition.id;
  const entry = useSyncExternalStore(listener => { const current = settingsEntry(id); current.listeners.add(listener); return () => { current.listeners.delete(listener); }; }, () => settingsEntry(id));
  useEffect(() => { if (!settingsEntry(id).loaded) void loadSettings(definition); }, [id]);
  return useMemo(() => {
    const contracts = settingsRpc(id);
    return {
      ...entry.state, saving: entry.saving, saveError: entry.saveError,
      save: (values: unknown, revision: string) => writeSettings(definition, () => call(contracts.write, { revision, values }) as never),
      reset: () => writeSettings(definition, () => call(contracts.reset, { revision: entry.state.status === 'ready' || entry.state.status === 'invalid' ? entry.state.revision : '0' }) as never),
      reload: () => loadSettings(definition),
    } as SettingsState<S>;
  }, [entry, id]);
};

// ---- Agents: the MCP clients the app has seen. The app runs no agents, so it knows names, not working status.
type Status = Awaited<ReturnType<typeof call<typeof desktopStatus>>>;
let status: Status | null = null, statusTimer: ReturnType<typeof setInterval> | undefined;
const statusListeners = new Set<() => void>();
export async function refreshStatus() {
  try { status = await call(desktopStatus, {}); } catch { /* keep the last known */ }
  statusListeners.forEach(listener => listener());
  return status;
}
function subscribeStatus(listener: () => void) {
  statusListeners.add(listener);
  if (statusListeners.size === 1) { void refreshStatus(); statusTimer = setInterval(() => { void refreshStatus(); }, 5000); }
  return () => { statusListeners.delete(listener); if (!statusListeners.size) clearInterval(statusTimer); };
}
export function useDesktopStatus() { return useSyncExternalStore(subscribeStatus, () => status); }
const snapshot = (client: Status['mcp']['clients'][number]): AgentSnapshot => ({ id: client.agentId, workspaceId: DESKTOP_WORKSPACE, provider: 'mcp', status: 'idle', title: client.name });
export const useAgent: ClientHost['useAgent'] = (agentId, selector) => {
  const current = useDesktopStatus(), client = current?.mcp.clients.find(entry => entry.agentId === agentId);
  if (!agentId) return null;
  // Known by ID even before the client reconnects this session: the ID carries its name.
  return selector(client ? snapshot(client) : { id: agentId, workspaceId: DESKTOP_WORKSPACE, provider: 'mcp', status: 'idle', title: agentId.replace(/^mcp:/, '') });
};
const directory = { agents: {
  list: async () => ({ entries: ((await refreshStatus())?.mcp.clients ?? []).map(client => ({ agent: { id: client.agentId, workspaceId: DESKTOP_WORKSPACE, provider: 'mcp' } })) }),
  subscribe: subscribeStatus,
} };
export const usePaseo: ClientHost['usePaseo'] = () => directory;

export const capabilities: ClientHost['capabilities'] = { kind: 'desktop', name: 'Lienzo', keptFor: 'on this computer', runsAgents: false };
// The sheet is provided by the shell (main.tsx): it uses the panel's UI kit, which imports this module.
let agentSheet: React.ComponentType<AgentSheetProps> | null = null;
export function provideAgentSheet(component: React.ComponentType<AgentSheetProps>) { agentSheet = component; }
export const AgentSheet: ClientHost['AgentSheet'] = function AgentSheetSlot(props: AgentSheetProps) { const Sheet = agentSheet; return Sheet ? <Sheet {...props} /> : null; };
let agentSettings: React.ComponentType<{ connectedAgentId: string | null }> | null = null;
export function provideAgentSettings(component: React.ComponentType<{ connectedAgentId: string | null }>) { agentSettings = component; }
export const AgentSettings: ClientHost['AgentSettings'] = function AgentSettingsSlot(props: { connectedAgentId: string | null }) { const Body = agentSettings; return Body ? <Body {...props} /> : null; };

let agentBadge: React.ComponentType | null = null;
export function provideAgentBadge(component: React.ComponentType) { agentBadge = component; }
export const AgentBadge: ClientHost['AgentBadge'] = function AgentBadgeSlot() { const Badge = agentBadge; return Badge ? <Badge /> : null; };

let aboutUpdates: React.ComponentType | null = null;
export function provideAboutUpdates(component: React.ComponentType) { aboutUpdates = component; }
export const AboutUpdates: ClientHost['AboutUpdates'] = function AboutUpdatesSlot() { const Body = aboutUpdates; return Body ? <Body /> : null; };

// .lienzo files: the system's Save dialog, and files opened with the app. The browser preview has neither: it downloads.
export const files: ClientHost['files'] = window.lienzo?.saveFile && window.lienzo.onOpenFile ? { save: file => window.lienzo!.saveFile!(file), onOpen: listener => window.lienzo!.onOpenFile!(listener) } : null;

// Every export above, checked against the contract in one place.
const host: ClientHost = { Icon, ScrollView, TextInput, Modal, useToast, copyText, openExternalUrl, useRpc, useSettings, useAgent, usePaseo, capabilities, AgentSheet, AgentSettings, AgentBadge, AboutUpdates, files };
void host;
