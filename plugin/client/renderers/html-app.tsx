import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { HTML_APP_LIMITS, htmlAppInteraction, htmlAppState, type HtmlAppData } from '../../shared/renderers/html-app';
import { isDark } from '../color';
import { Txt } from '../ui';
import { WebHtml } from '../web';
import type { RendererProps, ClientRenderer } from './types';
/**
 * A mini app. What the page keeps (lienzo.setState) is stored on the block as runtime state `{ state }`, where the agent
 * reads it with canvas_selection or canvas_read; a page written before setState records its last lienzo.send call as
 * the block's lastInteraction. Nothing is sent to the agent.
 */
function HtmlApp({ data, block, ui, document, selection = [], select, runtime }: RendererProps<HtmlAppData>) {
  const [asked, setAsked] = useState<number | null>(null);
  const height = block.size ? '100%' as const : asked ?? data.height ?? HTML_APP_LIMITS.defaultHeight;
  const stored = runtime.state.state === undefined ? null : runtime.state.state, storedKey = JSON.stringify(stored);
  // What the page is told: enough to match the theme, restore what it stored and react to the selection.
  const context = useMemo(() => ({
    theme: { dark: isDark(ui.c.surface0), colors: { background: ui.c.surface0, surface: ui.c.surface1, foreground: ui.c.foreground, muted: ui.c.foregroundMuted, border: ui.c.border, accent: ui.c.accent } },
    block: { id: block.id, title: block.title }, document: { id: document.id, title: document.title }, state: stored,
    selection: selection.slice(0, 20).map(id => ({ id, title: [...document.blocks, ...document.groups].find(e => e.id === id)?.title ?? '' })),
  }), [ui.c, block.id, block.title, document.id, document.title, document.blocks, document.groups, selection, storedKey]);
  if (ui.layout.platform !== 'web') return <View style={{ padding: 12, gap: 4 }}><Txt kind="bodyStrong">{block.title || 'Mini app'}</Txt><Txt kind="small" muted>This mini app runs in the web and desktop apps.</Txt></View>;
  return <View style={{ height: block.size ? block.size.height - 28 : height }}>
    <WebHtml id={block.id} html={data.html} title={block.title || 'Mini app'} surface={ui.c.surface0} context={context} onMessage={(message, reply) => {
      if (message.type === 'resize' && typeof message.height === 'number' && Number.isFinite(message.height)) setAsked(Math.max(HTML_APP_LIMITS.minHeight, Math.min(HTML_APP_LIMITS.maxHeight, Math.round(message.height))));
      else if (message.type === 'select' && typeof message.id === 'string' && [...document.blocks, ...document.groups].some(e => e.id === message.id)) select?.([message.id]);
      else if (message.type === 'state') {
        const value = htmlAppState(message.value);
        if (!value) { reply({ type: 'stored', id: message.id, ok: false, error: `State must be plain JSON of at most ${HTML_APP_LIMITS.state} characters.` }); return; }
        const { state: _old, ...rest } = runtime.state;
        try { runtime.set(value.value === null ? Object.keys(rest).length ? rest : null : { ...rest, state: value.value as never }, true); }
        catch { reply({ type: 'stored', id: message.id, ok: false, error: 'This mini app cannot store state right now.' }); return; }
        void runtime.flush().then(() => reply({ type: 'stored', id: message.id, ok: true }), () => reply({ type: 'stored', id: message.id, ok: false, error: 'Not saved. Check the connection and try again.' }));
      } else if (message.type === 'event') {
        const interaction = htmlAppInteraction(message.kind, message.payload);
        if (!interaction) return;
        const payload = interaction.payload === undefined ? null : interaction.payload && typeof interaction.payload === 'object' && !Array.isArray(interaction.payload) ? interaction.payload as Record<string, never> : { value: interaction.payload as never };
        void runtime.record(interaction.kind, payload, `Mini app “${block.title || block.id}”: ${interaction.kind}`).catch(() => {});
      }
    }} />
  </View>;
}
export const htmlAppRenderer: ClientRenderer<HtmlAppData> = { id: 'html', Component: HtmlApp, visual: { icon: 'AppWindow', tone: 'acento', width: 'wide' } };
