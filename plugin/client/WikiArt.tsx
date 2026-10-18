/**
 * The small pictures of Help (shared/wiki/art.ts), drawn with plain views in the theme's colours at any width. A
 * picture: it is hidden from screen readers and nothing in it is pressable.
 */
import React from 'react';
import { View, type ViewStyle } from 'react-native';
import { ART, ART_BOX, type ArtItem, type ArtTone, type WikiArtId } from '../shared/wiki';
import { withAlpha } from './color';
import { Txt, useUI } from './ui';

function Line({ x1, y1, x2, y2, color, width, dashed, k }: { x1: number; y1: number; x2: number; y2: number; color: string; width: number; dashed?: boolean; k: number }) {
  const dx = (x2 - x1) * k, dy = (y2 - y1) * k, length = Math.hypot(dx, dy), angle = Math.atan2(dy, dx);
  return <View style={{ position: 'absolute', left: ((x1 + x2) / 2) * k - length / 2, top: ((y1 + y2) / 2) * k - width / 2, width: length, height: width,
    transform: [{ rotate: `${angle}rad` }], ...(dashed ? { borderTopWidth: width, borderStyle: 'dashed', borderColor: color } : { backgroundColor: color, borderRadius: width / 2 }) } as ViewStyle} />;
}

export function WikiArt({ id, width, nativeID }: { id: WikiArtId; width: number; nativeID?: string }) {
  const u = useUI(), k = width / ART_BOX.width, ink = (tone?: ArtTone) => !tone || tone === 'neutro' ? u.c.foregroundMuted : u.tone(tone);
  const item = (a: ArtItem, i: number): React.ReactNode => {
    const box = (x: number, y: number, w: number, h: number): ViewStyle => ({ position: 'absolute', left: x * k, top: y * k, width: w * k, height: h * k });
    switch (a.k) {
      case 'card': return <View key={i} style={{ ...box(a.x, a.y, a.w, a.h), borderRadius: 6 * k, borderWidth: 1, borderColor: u.c.border, backgroundColor: u.c.surface1, overflow: 'hidden', padding: 5 * k, gap: 4 * k }}>
        <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 * k, backgroundColor: ink(a.tone) }} />
        <View style={{ height: 4 * k, width: '70%', marginLeft: 3 * k, borderRadius: 2, backgroundColor: withAlpha(u.c.foreground, .55) }} />
        {Array.from({ length: a.lines ?? (a.h > 24 ? 1 : 0) }, (_, n) => <View key={n} style={{ height: 3 * k, width: `${80 - n * 15}%`, marginLeft: 3 * k, borderRadius: 2, backgroundColor: withAlpha(u.c.foreground, .2) }} />)}
      </View>;
      case 'box': return <View key={i} style={{ ...box(a.x, a.y, a.w, a.h), borderRadius: (a.radius ?? 0) * k, borderWidth: a.fill ? 0 : 1.5, borderStyle: a.dashed ? 'dashed' : 'solid', borderColor: ink(a.tone), backgroundColor: a.fill ? withAlpha(ink(a.tone), a.tone && a.tone !== 'neutro' ? .28 : .14) : 'transparent', alignItems: 'center', justifyContent: a.label && !a.fill ? 'flex-start' : 'center' }}>
        {!!a.label && <Txt numberOfLines={1} style={{ fontSize: 8 * k, lineHeight: 11 * k, marginTop: a.fill ? 0 : 3 * k, color: a.fill ? u.c.foreground : ink(a.tone), fontWeight: '600' }}>{a.label}</Txt>}
      </View>;
      case 'ellipse': return <View key={i} style={{ ...box(a.x, a.y, a.w, a.h), borderRadius: Math.max(a.w, a.h) * k, borderWidth: a.fill ? 0 : 1.5, borderColor: ink(a.tone), backgroundColor: a.fill ? withAlpha(ink(a.tone), .4) : 'transparent' }} />;
      case 'diamond': return <View key={i} style={{ ...box(a.x + a.size * .15, a.y + a.size * .15, a.size * .7, a.size * .7), borderWidth: 1.5, borderColor: ink(a.tone), transform: [{ rotate: '45deg' }] }} />;
      case 'line': {
        const w = Math.max(1, (a.width ?? 1.5) * Math.min(1.4, k)), color = ink(a.tone ?? 'neutro'), angle = Math.atan2(a.y2 - a.y1, a.x2 - a.x1), head = 6;
        return <React.Fragment key={i}><Line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} color={color} width={w} dashed={a.dashed} k={k} />
          {a.head && [-1, 1].map(side => <Line key={side} x1={a.x2} y1={a.y2} x2={a.x2 - head * Math.cos(angle + side * .5)} y2={a.y2 - head * Math.sin(angle + side * .5)} color={color} width={w} k={k} />)}</React.Fragment>;
      }
      case 'stroke': { const w = (a.width ?? 2) * Math.min(1.4, k), color = ink(a.tone);
        return <React.Fragment key={i}>{Array.from({ length: a.points.length / 2 - 1 }, (_, n) => <Line key={n} x1={a.points[2 * n]} y1={a.points[2 * n + 1]} x2={a.points[2 * n + 2]} y2={a.points[2 * n + 3]} color={color} width={w} dashed={a.dashed} k={k} />)}</React.Fragment>; }
      case 'text': return <Txt key={i} numberOfLines={1} style={{ position: 'absolute', left: a.x * k, top: a.y * k, width: a.w * k, fontSize: (a.size ?? 10) * k, lineHeight: (a.size ?? 10) * 1.3 * k, textAlign: a.align ?? 'left', color: a.tone ? ink(a.tone) : u.c.foreground, ...(a.serif ? { fontFamily: u.font('title').fontFamily, fontWeight: '600' } : {}) }}>{a.text}</Txt>;
      case 'dot': return <View key={i} style={{ ...box(a.x - a.r, a.y - a.r, 2 * a.r, 2 * a.r), borderRadius: a.r * k, borderWidth: a.fill ? 0 : 1.5, borderColor: ink(a.tone), backgroundColor: a.fill ? ink(a.tone) : 'transparent' }} />;
      case 'window': return <View key={i} style={{ ...box(a.x, a.y, a.w, a.h), borderRadius: 7 * k, borderWidth: 1.5, borderColor: ink(a.tone), backgroundColor: u.c.surface1, overflow: 'hidden' }}>
        <View style={{ height: 13 * k, borderBottomWidth: 1, borderColor: u.c.border, paddingHorizontal: 5 * k, justifyContent: 'center' }}><Txt numberOfLines={1} style={{ fontSize: 7 * k, lineHeight: 10 * k, color: u.c.foregroundMuted, fontWeight: '600' }}>{a.title ?? ''}</Txt></View>
      </View>;
      case 'cursor': return <View key={i} style={{ position: 'absolute', left: a.x * k, top: a.y * k, width: 0, height: 0, borderLeftWidth: 5 * k, borderRightWidth: 5 * k, borderBottomWidth: 12 * k, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: u.c.foreground, transform: [{ rotate: '-25deg' }] }} />;
      case 'keys': return <View key={i} style={{ position: 'absolute', left: a.x * k, top: a.y * k, flexDirection: 'row', gap: 3 * k }}>{a.keys.map(key => <View key={key} style={{ minWidth: 16 * k, height: 16 * k, paddingHorizontal: 3 * k, borderRadius: 4 * k, borderWidth: 1, borderBottomWidth: 2, borderColor: u.c.border, backgroundColor: u.c.surface1, alignItems: 'center', justifyContent: 'center' }}><Txt style={{ fontSize: 9 * k, lineHeight: 12 * k, fontWeight: '600' }}>{key}</Txt></View>)}</View>;
      case 'slider': return <View key={i} style={{ ...box(a.x, a.y - 6, a.w, 12), justifyContent: 'center' }}>
        <View style={{ height: 3 * k, borderRadius: 2, backgroundColor: withAlpha(u.c.foreground, .15) }}><View style={{ height: '100%', width: `${a.at * 100}%`, borderRadius: 2, backgroundColor: ink(a.tone) }} /></View>
        <View style={{ position: 'absolute', left: a.at * a.w * k - 5 * k, width: 10 * k, height: 10 * k, borderRadius: 5 * k, backgroundColor: ink(a.tone), borderWidth: 2, borderColor: u.c.surface1 }} />
      </View>;
    }
  };
  return <View nativeID={nativeID} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ width, height: ART_BOX.height * k, overflow: 'hidden' }}>{ART[id].map(item)}</View>;
}
