import type { PluginClientContext } from '@getpaseo/plugin/client';
import { LienzoPanel } from './client/Panel';
import { tokens } from './client/tokens';
export default function contribute(client: PluginClientContext) {
  const cleanup = [
    client.addWorkspacePanel({ id: 'canvas', title: 'Lienzo', icon: 'Frame', context: 'workspace', locations: ['workspace', 'explorer'], Component: LienzoPanel }),
    client.addCommandCenterItem({ id: 'open-canvas', title: 'Abrir Lienzo', icon: 'Frame', context: 'workspace', keywords: ['canvas', 'lienzo', 'bloques'], onSelect({ openPanel }) { openPanel('canvas'); } }),
    // Agent context: the command is typed in an agent's composer. A workspace-context command never matches there
    // and the text would be sent to the agent instead.
    client.addSlashCommand({ name: 'lienzo', description: 'Abrir el lienzo de este espacio', argumentHint: '', context: 'agent', onSubmit({ openPanel }) { openPanel('canvas', { location: 'explorer' }); } }),
    ...Object.entries(tokens.contributedThemes).map(([id, theme]) => client.addTheme({ id, ...theme })),
  ];
  return () => { cleanup.reverse().forEach(remove => { void remove(); }); };
}
