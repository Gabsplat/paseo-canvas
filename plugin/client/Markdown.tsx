/**
 * Draws the safe Markdown of shared/markdown.ts with native text: Help pages and the guides extensions bring. Nothing
 * here interprets HTML; a link opens only through the host (http, https, mailto) or moves to another Help page.
 */
import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { ScrollView, copyText, openExternalUrl } from './host';
import { parseMarkdown, type Inline } from '../shared/markdown';
import { IconButton, Txt, useUI } from './ui';

function Inlines({ inlines, onHelp }: { inlines: readonly Inline[]; onHelp?(id: string): void }) {
  const u = useUI();
  return <>{inlines.map((inline, i) => {
    // Plain Text inherits the line's font, so bold in a heading stays a heading.
    if (inline.kind === 'bold') return <Text key={i} style={{ fontWeight: '600' }}>{inline.text}</Text>;
    if (inline.kind === 'italic') return <Text key={i} style={{ fontStyle: 'italic' }}>{inline.text}</Text>;
    if (inline.kind === 'code') return <Text key={i} style={{ fontFamily: u.font('code').fontFamily, backgroundColor: u.c.surface2, borderRadius: 4 }}>{' ' + inline.text + ' '}</Text>;
    if (inline.kind === 'link') {
      const help = inline.href.startsWith('help:') ? inline.href.slice(5) : null;
      return <Text key={i} accessibilityRole="link" style={{ color: u.c.accent, textDecorationLine: 'underline' }}
        onPress={() => { if (help) onHelp?.(help); else void openExternalUrl(inline.href); }}>{inline.text}</Text>;
    }
    return <React.Fragment key={i}>{inline.text}</React.Fragment>;
  })}</>;
}

export function Markdown({ source, onHelp, nativeID }: { source: string; onHelp?(id: string): void; nativeID?: string }) {
  const u = useUI(), blocks = useMemo(() => parseMarkdown(source), [source]);
  return <View nativeID={nativeID} style={{ gap: 10 }}>{blocks.map((block, i) => {
    switch (block.kind) {
      case 'heading': return <Txt key={i} kind={block.level === 1 ? 'title' : 'heading'} accessibilityRole="header" style={{ marginTop: i ? 8 : 0 }}><Inlines inlines={block.inlines} onHelp={onHelp} /></Txt>;
      case 'paragraph': return <Txt key={i} style={{ lineHeight: 21 }}><Inlines inlines={block.inlines} onHelp={onHelp} /></Txt>;
      case 'note': return <View key={i} style={{ flexDirection: 'row', gap: 10, padding: 12, borderRadius: 8, backgroundColor: u.wash('acento') }}><View style={{ width: 3, borderRadius: 2, backgroundColor: u.c.accent }} /><Txt style={{ flex: 1, lineHeight: 21 }}><Inlines inlines={block.inlines} onHelp={onHelp} /></Txt></View>;
      case 'list': return <View key={i} style={{ gap: 6 }}>{block.items.map((item, n) => <View key={n} style={{ flexDirection: 'row', gap: 8 }}>
        <Txt muted style={{ width: block.ordered ? 20 : 12, textAlign: 'right', lineHeight: 21 }}>{block.ordered ? `${n + 1}.` : '•'}</Txt>
        <Txt style={{ flex: 1, lineHeight: 21 }}><Inlines inlines={item} onHelp={onHelp} /></Txt></View>)}</View>;
      case 'code': return <View key={i} style={{ borderRadius: 8, borderWidth: 1, borderColor: u.c.border, backgroundColor: u.c.surface0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 12, paddingRight: 2, minHeight: 30, borderBottomWidth: 1, borderColor: u.c.border }}>
          <Txt kind="small" muted style={{ flex: 1 }}>{block.language || 'text'}</Txt>
          <IconButton icon="Copy" label="Copy the code" onPress={() => { void copyText(block.text); }} />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ padding: 12 }}><Txt kind="code" selectable>{block.text}</Txt></ScrollView>
      </View>;
    }
  })}</View>;
}
