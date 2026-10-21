// The Paseo implementation of the panel's host contract (./contract.ts): the plugin SDK, unchanged underneath.
// The desktop app replaces this module at build time with its own implementation of the same contract.
import { openExternalUrl as sdkOpenExternalUrl, useAgent as sdkUseAgent, usePaseo as sdkUsePaseo, useRpc as sdkUseRpc, useSettings as sdkUseSettings } from '@getpaseo/plugin/client';
import { Icon as SdkIcon, Modal as SdkModal, ScrollView as SdkScrollView, TextInput as SdkTextInput, copyText as sdkCopyText, useToast as sdkUseToast } from '@getpaseo/plugin/client/react-native';
import type { ClientHost } from './contract';

export type * from './contract';
// Paseo-only contributions (composer pills, slash commands): used by index.client.tsx and copilot/, never by the panel.
export type { PluginButtonContentProps, PluginButtonIconProps, PluginButtonRegistration, PluginClientContext } from '@getpaseo/plugin/client';

export const Icon: ClientHost['Icon'] = SdkIcon;
export const ScrollView: ClientHost['ScrollView'] = SdkScrollView;
export const TextInput: ClientHost['TextInput'] = SdkTextInput;
export const Modal: ClientHost['Modal'] = SdkModal;
export const useToast: ClientHost['useToast'] = sdkUseToast;
export const copyText: ClientHost['copyText'] = sdkCopyText;
export const openExternalUrl: ClientHost['openExternalUrl'] = sdkOpenExternalUrl;
export const useRpc: ClientHost['useRpc'] = sdkUseRpc;
export const useSettings: ClientHost['useSettings'] = sdkUseSettings as ClientHost['useSettings'];
export const useAgent: ClientHost['useAgent'] = sdkUseAgent;
export const usePaseo: ClientHost['usePaseo'] = sdkUsePaseo as unknown as ClientHost['usePaseo'];
export const capabilities: ClientHost['capabilities'] = { kind: 'paseo', name: 'Paseo', keptFor: 'for this Paseo host', runsAgents: true };
export const AgentSheet: ClientHost['AgentSheet'] = null;
export const AgentSettings: ClientHost['AgentSettings'] = null;
// Paseo's agents run inside Paseo; nothing is shared with other computers from here.
export const AgentBadge: ClientHost['AgentBadge'] = null;
// Paseo updates the plugin itself; the panel shows no app updates.
export const AboutUpdates: ClientHost['AboutUpdates'] = null;
// Paseo has no file dialogs of its own here: a .lienzo file is downloaded by the browser and opened with a picker.
export const files: ClientHost['files'] = null;
// A browser page cannot take a picture of itself cheaply: lienzo.view.snapshot says null and canSnapshot false.
export const capture: ClientHost['capture'] = null;
