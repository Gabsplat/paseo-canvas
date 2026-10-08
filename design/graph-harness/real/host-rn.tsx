// Stand-in for `@getpaseo/plugin/client/react-native`. Icons are rough glyphs: this harness checks behaviour and
// motion of the real components, not the host's icon set.
import React from 'react';
import { Modal as RNModal, Pressable, ScrollView as RNScrollView, Text, TextInput as RNTextInput, useWindowDimensions, View } from 'react-native';
const glyph: Record<string, string> = { ChevronDown: '⌄', ChevronRight: '›', Plus: '+', Minus: '−', Maximize: '⤢', Pin: '•', PinOff: '◦', Compass: '◎', PanelRight: '▯', Ellipsis: '…', Check: '✓' };
let modalColors = { surface1: '#f8f6f2', foreground: '#252722' };
export const setMockModalColors = (colors: typeof modalColors) => { modalColors = colors; };
export function Icon({ name, size = 14, color }: { name: string; size?: number; color?: string }) {
  return <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color, fontSize: size, lineHeight: size, fontWeight: '700' }}>{glyph[name] ?? '▫'}</Text></View>;
}
export const ScrollView = RNScrollView, TextInput = RNTextInput;
// Host chrome is a stand-in. Use RN-web's portal so the real Guide and ImageViewer have independent hit testing.
export const Modal = Object.assign(({ children, title, open, onOpenChange }: any) => {
  const size = useWindowDimensions();
  return <RNModal visible={open} transparent onRequestClose={() => onOpenChange(false)}><View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,.35)' }}><View style={{ width: Math.min(680, size.width - 24), maxHeight: size.height - 24, backgroundColor: modalColors.surface1, borderRadius: 16, overflow: 'hidden' }}><View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 }}><Text accessibilityRole="header" style={{ flex: 1, fontSize: 16, color: modalColors.foreground }}>{title}</Text><Pressable accessibilityRole="button" accessibilityLabel="Cerrar modal" onPress={() => onOpenChange(false)} style={{ width: 32, height: 32, justifyContent: 'center', alignItems: 'center' }}><Text style={{ color: modalColors.foreground }}>×</Text></Pressable></View>{children}</View></View></RNModal>;
}, { Content: ({ children }: any) => { const size = useWindowDimensions(); return <RNScrollView style={{ maxHeight: size.height - 96, flexShrink: 1 }} contentContainerStyle={{ padding: 24, gap: 16 }}>{children}</RNScrollView>; } });
export const copyText = async (_text: string) => {};
export const useToast = () => ({ show: (_m: string) => {}, error: (_m: string) => {} });
