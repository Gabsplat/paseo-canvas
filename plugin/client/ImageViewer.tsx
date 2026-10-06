import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, PanResponder, View } from 'react-native';
import { Modal, IconButton, Txt, useUI } from './ui';
import { NATIVE, settle } from './motion';
import { tokens } from './tokens';

/** Image navigation stays inside its modal; the underlying canvas never receives the gesture. */
export function ImageViewer({ url, title, open, close }: { url: string; title: string; open: boolean; close: () => void }) {
  const u = useUI(), V = tokens.media.viewer, [zoom, setZoom] = useState<number>(V.zoomMin), [failed, setFailed] = useState(false), size = useRef({ width: 0, height: 0 });
  const x = useRef(new Animated.Value(0)).current, y = useRef(new Animated.Value(0)).current, offset = useRef({ x: 0, y: 0 }), origin = useRef({ x: 0, y: 0 }), scale = useRef(1); scale.current = zoom;
  useEffect(() => { const a = x.addListener(({ value }) => { offset.current.x = value; }), b = y.addListener(({ value }) => { offset.current.y = value; }); return () => { x.removeListener(a); y.removeListener(b); }; }, []);
  const reset = () => { setZoom(V.zoomMin); x.stopAnimation(); y.stopAnimation(); x.setValue(0); y.setValue(0); };
  useEffect(() => { if (open) { reset(); setFailed(false); } }, [open, url]);
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => scale.current > 1 && Math.abs(g.dx) + Math.abs(g.dy) > tokens.motion.drag.threshold,
    onPanResponderGrant: () => { x.stopAnimation(); y.stopAnimation(); origin.current = { ...offset.current }; },
    onPanResponderMove: (_, g) => { x.setValue(origin.current.x + g.dx); y.setValue(origin.current.y + g.dy); },
    onPanResponderRelease: (_, g) => {
      const maxX = (scale.current - 1) * size.current.width / 2, maxY = (scale.current - 1) * size.current.height / 2;
      settle(x, Math.max(-maxX, Math.min(maxX, offset.current.x)), { native: NATIVE, velocity: g.vx * 1000 });
      settle(y, Math.max(-maxY, Math.min(maxY, offset.current.y)), { native: NATIVE, velocity: g.vy * 1000 });
    },
    onPanResponderTerminationRequest: () => false,
  }), []);
  return <Modal title={title || 'Imagen'} open={open} onOpenChange={v => { if (!v) close(); }}><Modal.Content>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
      <IconButton icon="Minus" label="Alejar imagen" disabled={zoom <= V.zoomMin} onPress={() => { if (zoom <= V.zoomMin + V.zoomStep) reset(); else setZoom(v => v - V.zoomStep); }} />
      <Txt kind="label" muted>{Math.round(zoom * 100)}%</Txt>
      <IconButton icon="Plus" label="Acercar imagen" disabled={zoom >= V.zoomMax} onPress={() => setZoom(v => Math.min(V.zoomMax, v + V.zoomStep))} />
      <IconButton icon="Maximize" label="Ajustar imagen" onPress={reset} />
    </View>
    <View nativeID="lienzo-interactive-image-viewer" {...pan.panHandlers} onLayout={e => { size.current = e.nativeEvent.layout; }} style={{ height: u.compact ? V.heightCompact : V.height, overflow: 'hidden', borderRadius: tokens.radius.control, backgroundColor: u.c.surface0 }}>
      {failed ? <Txt style={{ padding: 16 }} muted>No se pudo cargar la imagen.</Txt> : <Animated.View style={{ flex: 1, transform: [{ translateX: x }, { translateY: y }, { scale: zoom }] }}><Image source={{ uri: url }} accessibilityLabel={title || 'Imagen'} resizeMode="contain" onError={() => setFailed(true)} style={{ width: '100%', height: '100%' }} /></Animated.View>}
    </View>
    <Txt kind="small" muted>Acerca la imagen y arrastra para explorarla.</Txt>
  </Modal.Content></Modal>;
}
