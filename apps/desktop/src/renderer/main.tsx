import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useWindowDimensions, View } from 'react-native';
import { LienzoPanel } from '../../../../plugin/client/Panel';
import { tokens } from '../../../../plugin/client/tokens';
import type { HostTheme } from '../../../../plugin/client/host/contract';
import { DESKTOP_WORKSPACE } from '../shared/rpc';
import { ConnectAgentBody, ConnectAgentSheet } from './ConnectAgent';
import { ThemeContext, ToastProvider, provideAboutUpdates, provideAgentSettings, provideAgentSheet } from './host';
import { UIProvider } from '../../../../plugin/client/ui';
import { AboutUpdatesCard, UpdatePill } from './Updates';

provideAgentSheet(ConnectAgentSheet);
provideAgentSettings(ConnectAgentBody);
provideAboutUpdates(AboutUpdatesCard);

/** Light or dark, following the operating system and switching with it. */
function useDarkMode() {
  const query = useMemo(() => window.matchMedia('(prefers-color-scheme: dark)'), []);
  const [dark, setDark] = useState(query.matches);
  useEffect(() => { const change = () => setDark(query.matches); query.addEventListener('change', change); return () => query.removeEventListener('change', change); }, [query]);
  return dark;
}
/** Lienzo's own Papel and Tinta themes, as the host theme Paseo would hand the panel. */
function themeFor(dark: boolean): HostTheme {
  const palette = tokens.contributedThemes[dark ? 'lienzo-tinta' : 'lienzo-papel'].colors, status = tokens.mockOnly[dark ? 'dark' : 'light'];
  return { colors: { surface0: palette.background, surface1: palette.raised, surface2: palette.control, border: palette.border, foreground: palette.foreground, foregroundMuted: palette.mutedForeground, accent: palette.accent, accentForeground: status.onAccent, statusSuccess: status.success, statusWarning: status.warning, statusDanger: status.danger } };
}

function App() {
  const dark = useDarkMode(), theme = useMemo(() => themeFor(dark), [dark]), { width } = useWindowDimensions();
  const host = useMemo(() => ({ id: 'desktop', label: 'Lienzo' }), []), layout = useMemo(() => ({ compact: width < 600, platform: 'web' as const }), [width < 600]);
  useEffect(() => { document.documentElement.style.colorScheme = dark ? 'dark' : 'light'; document.body.style.backgroundColor = theme.colors.surface0; }, [dark, theme]);
  return <ThemeContext.Provider value={theme.colors}><ToastProvider>
    <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
      <LienzoPanel workspaceId={DESKTOP_WORKSPACE} host={host} theme={theme} layout={layout} />
      <UIProvider theme={theme} host={host} layout={layout}><UpdatePill /></UIProvider>
    </View>
  </ToastProvider></ThemeContext.Provider>;
}

createRoot(document.getElementById('root')!).render(<App />);
