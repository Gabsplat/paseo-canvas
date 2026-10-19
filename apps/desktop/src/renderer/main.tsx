import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useWindowDimensions, View } from 'react-native';
import { LienzoPanel } from '../../../../plugin/client/Panel';
import { tokens } from '../../../../plugin/client/tokens';
import { LIENZO_THEMES, resolveDark, subscribeAppearance, getAppearance, themeFor, useAppearance } from '../../../../plugin/client/appearance';
import type { WindowInset } from '../../../../plugin/client/host/contract';
import { DESKTOP_WORKSPACE, setAppearance } from '../shared/rpc';
import { ConnectAgentBody, ConnectAgentSheet } from './ConnectAgent';
import { ThemeContext, ToastProvider, call, provideAboutUpdates, provideAgentSettings, provideAgentSheet, useWindowInset } from './host';
import { UIProvider } from '../../../../plugin/client/ui';
import { AboutUpdatesCard, UpdatePill } from './Updates';

provideAgentSheet(ConnectAgentSheet);
provideAgentSettings(ConnectAgentBody);
provideAboutUpdates(AboutUpdatesCard);

// Settings → Appearance also sets the window's native theme, so the title area and the background behind the page match.
let told: string | null = null;
const tellShell = () => { const appearance = getAppearance(); if (appearance === told) return; told = appearance; void call(setAppearance, { appearance }).catch(() => { told = null; }); };
subscribeAppearance(tellShell);

/** Light or dark, following the operating system and switching with it. */
function useDarkMode() {
  const query = useMemo(() => window.matchMedia('(prefers-color-scheme: dark)'), []);
  const [dark, setDark] = useState(query.matches);
  useEffect(() => { const change = () => setDark(query.matches); query.addEventListener('change', change); return () => query.removeEventListener('change', change); }, [query]);
  return dark;
}
/**
 * With no title bar, the window moves by its top edge: a strip above the top islands and the traffic lights' corner,
 * neither covering a control. macOS zooms on a double-click there, as on a title bar.
 */
function WindowDrag({ inset }: { inset: WindowInset }) {
  const drag = { position: 'fixed', top: 0, left: 0, WebkitAppRegion: 'drag' } as React.CSSProperties;
  return <>
    <div aria-hidden style={{ ...drag, right: 0, height: tokens.island.inset }} />
    <div aria-hidden style={{ ...drag, width: inset.left + tokens.island.inset, height: inset.top }} />
  </>;
}

function App() {
  // The host theme is Papel or Tinta by the operating system; Light or Dark in Settings replaces it (appearance.ts).
  const systemDark = useDarkMode(), appearance = useAppearance(), dark = resolveDark(appearance, systemDark), host = LIENZO_THEMES[systemDark ? 'dark' : 'light'], theme = themeFor(appearance, host), { width } = useWindowDimensions();
  const inset = useWindowInset(), shell = useMemo(() => ({ id: 'desktop', label: 'Lienzo' }), []), layout = useMemo(() => ({ compact: width < 600, platform: 'web' as const, inset }), [width < 600, inset]);
  useEffect(() => { document.documentElement.style.colorScheme = dark ? 'dark' : 'light'; document.body.style.backgroundColor = theme.colors.surface0; }, [dark, theme]);
  return <ThemeContext.Provider value={theme.colors}><ToastProvider>
    <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
      <LienzoPanel workspaceId={DESKTOP_WORKSPACE} host={shell} theme={host} layout={layout} />
      <UIProvider theme={host} host={shell} layout={layout}><UpdatePill /></UIProvider>
      {inset && <WindowDrag inset={inset} />}
    </View>
  </ToastProvider></ThemeContext.Provider>;
}

createRoot(document.getElementById('root')!).render(<App />);
