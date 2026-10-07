import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { HTML_APP_LIMITS, htmlAppEvent, type HtmlAppData } from '../../shared/renderers/html-app';
import { isDark } from '../color';
import { Txt } from '../ui';
import { WebHtml } from '../web';
import type { RendererProps, ClientRenderer } from './types';
function HtmlApp({ data, block, ui, document, selection = [], select, send }: RendererProps<HtmlAppData>) {
  const [asked, setAsked] = useState<number | null>(null);
  const height = block.size ? '100%' as const : asked ?? data.height ?? HTML_APP_LIMITS.defaultHeight;
  // What the page is told: enough to match the theme and to react to the selection, nothing it could not see on screen.
  const context = useMemo(() => ({
    theme: { dark: isDark(ui.c.surface0), colors: { background: ui.c.surface0, surface: ui.c.surface1, foreground: ui.c.foreground, muted: ui.c.foregroundMuted, border: ui.c.border, accent: ui.c.accent } },
    block: { id: block.id, title: block.title }, document: { id: document.id, title: document.title },
    selection: selection.slice(0, 20).map(id => ({ id, title: [...document.blocks, ...document.groups].find(e => e.id === id)?.title ?? '' })),
  }), [ui.c, block.id, block.title, document.id, document.title, document.blocks, document.groups, selection]);
  if (ui.layout.platform !== 'web') return <View style={{ padding: 12, gap: 4 }}><Txt kind="bodyStrong">{block.title || 'Mini app'}</Txt><Txt kind="small" muted>Esta mini app se ejecuta en la versión web o de escritorio.</Txt></View>;
  return <View style={{ height: block.size ? block.size.height - 28 : height }}>
    <WebHtml id={block.id} html={data.html} title={block.title || 'Mini app'} surface={ui.c.surface0} context={context} onMessage={message => {
      if (message.type === 'resize' && typeof message.height === 'number' && Number.isFinite(message.height)) setAsked(Math.max(HTML_APP_LIMITS.minHeight, Math.min(HTML_APP_LIMITS.maxHeight, Math.round(message.height))));
      else if (message.type === 'select' && typeof message.id === 'string' && [...document.blocks, ...document.groups].some(e => e.id === message.id)) select?.([message.id]);
      else if (message.type === 'event') { const event = htmlAppEvent(message.kind, message.payload); if (event) void send('html.event', { event: event.kind, data: event.payload as never }, `Mini app «${block.title || block.id}»: ${event.kind}`, 'batched').catch(() => {}); }
    }} />
  </View>;
}
export const htmlAppRenderer: ClientRenderer<HtmlAppData> = { id: 'html', Component: HtmlApp, visual: { icon: 'AppWindow', tone: 'acento', width: 'wide' } };
