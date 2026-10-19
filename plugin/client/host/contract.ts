import type { ComponentType, ForwardRefExoticComponent, FunctionComponent, ReactNode, RefAttributes } from 'react';
import type { ScrollView as NativeScrollView, ScrollViewProps, StyleProp, TextInput as NativeTextInput, TextInputProps, ViewStyle } from 'react-native';
import type { ZodType, input as ZodInput, output as ZodOutput } from 'zod';
import type { RpcContract, SettingsDefinition } from '../../shared/contract';

/**
 * Everything the Lienzo panel takes from the app that hosts it. `./index.ts` is the Paseo implementation (the plugin
 * SDK); the desktop app swaps that module for its own at build time. Panel code imports only from `./host`, and only
 * these shapes, so both hosts compile against the same contract.
 */
export interface HostTheme {
  readonly colors: {
    readonly surface0: string; readonly surface1: string; readonly surface2: string; readonly border: string;
    readonly foreground: string; readonly foregroundMuted: string; readonly accent: string; readonly accentForeground: string;
    readonly statusSuccess: string; readonly statusWarning: string; readonly statusDanger: string;
  };
}
export interface HostProps {
  theme: HostTheme;
  host: { id: string; label: string };
  layout: { compact: boolean; platform: 'ios' | 'android' | 'web'; inset?: WindowInset };
}
/**
 * Room the host's window controls take inside the panel (the desktop app on macOS draws its traffic lights over the
 * top-left corner): `left` along the top row, `top` down the left edge. Paseo passes none.
 */
export interface WindowInset { readonly left: number; readonly top: number }
export interface PanelProps extends HostProps { workspaceId: string }

export interface IconProps { name: string; size?: number; color?: string }
export interface ModalProps { title: string; icon?: ReactNode; open: boolean; onOpenChange(open: boolean): void; children: ReactNode }
export interface ModalContentProps { children: ReactNode; style?: StyleProp<ViewStyle>; contentContainerStyle?: StyleProp<ViewStyle>; scrollable?: boolean }
export interface ModalComponent extends FunctionComponent<ModalProps> { Content: ComponentType<ModalContentProps> }
export type ToastVariant = 'default' | 'info' | 'success' | 'warning' | 'error';
export interface ToastApi { show(message: string, options?: { variant?: ToastVariant; durationMs?: number }): void; error(message: string): void }

export type SettingsState<Schema extends ZodType> = (
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'invalid'; error: string; revision: string }
  | { status: 'ready'; values: ZodOutput<Schema>; revision: string }
) & {
  saving: boolean;
  saveError: string | null;
  /** Save an entire document against the revision currently displayed. Never throws. */
  save(values: ZodOutput<Schema>, revision: string): Promise<boolean>;
  reset(): Promise<boolean>;
  reload(): Promise<void>;
};

export type AgentStatus = 'initializing' | 'idle' | 'running' | 'error' | 'closed';
export interface AgentSnapshot { readonly id: string; readonly workspaceId: string; readonly provider: string; readonly status: AgentStatus; readonly title: string | null }
/** The agents a host runs. Hosts without agents return an empty directory. */
export interface AgentDirectory {
  agents: {
    list(): Promise<{ entries: readonly { agent: { id: string; workspaceId: string; provider: string } }[] }>;
    subscribe(listener: () => void): () => void;
  };
}
export interface AgentSheetProps { open: boolean; close(): void; connectedAgentId: string | null }

export interface HostCapabilities {
  readonly kind: 'paseo' | 'desktop';
  /** Shown where the panel names its host ("No connection to Paseo"). */
  readonly name: string;
  /** Where interface choices are kept, completing "saved …": "for this Paseo host". */
  readonly keptFor: string;
  /** The host runs agents: it lists them with a live status and can deliver canvas actions to them as messages. */
  readonly runsAgents: boolean;
}

/** A file the person saves or opens: a .lienzo file (shared/lienzo-file.ts). */
/** `error`: the host could not read it (too large, unreadable); `text` is then empty. */
export interface HostFile { readonly name: string; readonly text: string; readonly error?: string }
/**
 * Files the host handles itself: the desktop app saves with the system's Save dialog and hands over the .lienzo files
 * the system opens with it. Absent (Paseo): the panel downloads through the browser and opens with a file picker.
 */
export interface HostFiles {
  /** Resolves false when the person cancelled the dialog. */
  save(file: HostFile & { mime: string }): Promise<boolean>;
  /** Files opened with the app (double-click, "Open with", a drop on its icon), including any that started it. */
  onOpen(listener: (file: HostFile) => void): () => void;
}

export interface ClientHost {
  Icon: ComponentType<IconProps>;
  ScrollView: ForwardRefExoticComponent<ScrollViewProps & RefAttributes<NativeScrollView>>;
  TextInput: ForwardRefExoticComponent<TextInputProps & RefAttributes<NativeTextInput>>;
  Modal: ModalComponent;
  useToast(): ToastApi;
  copyText(text: string): Promise<void>;
  openExternalUrl(url: string): Promise<void>;
  useRpc<I extends ZodType, O extends ZodType>(contract: RpcContract<I, O>): (input: ZodInput<I>) => Promise<ZodOutput<O>>;
  useSettings<S extends ZodType>(definition: SettingsDefinition<S>): SettingsState<S>;
  useAgent<Selection>(agentId: string, selector: (agent: AgentSnapshot) => Selection): Selection | null;
  usePaseo(): AgentDirectory;
  capabilities: HostCapabilities;
  /** Replaces the Paseo agent dialog on hosts that do not run agents. */
  AgentSheet: ComponentType<AgentSheetProps> | null;
  /** Settings → Agents on hosts that connect agents over MCP (the desktop app): address, setup commands, agents seen. */
  AgentSettings: ComponentType<{ connectedAgentId: string | null }> | null;
  /** Settings → About on hosts that update themselves (the desktop app): update state, check, the auto-check switch. */
  AboutUpdates: ComponentType | null;
  files: HostFiles | null;
}
